# zeus-plugin-atr1000

[![Build](https://github.com/pe5jw/zeus-plugin-atr1000/actions/workflows/build.yml/badge.svg)](https://github.com/pe5jw/zeus-plugin-atr1000/actions/workflows/build.yml)
[![License: GPL-2.0](https://img.shields.io/badge/License-GPL--2.0-blue.svg)](LICENSE)

**Openhpsdr-Zeus plugin for the [Antuner ATR-1000](https://www.antuner.com/product.php)**
1 kW HF (1.8–30 MHz) automatic antenna tuner.

Controls the tuner over its built-in WiFi using the binary WebSocket protocol
on port 60001 — decoded directly from the device's own web app.

---

## Features

| | |
|---|---|
| **Live meters** | Forward power (W) and SWR with bar graphs, auto-scaling to the device's reported maximum |
| **Tune** | Reset relay · Memory tune · Full tune · Fine tune |
| **Path / network** | Bypass ↔ Tuner inline toggle; LC ↔ CL matching network toggle |
| **Manual L/C** | Relay code nudge +/− for inductance and capacitance (0–127 steps, 12.7 µH / 1270 pF range) |
| **Memory overview** | All stored slots shown with frequency, band, L, C; click a row to apply |
| **Auto-tune on band change** | When enabled: on rig band change the plugin recalls the best matching memory slot automatically (never fires during TX) |
| **Rig context** | Displays rig frequency, band, and TX state when `ReadRadioState` is granted |

---

## Requirements

- **Openhpsdr-Zeus** — [develop branch](https://github.com/Kb2uka/openhpsdr-zeus/tree/develop)
- **.NET 10 SDK** — [download](https://dotnet.microsoft.com/download)
- **Node.js 22 + npm** — [download](https://nodejs.org/)
- ATR-1000 with WiFi enabled and reachable on the same network

---

## Quick start

### 1. Clone both repos side by side

```text
projects/
  openhpsdr-zeus/        ← git clone https://github.com/Kb2uka/openhpsdr-zeus -b develop
  zeus-plugin-atr1000/   ← git clone https://github.com/pe5jw/zeus-plugin-atr1000
```

### 2. Build

**Windows (PowerShell):**
```powershell
.\build.ps1
```

**Linux / macOS:**
```bash
chmod +x build.sh
./build.sh
```

Both scripts build the UI, compile the backend, assemble `dist/`, produce
`atr1000-<version>.zip`, and print the SHA-256 you need for the registry entry.

If the Zeus repo is not at `../openhpsdr-zeus`, pass the path explicitly:

```powershell
.\build.ps1 -ZeusRepo C:\src\openhpsdr-zeus
```
```bash
./build.sh --zeus-repo ~/src/openhpsdr-zeus
```

### 3. Install in Zeus

In Zeus: **Plugins → Install from file** → select `atr1000-<version>.zip`.

Or copy the `dist/` folder into Zeus's plugin directory (see Zeus docs).

### 4. Configure

Open the **ATR-1000 Tuner** tile, type the tuner's IP address
(e.g. `192.168.2.124` on your LAN, or `10.13.37.2` in hotspot mode) and click
**Connect**. The backend connects to `ws://<host>:60001/`, sends the SYNC
handshake, and starts streaming.

---

## Protocol notes

The ATR-1000 uses a compact **binary protocol** over WebSocket on port 60001.
Every frame: `[0xFF, cmd, length, payload…]` with little-endian integers.

Key points:
- The device is **silent until it receives SYNC** (`FF 01 00`); the plugin sends
  it ~500 ms after connecting.
- The device sends **TEST** (cmd 254) as a keepalive; the plugin answers with
  **TEST_REPLAY** (`FF FD 00`) or the link drops.
- Meter frames (cmd 2) arrive ~2×/sec. All other state is pushed once after
  SYNC and on change.
- All HTTP paths on port 80 return 404 — everything goes through the WebSocket.

See [PROTOCOL.md](PROTOCOL.md) for a full frame-by-frame reference.

---

## Tools

`tools/atr_probe.py` is a standalone Python read-only diagnostic tool. It
connects to the tuner, sends SYNC, and prints decoded frames — useful for
verifying the live values match the panel.

```bash
pip install websockets
python tools/atr_probe.py 192.168.2.124 --seconds 25
```

---

## Submitting to the Zeus plugin registry

1. Create a GitHub release tagged `v<version>` (CI attaches the zip automatically).
2. Copy the SHA-256 printed by the build script into `registry-entry.json`.
3. Fork [Kb2uka/openhpsdr-zeus-plugins](https://github.com/Kb2uka/openhpsdr-zeus-plugins),
   add your `registry-entry.json` block to `registry.json`, and open a PR.

---

## License

GPL-2.0-or-later — see [LICENSE](LICENSE).  
ATR-1000 is a product of Antuner / BI3QWQ. This plugin is an independent,
unofficial integration and is not affiliated with or endorsed by Antuner.
