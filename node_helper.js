"use strict";

const NodeHelper = require("node_helper");
const { execSync, spawn } = require("child_process");

module.exports = NodeHelper.create({
    start() {
        this.config = null;
        this.gpioProc = null;
        this.offTimer = null;
        this.restartTimer = null;
        this.sensorStartedAt = 0;
        this.motionActive = false;
        this.displayOn = true;
        console.log("[MMM-PIRMotion] node_helper started");
    },

    socketNotificationReceived(notification, payload) {
        if (notification === "CONFIG") {
            /* CONFIG is re-sent on every browser (re)connect — only the first
             * one may start the sensor, otherwise a second gpiomon fights the
             * first for the line ("device busy" restart loop). */
            if (this.config) return;
            this.config = payload;
            this.initDisplayControl();
            this.startSensor();
            /* Arm the timer right away: without this the display never turns
             * off when no motion occurs after startup. */
            this.armOffTimer();
        }
    },

    /* ── display control ──────────────────────────────────── */
    env() {
        return {
            ...process.env,
            DISPLAY: process.env.DISPLAY || ":0",
            WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY || "wayland-1"
        };
    },

    initDisplayControl() {
        if (this.config.displayMethod !== "dpms") return;
        try {
            /* Disable the X screensaver and DPMS auto-timeouts — the panel is
             * controlled exclusively by us via `xset dpms force on/off`. */
            execSync("xset s off; xset dpms 0 0 0", { env: this.env() });
        } catch (e) {
            console.error(`[MMM-PIRMotion] xset init failed: ${e.message}`);
        }
    },

    displayCmd(on) {
        const { displayMethod, display } = this.config;
        if (displayMethod === "xrandr")
            return `xrandr --output ${display} --${on ? "auto" : "off"}`;
        if (displayMethod === "wlr-randr")
            return `wlr-randr --output ${display} --${on ? "on" : "off"}`;
        return `xset dpms force ${on ? "on" : "off"}`;
    },

    setDisplay(on) {
        if (this.displayOn === on) return;
        this.displayOn = on;

        try {
            execSync(this.displayCmd(on), { env: this.env() });
            console.log(`[MMM-PIRMotion] display ${on ? "ON" : "OFF"}`);
        } catch (e) {
            console.error(`[MMM-PIRMotion] display cmd failed: ${e.message}`);
        }

        this.sendSocketNotification("DISPLAY_STATE", { on });
    },

    /* ── motion handling ──────────────────────────────────── */
    armOffTimer() {
        if (this.offTimer) clearTimeout(this.offTimer);
        this.offTimer = setTimeout(() => {
            this.offTimer = null;
            this.motionActive = false;
            this.sendSocketNotification("MOTION", { active: false });
            this.setDisplay(false);
        }, this.config.timeout * 1000);
    },

    /*
     * The HC-SR501 OUT pin fires a rising edge for every detected movement.
     * Each pulse turns the display on and (re)starts the off-timer; once no
     * movement occurs for `timeout` seconds the display turns off.
     */
    onMotion() {
        if (!this.motionActive) {
            this.motionActive = true;
            this.sendSocketNotification("MOTION", { active: true });
        }
        this.setDisplay(true);
        this.armOffTimer();
    },

    /* ── GPIO via gpiomon CLI ─────────────────────────────── */
    startSensor() {
        const chip = this.config.gpioChip || "/dev/gpiochip4";
        const line = String(this.config.gpioPin);

        /* stdbuf -oL: gpiomon block-buffers stdout when writing to a pipe —
         * without line buffering events sit in libc's buffer for ages. */
        const proc = spawn("stdbuf", ["-oL", "gpiomon", "-r", chip, line]);
        this.gpioProc = proc;
        this.sensorStartedAt = Date.now();

        proc.stdout.on("data", () => this.onMotion());
        proc.stderr.on("data", (d) =>
            console.error(`[MMM-PIRMotion] gpiomon: ${d.toString().trim()}`));
        proc.on("error", (e) =>
            console.error(`[MMM-PIRMotion] failed to start gpiomon: ${e.message} — install with: sudo apt install gpiod`));
        proc.on("close", (code) => {
            if (this.gpioProc !== proc) return;
            this.gpioProc = null;
            if (code === 0 || code === null) return;

            if (Date.now() - this.sensorStartedAt < 2000) {
                console.error("[MMM-PIRMotion] gpiomon exited immediately. Common causes:");
                console.error("  - permissions: /dev/gpiochip* not readable -> see snippets.md (udev gpio group)");
                console.error(`  - wrong chip/line: verify with: gpioinfo ${chip}  (Rock Pi 4 physical pin 13 = gpiochip4 line 22)`);
                console.error("  - line busy: another process or overlay (e.g. PWM) owns the line");
            }
            console.warn(`[MMM-PIRMotion] gpiomon exited (${code}), retrying in 5s...`);
            this.restartTimer = setTimeout(() => {
                if (this.config) this.startSensor();
            }, 5000);
        });

        console.log(`[MMM-PIRMotion] watching ${chip} line ${line} (rising edges), timeout ${this.config.timeout}s`);
    },

    stop() {
        if (this.offTimer) clearTimeout(this.offTimer);
        if (this.restartTimer) clearTimeout(this.restartTimer);
        if (this.gpioProc) { this.gpioProc.kill(); this.gpioProc = null; }
    }
});
