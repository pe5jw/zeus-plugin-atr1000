# Changelog

## [Unreleased]

## [0.4.0] — 2026-06-14

### Added
- **Zeus v0.9.0 compatibility** — SDK minVersion bumped to 1.2.0.
- **`ControlRadio` capability** — plugin can now key TX via `IRadioController`.
- **Auto-carrier for Full/Fine tune** — pressing Full or Fine automatically keys
  the carrier, waits for the ATR-1000 to finish tuning (max 30 s), then unkeys.
  Full ⚡ / Fine ⚡ labels appear when ControlRadio is granted.
- **`MoxChanged`** event subscription — now officially in `IRadioStateReader`.
- **Frequency input next to Save** — pre-fills from rig frequency; editable manually.
  Save stores frequency alongside L/C so the memory list shows MHz + band.

### Changed
- Version bumped to 0.4.0.
- `IRadioStateReader` (SDK 1.2.0 name) replaces old `IRadioContext`.
- Memory Save now sends `MEMORY_ACTION` + `MEMORY_FREQ` (cmd 10) with slot + kHz.

## [0.3.0] — 2026-06-14

### Added
- Discovery: scan local subnets + manual subnet input.
- Two panels: ATR-1000 (compact) and ATR-1000 Control (full).
- Tuning indicator: pulsing amber dot + animated progress bar.
- Tune mode state colours: Memory=green (instant), Full/Fine=blue (carrier needed).
- Disconnect button; IP input hidden when connected.

### Changed
- Version bumped to 0.3.0.
- `isTuning` only true for Full/Fine (mode ≥ 2).

## [0.2.0] — 2026-06-05

### Added
- Initial working release.
- Binary WebSocket protocol on port 60001 (decoded from device firmware).
- Live power/SWR meters, L/C relay nudge, network LC↔CL toggle.
- Tune (Reset/Memory/Full/Fine), bypass toggle.
- Memory overview (20 slots), auto-tune on band change.
- `tools/atr_probe.py` — read-only protocol probe.
- `PROTOCOL.md` — full frame-by-frame protocol reference.
