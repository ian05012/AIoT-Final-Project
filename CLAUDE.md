# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a gamified IoT health monitoring system consisting of four interconnected components: ESP32 firmware, a Python bridge server, a web-based simulator, and a Godot 4 desktop companion ("desktop pet"). The pet reacts in real time to physical sensor data (posture, hydration, air quality, sedentary time).

## Running the Project

**One-click launch (Windows):**
```bat
run_app.bat
```
This starts `server.py` and launches `桌寵/SlimePet.exe`.

**Manual start:**
```bash
pip install pyserial websockets
python server.py
```
- HTTP server: `http://localhost:8000` (serves `/public/`)
- WebSocket server: `ws://localhost:3000`

Then open the browser to test sensor simulation without hardware.

**Godot source (requires Godot 4):** Open `/godot/` project in Godot editor and press F5 to run.

**ESP32 firmware:** Upload `firmware/esp32_companion/esp32_companion.ino` via Arduino IDE. Required libraries: `HX711`, `ArduinoJson`.

## Architecture

```
ESP32 (USB Serial 115200 baud, JSON)
    ↓ ↑
server.py  ←→  WebSocket (port 3000)  ←→  Web UI (port 8000) + Godot Desktop Pet
```

### Component Responsibilities

| Component | Role |
|-----------|------|
| `server.py` | HTTP server, WebSocket broadcaster, USB Serial bridge |
| `firmware/.../esp32_companion.ino` | Reads sensors, sends JSON over serial, drives buzzer |
| `public/app.js` | Web simulator UI, canvas character rendering, WebSocket client |
| `godot/Main.gd` | Transparent/borderless window, mouse passthrough, drag logic |
| `godot/Network.gd` | WebSocket client, auto-reconnect every 3 s |
| `godot/Slime.gd` | Pet drawing (5 types), state machine, animations |

### Data Format (ESP32 → Server → Clients)

The ESP32 sends JSON over serial; `server.py` forwards it as-is over WebSocket. Key fields:
- `weight_g`, `distance_cm`, `pm25_ugm3`
- `drinking` (boolean), `tare` command
- `warnings` (0–4, drives buzzer severity)
- `posture_stage`, `air_stage`, `sedentary_stage`, `dehydration_stage` (0=OK, 1=mild, 2=severe)

### State Machine (Godot `Slime.gd`)

Pet states: `IDLE`, `DRINKING`, `HAPPY`, `EATING`, `POSTURE_WARNING`, `AIR_WARNING`, `DEHYDRATION_WARNING`, `SEDENTARY_WARNING`. Each state maps to a color theme and expression. Transitions are driven by incoming WebSocket JSON.

### Buzzer Logic (ESP32)

Warning count (0–4) determines alert intensity. 4 warnings = 1200 Hz continuous beeping. The web UI can send a mute/acknowledge command back to the server, which forwards it to ESP32 via serial.

## Key GPIO Pin Mapping (ESP32)

| Sensor | Pins |
|--------|------|
| HX711 Load Cell | DT=19, SCK=18 |
| HC-SR04 Ultrasonic | TRIG=22, ECHO=23 |
| GP2Y1010AU0F Dust | LED=27, ADC=34 |
| Passive Buzzer | GPIO 21 (PWM) |

## Simulator Mode (no hardware)

The web UI at `http://localhost:8000` provides sliders and buttons to simulate all sensor inputs. The Godot pet and web UI both receive the same simulated packets via WebSocket — no ESP32 needed for development.

## Exported Godot Build

The pre-built Windows binary is in `/桌寵/`. If re-exporting from Godot source, the project requires: transparent background, borderless window, always-on-top, window size 400×400.
