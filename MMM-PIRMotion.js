"use strict";

Module.register("MMM-PIRMotion", {
    defaults: {
        gpioChip: "/dev/gpiochip4",     /* Rock Pi 4: physical pin 13 = GPIO4_C6 -> bank 4 */
        gpioPin: 22,                    /* line offset on gpioChip (C6 = 16 + 6 = 22) */
        timeout: 120,                   /* seconds before display turns off */
        displayMethod: "dpms",          /* "dpms" (X11, xset), "xrandr" or "wlr-randr" */
        display: "HDMI-1",              /* output name — only used by xrandr / wlr-randr */
        showIndicator: true,
        animateModules: false
    },

    motionActive: false,
    displayOn: true,

    start() {
        Log.info("[MMM-PIRMotion] start");
        this.sendSocketNotification("CONFIG", this.config);
    },

    getTemplate() { return "MMM-PIRMotion.njk"; },
    getTemplateData() {
        return {
            motionActive: this.motionActive,
            displayOn: this.displayOn,
            showIndicator: this.config.showIndicator
        };
    },

    getStyles() { return ["MMM-PIRMotion.css"]; },

    socketNotificationReceived(notification, payload) {
        if (notification === "MOTION") {
            this.motionActive = payload.active;
            this.updateDom();
        }
        if (notification === "DISPLAY_STATE") {
            this.displayOn = payload.on;
            if (this.config.animateModules) {
                document.body.classList.toggle("pir-display-off", !payload.on);
            }
            this.updateDom();
        }
    }
});
