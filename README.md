# MMM-PIRMotion

A [MagicMirror²](https://magicmirror.builders/) module that turns your display on and off automatically using an **HC-SR501 PIR motion sensor** — no CPU polling, no unnecessary wake-ups. When motion is detected, the HDMI output powers on instantly. After a configurable idle timeout with no motion, it shuts back off.

The low-level sensor reading is handled by a small C daemon (`pir_daemon`) that uses Linux kernel **sysfs GPIO edge interrupts** (`poll(POLLPRI)`) for true interrupt-driven detection. The daemon communicates with the MagicMirror node helper via a Unix domain socket.

Tested on **Rock Pi 4** running MagicMirror² with X11 (`xrandr`) and Wayland (`wlr-randr`).

---

## Features

- Instant display-on on motion (no polling delay)
- Configurable timeout before display powers off
- Interrupt-driven C backend — zero CPU usage at idle
- Auto-restarts the C daemon if it crashes
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
```

### 2. Build the C daemon

```bash
cd MMM-PIRMotion
make
```

Requires `gcc`. Install with `sudo apt install build-essential` if missing.

### 3. Find your display output name

```bash
xrandr | grep " connected"
# e.g. HDMI-1 connected 1920x1080+0+0
```

For Wayland:
```bash
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
| `gpioPin` | `number` | `36` | Linux sysfs GPIO number for the HC-SR501 OUT pin |
| `timeout` | `number` | `120` | Seconds to wait after last motion before turning display off |
| `display` | `string` | `"HDMI-1"` | Display output name (from `xrandr` or `wlr-randr`) |
| `displayMethod` | `string` | `"xrandr"` | `"xrandr"` for X11, `"wlr-randr"` for Wayland |
| `socketPath` | `string` | `"/tmp/mmm-pir.sock"` | Unix socket path for daemon ↔ node_helper communication |
| `showIndicator` | `boolean` | `true` | Show a small status dot in the bottom-right corner |
| `animateModules` | `boolean` | `false` | Fade out all MM content when display is flagged off |

---

## Architecture

```
HC-SR501 OUT pin
      │
      ▼
Rock Pi 4 GPIO (sysfs edge="both")
      │  poll(POLLPRI) — kernel interrupt, zero CPU idle
      ▼
pir_daemon  (C binary)
      │  Unix socket — JSON lines
      │  {"event":"motion_start","gpio":36,"ts":"..."}
      ▼
node_helper.js  (Node.js)
      │  xrandr --output HDMI-1 --auto / --off
      │  configurable timeout
      ▼
MMM-PIRMotion.js  (browser)
      │  indicator dot  +  body class toggle
```

---

## Notifications sent to other modules

| Notification | Payload | Description |
|---|---|---|
| `MOTION` | `{ active: true/false }` | Fired on every motion start/end |
| `DISPLAY_STATE` | `{ on: true/false }` | Fired when the display actually changes state |

Other modules can listen for `MOTION` to react to presence, e.g. to start animations or fetch fresh data.

---

## License

MIT
