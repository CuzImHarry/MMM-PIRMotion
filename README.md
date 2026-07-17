# MMM-PIRMotion

A [MagicMirror²](https://magicmirror.builders/) module that turns your display on and off automatically using an **HC-SR501 PIR motion sensor**. When motion is detected the display powers on instantly. After a configurable idle timeout with no motion, it shuts back off. The timer is also armed at startup, so the display turns off after `timeout` seconds even if no motion is ever detected.

GPIO edge events are watched with the `gpiomon` CLI tool from the `gpiod` package — the modern Linux character device interface (`/dev/gpiochipN`). No deprecated sysfs, no polling, zero CPU usage at idle.

Tested on **Rock Pi 4** running Debian 11 with MagicMirror² under X11.

---

## Features

- Instant display-on on motion (interrupt-driven, no polling)
- Configurable timeout before display powers off — armed from startup, not just after first motion
- Zero CPU usage at idle — kernel edge events via `/dev/gpiochipN`
- Three display methods: `dpms` (X11 default, safest), `xrandr`, `wlr-randr` (Wayland)
- Small indicator dot in the corner (green = motion active, grey = idle)
- Auto-restarts the GPIO watcher if it dies; clear error hints in the log

---

## Hardware

### Wiring (Rock Pi 4)

| HC-SR501 Pin | Rock Pi 4 Pin | Description |
|---|---|---|
| VCC | Pin 2 | 5 V power |
| GND | Pin 6 | Ground |
| OUT | Pin 13 | GPIO signal (GPIO4_C6) |

> The HC-SR501 OUT pin goes HIGH (~3.3 V) when motion is detected.
> Adjust the onboard sensitivity and delay potentiometers to your environment.
> Note: the Rock Pi 4 header GPIOs are 3.0 V rated — the HC-SR501's 3.3 V output
> works in practice, but a small voltage divider (e.g. 1k/2k) is the by-the-book option.

### GPIO chip and line offset — IMPORTANT

On the RK3399 every GPIO **bank** appears as its own gpiochip. The physical pin number is **not** the line offset:

```
Physical pin 13  =  GPIO4_C6  =  /dev/gpiochip4, line 22   (C6 -> 16 + 6 = 22)
```

Verify on the device:

```bash
gpiodetect                      # lists gpiochip0..gpiochip4
gpioinfo /dev/gpiochip4         # line 22 should be unused
gpiomon -r /dev/gpiochip4 22    # wave your hand -> prints RISING EDGE events
```

If `gpiomon` prints events when you wave, the wiring and chip/line are correct.

---

## Installation

```bash
# 1. System dependencies (gpiomon + xset)
sudo apt install -y gpiod x11-xserver-utils

# 2. GPIO permissions (once) — see snippets.md for the udev gpio-group setup

# 3. No npm dependencies needed — the module only uses built-in Node APIs
```

### Config

```js
{
    module: "MMM-PIRMotion",
    position: "bottom_right",
    config: {
        gpioChip: "/dev/gpiochip4", // Rock Pi 4 physical pin 13 -> bank 4
        gpioPin: 22,                // line offset on gpioChip (GPIO4_C6)
        timeout: 120,               // seconds until display off after last motion
        displayMethod: "dpms",      // "dpms" (X11), "xrandr" or "wlr-randr"
        display: "HDMI-1",          // only used by xrandr / wlr-randr
        showIndicator: true
    }
}
```

---

## Configuration options

| Option | Type | Default | Description |
|---|---|---|---|
| `gpioChip` | `string` | `"/dev/gpiochip4"` | GPIO chip device — find with `gpiodetect` |
| `gpioPin` | `number` | `22` | Line offset on `gpioChip` for the HC-SR501 OUT pin |
| `timeout` | `number` | `120` | Seconds after last motion before display turns off |
| `displayMethod` | `string` | `"dpms"` | `"dpms"` (X11 `xset`, recommended), `"xrandr"`, `"wlr-randr"` |
| `display` | `string` | `"HDMI-1"` | Output name — only used by `xrandr`/`wlr-randr` |
| `showIndicator` | `boolean` | `true` | Show a small status dot in the bottom-right corner |
| `animateModules` | `boolean` | `false` | Fade out all MM content while display is flagged off |

### Why `dpms` is the default

`xrandr --output HDMI-1 --off` removes the only X output — Electron can lose its
rendering surface and misbehave when the output comes back (especially with the
Mali-T860 driver on this board). `xset dpms force off` just powers down the panel
while the X screen stays intact, which is far more robust for a kiosk. The module
disables the X screensaver and DPMS auto-timeouts at startup so the panel is
controlled exclusively by the sensor.

---

## Architecture

```
HC-SR501 OUT (rising edge per movement)
      │
      ▼
/dev/gpiochip4 line 22  (kernel edge event)
      │
      ▼
stdbuf -oL gpiomon -r   (single long-running watcher, line-buffered)
      │  stdout line per event
      ▼
node_helper.js
      │  every event: display ON + (re)start off-timer
      │  timer expiry: xset dpms force off
      ▼
MMM-PIRMotion.js (browser) — indicator dot + optional body class
```

`stdbuf -oL` matters: `gpiomon` block-buffers stdout when piped, so without it
events would sit in libc's buffer instead of reaching the node helper.

---

## Notifications sent to other modules

| Notification | Payload | Description |
|---|---|---|
| `MOTION` | `{ active: true/false }` | `true` on first motion after idle, `false` when timeout expires |
| `DISPLAY_STATE` | `{ on: true/false }` | Fired when the display actually changes state |

---

## Troubleshooting

- **Display never turns off:** check `pm2 logs MagicMirror` for `[MMM-PIRMotion]` lines. You should see `watching /dev/gpiochip4 line 22` at startup.
- **No motion events:** test outside MM with `gpiomon -r /dev/gpiochip4 22` and wave. No output → wiring or chip/line wrong.
- **`gpiomon exited immediately`:** permissions (see snippets.md), wrong line, or the line is claimed by another driver — check `gpioinfo /dev/gpiochip4`.
- **Display turns off but not back on:** verify `DISPLAY=:0 xset dpms force on` works from an SSH session as the MM user.

## License

MIT
