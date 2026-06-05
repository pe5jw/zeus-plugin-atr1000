# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.2.0] — 2026-06-05

### Added
- Memory overview panel: all stored slots shown with frequency, band, L, C, and network;
  click any row to apply it instantly.
- Auto-tune on band change: when enabled, the plugin recalls the best-matching
  memory slot whenever the rig's band changes (ReadRadioState; never fires during TX).
- Band labels (160 m – 10 m) derived from stored frequency and from rig frequency.
- POST `/options` endpoint to toggle `autoTune` at runtime (persisted).
- POST `/sync` endpoint + Refresh button to re-request the full state from the device.
- After `memory/save` the backend automatically sends SYNC to refresh the memory list.

### Changed
- Version bumped to 0.2.0.

## [0.1.0] — 2026-06-05

### Added
- Initial release.
- Binary WebSocket protocol on port 60001 (decoded from device firmware).
- Live power / SWR meters, L/C relay nudge, network LC↔CL toggle.
- Tune (Reset / Memory / Full / Fine), bypass toggle.
- Memory select / save / undo.
- Host persisted via IPluginSettings; reconnects automatically on Zeus restart.
- `tools/atr_probe.py` — read-only protocol probe and frame decoder.
