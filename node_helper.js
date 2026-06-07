"use strict";

const NodeHelper = require("node_helper");
const { execSync } = require("child_process");
const path = require("path");

module.exports = NodeHelper.create({
    start() {
        this.config = null;
        this.pir = null;
        this.offTimer = null;
        this.displayOn = true;
        console.log("[MMM-PIRMotion] node_helper started");
    },

    socketNotificationReceived(notification, payload) {
        if (notification === "CONFIG") {
            this.config = payload;
            this.startSensor();
        }
    },

    /* ── HDMI control ─────────────────────────────────────── */
    setDisplay(on) {
        if (this.displayOn === on) return;
        this.displayOn = on;

        const cmd = this.config.displayMethod === "xrandr"
            ? `xrandr --output ${this.config.display} --${on ? "auto" : "off"}`
            : `wlr-randr --output ${this.config.display} --${on ? "on" : "off"}`;

        try {
            execSync(cmd, { env: { ...process.env, DISPLAY: ":0", WAYLAND_DISPLAY: "wayland-1" } });
            console.log(`[MMM-PIRMotion] display ${on ? "ON" : "OFF"}`);
        } catch (e) {
            console.error(`[MMM-PIRMotion] display cmd failed: ${e.message}`);
        }

        this.sendSocketNotification("DISPLAY_STATE", { on });
    },

    /* ── motion events ────────────────────────────────────── */
    onMotionStart() {
        if (this.offTimer) { clearTimeout(this.offTimer); this.offTimer = null; }
        this.setDisplay(true);
        this.sendSocketNotification("MOTION", { active: true });
    },

    onMotionEnd() {
        this.sendSocketNotification("MOTION", { active: false });
        if (this.offTimer) clearTimeout(this.offTimer);
        this.offTimer = setTimeout(() => {
            this.setDisplay(false);
            this.offTimer = null;
        }, this.config.timeout * 1000);
    },

    /* ── GPIO via onoff ───────────────────────────────────── */
    startSensor() {
        let Gpio;
        try {
            Gpio = require("onoff").Gpio;
        } catch {
            console.error("[MMM-PIRMotion] 'onoff' package not found — run: npm install onoff");
            return;
        }

        this.pir = new Gpio(this.config.gpioPin, "in", "both");
        this.pir.watch((err, value) => {
            if (err) { console.error("[MMM-PIRMotion] GPIO error:", err); return; }
            if (value === 1) this.onMotionStart();
            else this.onMotionEnd();
        });

        console.log(`[MMM-PIRMotion] watching GPIO${this.config.gpioPin}`);
    },

    stop() {
        if (this.offTimer) clearTimeout(this.offTimer);
        if (this.pir) { this.pir.unexport(); this.pir = null; }
    }
});
