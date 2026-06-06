"use strict";

const NodeHelper = require("node_helper");
const { execSync, spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

module.exports = NodeHelper.create({
    start() {
        this.config = null;
        this.pirProcess = null;
        this.offTimer = null;
        this.displayOn = true;
        console.log("[MMM-PIRMotion] node_helper started");
    },

    socketNotificationReceived(notification, payload) {
        if (notification === "CONFIG") {
            this.config = payload;
            this.startDaemon();
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

    /* ── daemon lifecycle ─────────────────────────────────── */
    startDaemon() {
        const daemonBin = path.join(__dirname, "pir_daemon");

        if (!fs.existsSync(daemonBin)) {
            console.error("[MMM-PIRMotion] pir_daemon binary not found — run 'make' in the module directory");
            return;
        }

        this.pirProcess = spawn(daemonBin, ["-g", String(this.config.gpioPin)], {
            stdio: ["ignore", "pipe", "pipe"]
        });

        let buf = "";
        this.pirProcess.stdout.on("data", (data) => {
            buf += data.toString();
            let nl;
            while ((nl = buf.indexOf("\n")) !== -1) {
                const line = buf.slice(0, nl).trim();
                buf = buf.slice(nl + 1);
                if (!line) continue;
                try {
                    const msg = JSON.parse(line);
                    if (msg.event === "motion_start") this.onMotionStart();
                    else if (msg.event === "motion_end") this.onMotionEnd();
                } catch { /* ignore malformed */ }
            }
        });

        this.pirProcess.stderr.on("data", (d) => process.stderr.write(d.toString()));

        this.pirProcess.on("exit", (code) => {
            console.error(`[MMM-PIRMotion] pir_daemon exited (code ${code}) — restarting in 10 s`);
            this.pirProcess = null;
            setTimeout(() => this.startDaemon(), 10000);
        });
    },

    stop() {
        if (this.offTimer) clearTimeout(this.offTimer);
        if (this.pirProcess) { this.pirProcess.kill("SIGTERM"); this.pirProcess = null; }
    }
});
