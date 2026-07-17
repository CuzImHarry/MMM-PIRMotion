# MMM-PIRMotion — Setup Snippets

## Test the sensor first (before touching MagicMirror)

Physical pin 13 on the Rock Pi 4 is **GPIO4_C6** → `/dev/gpiochip4`, line offset **22**
(banks are separate gpiochips on RK3399; the physical pin number is NOT the line offset).

```bash
sudo apt install -y gpiod x11-xserver-utils

gpiodetect                      # should list gpiochip0..gpiochip4
gpioinfo /dev/gpiochip4         # line 22 should say "unused"
gpiomon -r /dev/gpiochip4 22    # wave your hand -> prints RISING EDGE events
```

If `gpiomon` prints events when you wave, wiring and chip/line are correct.
Then test display control (from SSH, as the MM user):

```bash
DISPLAY=:0 xset dpms force off   # panel should go dark
DISPLAY=:0 xset dpms force on    # panel should come back
```

---

## Fix: gpiomon permission denied on Rock Pi 4 / Debian

Run these steps once after a fresh install:

```bash
# 1. Create gpio group (does not exist by default on Debian)
sudo groupadd gpio

# 2. Create persistent udev rule (survives reboots)
echo 'SUBSYSTEM=="gpio", KERNEL=="gpiochip*", ACTION=="add", GROUP="gpio", MODE="0660"' | sudo tee /etc/udev/rules.d/99-gpio.rules

# 3. Add your user to the gpio group
sudo usermod -aG gpio $USER

# 4. Reload udev and apply immediately
sudo udevadm control --reload-rules
sudo udevadm trigger

# 5. Activate group in current session (no logout needed)
newgrp gpio
```

Verify it worked:

```bash
ls -la /dev/gpiochip*
# should show: crw-rw---- root gpio ...

groups
# should include: gpio
```

Then start MagicMirror:

```bash
cd ~/MagicMirror
npm run start
```

> **Note:** The udev rule needs `KERNEL=="gpiochip*"` — not just `SUBSYSTEM=="gpio"` — to work correctly on Debian/Rockchip.

---

## Find the correct GPIO chip and line offset

```bash
# List all GPIO chips
gpiodetect

# Show all lines on a chip
gpioinfo /dev/gpiochip0
```

Set `gpioChip` and `gpioPin` in `config.js` accordingly.

---

## Install system dependencies

```bash
sudo apt install -y gpiod libgpiod-dev build-essential
```

---

## PM2 setup

```bash
cd ~/MagicMirror
pm2 start npm --name MagicMirror -- run start
pm2 save
pm2 startup
```

Restart after config changes:

```bash
pm2 restart MagicMirror
pm2 logs MagicMirror --lines 50
```
