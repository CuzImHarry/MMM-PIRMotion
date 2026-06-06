"use strict";

const NodeHelper = require("node_helper");
const { execSync, spawn } = require("child_process");
const net = require("net");
const path = require("path");
const fs = require("fs");

module.exports = NodeHelper.create({
    start() {
        this.config = null;
        this.pirProcess = null;
        this.socketClient = null;
        this.offTimer = null;
        this.displayOn = true;
        this.reconnectTimer = null;
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
        if (this.offTimer) {
            clearTimeout(this.offTimer);
            this.offTimer = null;
        }
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

    /* ── Unix socket client ───────────────────────────────── */
    connectSocket() {
        const sockPath = this.config.socketPath || "/tmp/mmm-pir.sock";

        const tryConnect = () => {
            if (this.socketClient) return;

            const client = net.createConnection(sockPath);
            let buf = "";

            client.on("connect", () => {
                console.log("[MMM-PIRMotion] connected to pir_daemon socket");
                this.socketClient = client;
                if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
            });

            client.on("data", (data) => {
                buf += data.toString();
                let nl;
                while ((nl = buf.indexOf("\n")) !== -1) {
                    const line = buf.slice(0, nl).trim();
                    buf = buf.slice(nl + 1);
                    if (!line) continue;
                    try {
                        const msg = JSON.parse(line);
                        if (msg.event === "motion_start") this.onMotionStart();
                        else if (msg.event === "motion_end")  this.onMotionEnd();
                    } catch { /* ignore malformed */ }
                }
            });

            client.on("error", (err) => {
                console.warn(`[MMM-PIRMotion] socket error: ${err.message}`);
            });

            client.on("close", () => {
                this.socketClient = null;
                console.warn("[MMM-PIRMotion] pir_daemon disconnected — reconnecting in 5 s");
                this.reconnectTimer = setTimeout(tryConnect, 5000);
            });
        };

        tryConnect();
    },

    /* ── daemon lifecycle ─────────────────────────────────── */
    startDaemon() {
        const daemonBin = path.join(__dirname, "pir_daemon");

        if (!fs.existsSync(daemonBin)) {
            console.error("[MMM-PIRMotion] pir_daemon binary not found — run 'make' in the module directory");
            return;
        }

        const args = [
            "-g", String(this.config.gpioPin),
            "-s", this.config.socketPath || "/tmp/mmm-pir.sock"
        ];

        this.pirProcess = spawn(daemonBin, args, { stdio: ["ignore", "ignore", "pipe"] });
        this.pirProcess.stderr.on("data", (d) => process.stderr.write(`[pir_daemon] ${d}`));
        this.pirProcess.on("exit", (code) => {
            console.error(`[MMM-PIRMotion] pir_daemon exited (code ${code}) — restarting in 10 s`);
            this.pirProcess = null;
            setTimeout(() => this.startDaemon(), 10000);
        });

        /* give daemon 500 ms to create the socket, then connect */
        setTimeout(() => this.connectSocket(), 500);
    },

    stop() {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        if (this.offTimer) clearTimeout(this.offTimer);
        if (this.socketClient) { this.socketClient.destroy(); this.socketClient = null; }
        if (this.pirProcess) { this.pirProcess.kill("SIGTERM"); this.pirProcess = null; }
    }
});
