# MMM-PIRMotion

A [MagicMirror²](https://magicmirror.builders/) module that turns your display on and off automatically using an **HC-SR501 PIR motion sensor**. When motion is detected the HDMI output powers on instantly. After a configurable idle timeout with no motion, it shuts back off.

GPIO edge interrupts are handled by the [`onoff`](https://www.npmjs.com/package/onoff) npm package — pure Node.js, no C code, no build step, zero CPU usage at idle.

Tested on **Rock Pi 4** running MagicMirror² with X11 (`xrandr`) and Wayland (`wlr-randr`).

---

## Features

- Instant display-on on motion (interrupt-driven, no polling)
- Configurable timeout before display powers off
- Zero CPU usage at idle — `onoff` uses Linux sysfs edge interrupts under the hood
- No C compiler or build step required
- Small indicator dot in the corner (green = motion active, grey = idle)
- Supports both X11 (`xrandr`) and Wayland (`wlr-randr`)

---

## Hardware

### Required

- HC-SR501 PIR motion sensor
- Rock Pi 4 (or any SBC with Linux sysfs GPIO support)

### Wiring

| HC-SR501 Pin | Rock Pi 4 Pin | Description |
|---|---|---|
| VCC | Pin 2 | 5 V power |
| GND | Pin 6 | Ground |
| OUT | Pin 13 | GPIO signal (sysfs GPIO36) |

> The HC-SR501 OUT pin goes HIGH when motion is detected and LOW when idle.
> Adjust the onboard sensitivity and delay potentiometers to your environment.

### Rock Pi 4 GPIO reference

| Physical Pin | sysfs GPIO | Default? |
|---|---|---|
| 7 | GPIO32 | |
| 11 | GPIO35 | |
| **13** | **GPIO36** | **yes** |

Change `gpioPin` in the config if you use a different pin.

---

## Installation

### 1. Clone the module

```bash
cd ~/MagicMirror/modules
git clone https://github.com/CuzImHarry/MMM-PIRMotion.git
cd MMM-PIRMotion
```

### 2. Install dependencies

```bash
npm install onoff
```

### 3. Find your display output name

```bash
# X11
xrandr | grep " connected"
# e.g. HDMI-1 connected 1920x1080+0+0

# Wayland
wlr-randr
```

### 4. Add to config

```js
{
    module: "MMM-PIRMotion",
    position: "bottom_right",
    config: {
        gpioPin: 36,
        timeout: 120,
        display: "HDMI-1",
        displayMethod: "xrandr",
        showIndicator: true
    }
}
```

---

## Configuration

| Option | Type | Default | Description |
|---|---|---|---|
| `gpioPin` | `number` | `36` | sysfs GPIO number for the HC-SR501 OUT pin |
| `timeout` | `number` | `120` | Seconds after last motion before display turns off |
| `display` | `string` | `"HDMI-1"` | Display output name (from `xrandr` or `wlr-randr`) |
| `displayMethod` | `string` | `"xrandr"` | `"xrandr"` for X11, `"wlr-randr"` for Wayland |
| `showIndicator` | `boolean` | `true` | Show a small status dot in the bottom-right corner |
| `animateModules` | `boolean` | `false` | Fade out all MM content when display is flagged off |

---

## Architecture

```
HC-SR501 OUT pin
      │
      ▼
Rock Pi 4 GPIO (sysfs edge="both")
      │  onoff.Gpio.watch() — kernel interrupt, zero CPU idle
      ▼
node_helper.js  (Node.js)
      │  xrandr --output HDMI-1 --auto / --off
      │  configurable timeout
      ▼
MMM-PIRMotion.js  (browser)
      │  indicator dot  +  body class toggle
```

---

## How it works

The [`onoff`](https://www.npmjs.com/package/onoff) package configures the GPIO pin as an input with edge detection set to `"both"` (rising and falling). Internally it opens `/sys/class/gpio/gpioN/value` and uses `epoll` to wait for the kernel interrupt — the process sleeps completely until the hardware fires, using no CPU.

When the HC-SR501 pulls its OUT pin HIGH (motion detected), `onoff` fires the callback with `value = 1`. On the falling edge (no motion), `value = 0`. The node helper then calls `xrandr` to switch the display and starts/cancels the off-timer accordingly.

---

## Notifications sent to other modules

| Notification | Payload | Description |
|---|---|---|
| `MOTION` | `{ active: true/false }` | Fired on every motion start/end |
| `DISPLAY_STATE` | `{ on: true/false }` | Fired when the display actually changes state |

Other modules can listen for `MOTION` to react to presence, e.g. to refresh data or trigger animations when someone walks up.

---

## License

MIT
