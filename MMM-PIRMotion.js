"use strict";

Module.register("MMM-PIRMotion", {
    defaults: {
        gpioPin: 36,                    /* Rock Pi 4 physical pin 13 = sysfs GPIO36 */
        timeout: 120,                   /* seconds before display turns off */
        display: "HDMI-1",             /* xrandr / wlr-randr output name */
        displayMethod: "xrandr",        /* "xrandr" or "wlr-randr" */
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
