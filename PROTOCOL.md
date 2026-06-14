# ATR-1000 WebSocket Protocol Reference

Decoded from the device's own web application (`inline.js`).  
All frames use the same header; integers are little-endian.

## Frame layout

```
byte 0 : 0xFF             flag (SCMD_FLAG)
byte 1 : command code
byte 2 : payload length   (= total frame length − 3)
byte 3+: payload
```

## Connection flow

```
Client                              Device (port 60001, path /)
  |                                   |
  |--- WebSocket connect -----------→ |
  |                                   |   (silent — no push yet)
  |   ~500 ms delay                   |
  |--- FF 01 00  (SYNC) -----------→ |
  |                                   |
  |← FF 0D .. (SYSTEM_INFO) --------- |   version string
  |← FF 05 .. (RELAY_STATUS) -------- |   current L/C/network
  |← FF 06 .. (MEMORY_STATUS) ------- |   active slot
  |← FF 07 .. (MEMORY_INFO) × N ----- |   one per stored slot
  |← FF 04 .. (TUNE_MODE) ----------- |   active tune mode
  |← FF 02 .. (METER_STATUS) -------- |   power + SWR  (repeats ~2×/s)
  |                                   |
  |← FF FE 00  (TEST keepalive) ------ |   (periodic)
  |--- FF FD 00  (TEST_REPLAY) ----→ |   must reply or link drops
```

## Command codes

| Code | Name              | Direction | Notes                        |
|-----:|-------------------|-----------|------------------------------|
|    1 | `SYNC`            | →         | Request full status push     |
|    2 | `METER_STATUS`    | ←         | Power + SWR (pushed ~2×/s)  |
|    3 | `TUNE_STATUS`     | →         | Bypass / Tuner inline        |
|    4 | `TUNE_MODE`       | →/←       | Tune algorithm               |
|    5 | `RELAY_STATUS`    | →/←       | L/C relay state              |
|    6 | `MEMORY_STATUS`   | ←         | Active slot + count          |
|    7 | `MEMORY_INFO`     | ←         | Per-slot detail              |
|    8 | `MEMORY_APPLY`    | →         | Recall a slot                |
|    9 | `MEMORY_ACTION`   | →         | Save current state to slot   |
|   10 | `MEMORY_FREQ`     | →         | Set frequency label on slot  |
|   11 | `WIFI_INFO`       | →/←       | WiFi configuration           |
|   12 | `WIFI_RESET`      | →         | Reset WiFi settings          |
|   13 | `SYSTEM_INFO`     | ←         | Firmware version string      |
|   14 | `INTERNET_STATUS` | ←         | Internet relay status        |
|   17 | `INTERNET_TOKEN`  | →         | Auth token (internet mode)   |
|   18 | `OTA`             | →/←       | Firmware update              |
|   19 | `SYSTEM_REBOOT`   | →         | Restart device               |
|   20 | `CUSTOM_INFO`     | →/←       | Custom device name           |
|  253 | `TEST_REPLAY`     | →         | Keepalive reply              |
|  254 | `TEST`            | ←         | Keepalive ping               |

## Frame details

### SYNC (→, cmd 1)
```
FF 01 00
```
Triggers a full push of all status frames. The device stays silent until it
receives this. Resend after reconnect, after `MEMORY_ACTION`, or to refresh.

---

### METER_STATUS (←, cmd 2) — 10 bytes
```
FF 02 07 xx  SWR_lo SWR_hi  FWD_lo FWD_hi  MAX_lo MAX_hi
             [4-5]          [6-7]           [8-9]
```
- `SWR` u16le: raw value; if ≥ 100 → actual SWR = raw / 100 (e.g. 150 → 1.50).
  Value 0 = no carrier / no reading.
- `FWD` u16le: forward power in watts.
- `MAX` u16le: full-scale power in watts (auto-ranging).

---

### TUNE_STATUS (→, cmd 3) — 4 bytes
```
FF 03 01  MODE
```
- `MODE` byte: `0` = Bypass (signal pass-through), `1` = Tuner inline.

---

### TUNE_MODE (→/←, cmd 4) — 4 bytes
```
FF 04 01  MODE
```
- `MODE` byte: `0` = Reset relay, `1` = Memory tune, `2` = Full tune, `3` = Fine tune.
- Device echoes current mode on `SYNC`; sending it triggers the corresponding cycle.

---

### RELAY_STATUS (→/←, cmd 5) — 10 bytes
```
FF 05 07  SW  IND  CAP  L_lo L_hi  C_lo C_hi
          [3] [4]  [5]  [6-7]      [8-9]
```
- `SW` byte: `0` = LC network, `1` = CL network.
- `IND`, `CAP` bytes: relay step codes (0–127). These are what the +/− buttons
  increment; they directly control which relay combination is engaged.
- `L` u16le: inductance × 100 (e.g. 1270 → 12.70 µH). Max 12.7 µH.
- `C` u16le: capacitance in pF. Max 1270 pF.

---

### MEMORY_STATUS (←, cmd 6) — 7 bytes
```
FF 06 04  ID  FREQ_lo FREQ_hi  MAX
          [3] [4-5]            [6]
```
- `ID` byte: active slot (0 = none).
- `FREQ` u16le × 0.001 = frequency in MHz (e.g. 14250 → 14.250 MHz).
- `MAX` byte: total number of available memory slots.

---

### MEMORY_INFO (←, cmd 7) — 13+ bytes
```
FF 07 ..  ID  IND  CAP  L_lo L_hi  C_lo C_hi  F_lo F_hi  SW
          [3] [4]  [5]  [6-7]      [8-9]      [10-11]    [12]
```
One frame per populated slot; sent after `SYNC`.
- `ID`: slot number.
- `IND`, `CAP`: relay codes.
- `L` u16le / 100 = µH; `C` u16le = pF; `F` u16le × 0.001 = MHz.
- `SW`: 0 = LC, else CL.

---

### MEMORY_APPLY (→, cmd 8) — 4 bytes
```
FF 08 01  ID
```
Recall (apply) slot `ID`. Also used as "Undo changes" by re-sending the current
active slot.

---

### MEMORY_ACTION (→, cmd 9) — 4 bytes
```
FF 09 01  ACTION
```
- `ACTION` = `1`: save the current relay state to the active memory slot.

---

### SYSTEM_INFO (←, cmd 13)
```
FF 0D ..  <version string, null-terminated, up to 20 bytes>
```

---

### SYSTEM_REBOOT (→, cmd 19) — 4 bytes
```
FF 13 01  01
```

---

### TEST / TEST_REPLAY (keepalive, cmds 254/253) — 3 bytes each
```
FF FE 00   ← device sends periodically
FF FD 00   → client must reply
```
Failure to reply will cause the device to close the connection.
