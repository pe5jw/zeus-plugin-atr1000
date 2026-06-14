#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-or-later
"""
atr_probe.py — interrogate an Antuner ATR-1000 to learn its WiFi protocol.

The ATR-1000 web UI is HTML5 + WebSocket, but Antuner doesn't publish the
frame format. This script captures everything needed to fill in the Zeus
plugin's PROTOCOL ADAPTER:

  1. Downloads the device home page and every JS/CSS asset it references,
     then greps the JS for the WebSocket URL and the message keys the
     firmware uses (this alone often reveals the whole protocol).
  2. Probes a handful of likely HTTP endpoints (GET only).
  3. Opens the WebSocket and dumps every frame the device pushes
     (pretty-printed when JSON), for a configurable number of seconds.

Everything is also written to  ./atr_probe_out/transcript.txt  so you can
paste it back and have the adapter wired up exactly.

SAFETY
------
By default this tool is READ-ONLY: it listens and downloads, and never sends
a command that could key relays or start a tune cycle. The optional --poke
flag sends ONE benign status/sync request (still no tuning). Do not point the
--send option at a transmitting station.

USAGE
-----
    pip install websockets
    python3 atr_probe.py 192.168.2.124
    python3 atr_probe.py 192.168.2.124 --seconds 30
    python3 atr_probe.py 192.168.2.124 --ws-path /ws --poke
    python3 atr_probe.py 192.168.2.124 --send '{"cmd":"sync"}'   # advanced, manual

Tip: also do the same capture by hand in Chrome DevTools -> Network -> "WS"
-> Messages. Comparing the two is the surest way to nail the format.
"""

import argparse
import asyncio
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

OUTDIR = "atr_probe_out"
_LOG_FH = None


# ── logging ────────────────────────────────────────────────────────────────

def log(msg=""):
    print(msg)
    if _LOG_FH:
        _LOG_FH.write(msg + "\n")
        _LOG_FH.flush()


def section(title):
    log("\n" + "=" * 72)
    log(title)
    log("=" * 72)


# ── HTTP ─────────────────────────────────────────────────────────────────

def http_get(url, timeout=6):
    """Return (status, content_type, body_bytes) or (None, None, error_str)."""
    req = urllib.request.Request(url, headers={"User-Agent": "atr-probe/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.headers.get("Content-Type", ""), r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("Content-Type", "") if e.headers else "", e.read() if e.fp else b""
    except Exception as e:  # noqa: BLE001
        return None, None, str(e).encode()


def safe_name(url):
    name = re.sub(r"[^A-Za-z0-9._-]", "_", url.split("?")[0].split("/")[-1] or "index")
    return name[-80:] or "asset"


def fetch_index_and_assets(base):
    """Download the home page and every same-origin JS/CSS it references."""
    section("1. WEB PAGE + ASSETS")
    root = f"http://{base}/"
    status, ctype, body = http_get(root)
    log(f"GET {root}  ->  {status}  {ctype}")
    if status is None:
        log(f"  ! could not reach device: {body.decode(errors='replace')}")
        return []

    html = body.decode(errors="replace")
    with open(os.path.join(OUTDIR, "index.html"), "w", encoding="utf-8") as f:
        f.write(html)
    log(f"  saved index.html ({len(html)} bytes)")

    # Collect script/link/style references plus inline scripts.
    refs = set()
    refs |= set(re.findall(r'<script[^>]+src=["\']([^"\']+)["\']', html, re.I))
    refs |= set(re.findall(r'<link[^>]+href=["\']([^"\']+\.(?:js|css|json))["\']', html, re.I))
    # Vite/webpack often inject module preloads:
    refs |= set(re.findall(r'(?:href|src)=["\']([^"\']+\.(?:js|mjs|css|json))["\']', html, re.I))

    inline = "\n".join(re.findall(r"<script[^>]*>(.*?)</script>", html, re.I | re.S))
    if inline.strip():
        with open(os.path.join(OUTDIR, "inline.js"), "w", encoding="utf-8") as f:
            f.write(inline)
        log("  saved inline.js (inline <script> blocks)")

    saved = ["index.html", "inline.js"] if inline.strip() else ["index.html"]
    for ref in sorted(refs):
        if ref.startswith("//"):
            url = "http:" + ref
        elif ref.startswith("http"):
            url = ref
        else:
            url = root.rstrip("/") + "/" + ref.lstrip("/")
        st, ct, b = http_get(url)
        if st == 200 and b:
            fn = safe_name(url)
            with open(os.path.join(OUTDIR, fn), "wb") as f:
                f.write(b)
            saved.append(fn)
            log(f"  GET {url}  ->  {st}  ({len(b)} bytes -> {fn})")
        else:
            log(f"  GET {url}  ->  {st}")
    return saved


def scan_assets_for_protocol(saved):
    """Grep downloaded text for the WS URL and likely message keys."""
    section("2. PROTOCOL HINTS FOUND IN THE FRONTEND CODE")
    blob = ""
    for fn in saved:
        p = os.path.join(OUTDIR, fn)
        try:
            with open(p, "r", encoding="utf-8", errors="replace") as f:
                blob += "\n" + f.read()
        except OSError:
            pass

    ws_urls = sorted(set(re.findall(r'(wss?://[^\s"\'`]+)', blob)))
    ws_paths = sorted(set(re.findall(r'new\s+WebSocket\(\s*[`"\']([^`"\']+)', blob)))
    # Template-literal WS like `ws://${location.host}/ws`
    tmpl = sorted(set(re.findall(r'`(wss?://[^`]+)`', blob)))
    keys = sorted(set(re.findall(r'\bcmd\b|\bswr\b|\bvswr\b|\bfwd\b|\bpwr\b|\btune\b|'
                                  r'\bbypass\b|\bmemory\b|\bnetwork\b|\bind\b|\bcap\b',
                                  blob, re.I)))
    candidates = sorted(set(re.findall(r'["\']([a-zA-Z_][a-zA-Z0-9_]{1,20})["\']\s*:', blob)))

    found = False
    if ws_urls or tmpl:
        found = True
        log("WebSocket URL(s):")
        for u in ws_urls + tmpl:
            log(f"  {u}")
    if ws_paths:
        found = True
        log("new WebSocket(path):")
        for p in ws_paths:
            log(f"  {p}")
    if keys:
        log("\nProtocol-ish tokens present: " + ", ".join(keys))
    if candidates:
        log("\nJSON-style keys seen in code (first 60):")
        log("  " + ", ".join(candidates[:60]))
    if not found:
        log("No literal WebSocket URL found in code (it may be built at runtime,")
        log("e.g. `ws://${location.host}/ws`). Fall back to the live sniff below,")
        log("and to Chrome DevTools -> Network -> WS.")


def probe_http_endpoints(base):
    section("3. HTTP ENDPOINT PROBE (GET only)")
    paths = ["/status", "/api", "/api/status", "/info", "/state", "/config",
             "/data", "/json", "/get", "/system", "/version", "/ws"]
    for path in paths:
        url = f"http://{base}{path}"
        st, ct, b = http_get(url, timeout=4)
        snippet = ""
        if b:
            txt = b.decode(errors="replace").strip().replace("\n", " ")
            snippet = "  " + txt[:120] + ("…" if len(txt) > 120 else "")
        log(f"GET {path:<14} -> {st}  {ct or ''}{snippet}")


# ── WebSocket sniff ─────────────────────────────────────────────────────────

# Command codes decoded from the device web app (inline.js).
_ATR_CMDS = {
    1: "SYNC", 2: "METER", 3: "TUNE_STATUS", 4: "TUNE_MODE", 5: "RELAY",
    6: "MEMORY_STATUS", 7: "MEMORY_INFO", 8: "MEMORY_APPLY", 9: "MEMORY_ACTION",
    10: "MEMORY_FREQ", 11: "WIFI_INFO", 13: "SYSTEM_INFO", 14: "INTERNET_STATUS",
    18: "OTA", 19: "REBOOT", 20: "CUSTOM_INFO", 253: "TEST_REPLAY", 254: "TEST",
}


def _u16le(b, i):
    return b[i] | (b[i + 1] << 8) if i + 1 < len(b) else 0


def decode_atr_frame(b):
    """Human-readable summary of an ATR-1000 binary frame, or '' if not one."""
    if len(b) < 3 or b[0] != 0xFF:
        return ""
    cmd = b[1]
    name = _ATR_CMDS.get(cmd, f"cmd{cmd}")
    if cmd == 2 and len(b) >= 10:           # METER
        swr = _u16le(b, 4)
        swr = round(swr / 100, 2) if swr >= 100 else swr
        return f"{name}  SWR={swr}  FWD={_u16le(b, 6)}W  MAXFWD={_u16le(b, 8)}W"
    if cmd == 5 and len(b) >= 10:           # RELAY
        sw = "LC" if b[3] == 0 else "CL"
        return (f"{name}  net={sw}  indCode={b[4]} capCode={b[5]}  "
                f"L={_u16le(b, 6)/100}uH C={_u16le(b, 8)}pF")
    if cmd == 6 and len(b) >= 7:            # MEMORY_STATUS
        return f"{name}  slot={b[3]}  freq={round(_u16le(b,4)*0.001,3)}MHz  maxSlots={b[6]}"
    if cmd == 4 and len(b) >= 4:            # TUNE_MODE echo
        return f"{name}  mode={b[3]} (0=reset 1=mem 2=full 3=fine)"
    if cmd == 13:                            # SYSTEM_INFO
        s = bytes(b[3:]).split(b"\x00", 1)[0].decode(errors="replace")
        return f"{name}  version={s!r}"
    return name


async def ws_sniff(base, paths, seconds, poke, send_raw):
    section("4. LIVE WEBSOCKET FRAMES")
    try:
        import websockets  # lazy import so --help works without the package
    except ImportError:
        log("! The 'websockets' package is not installed. Run:  pip install websockets")
        log("  (HTTP results above are still valid.)")
        return

    for path in paths:
        uri = f"ws://{base}{path}"
        log(f"\n--- trying {uri} ---")
        try:
            async with websockets.connect(uri, open_timeout=6, max_size=None,
                                          ping_interval=None) as ws:
                log(f"connected: {uri}")

                # ATR-1000 binary protocol (decoded from the device web app):
                # frame = [0xFF, cmd, len, payload...]. The device stays silent
                # until it receives SYNC (FF 01 00); the web app sends it ~500ms
                # after open. SYNC is read-only (it just asks the device to
                # report) — it does NOT tune or key relays.
                SYNC = bytes([0xFF, 0x01, 0x00])
                TEST_REPLAY = bytes([0xFF, 0xFD, 0x00])  # answer to device keepalive (cmd 254)

                if send_raw:
                    log(f"-> sending (manual): {send_raw}")
                    await ws.send(send_raw)
                else:
                    await asyncio.sleep(0.5)
                    log(f"-> SYNC {SYNC.hex(' ')}")
                    await ws.send(SYNC)

                deadline = time.monotonic() + seconds
                n = 0
                while time.monotonic() < deadline:
                    try:
                        remaining = max(0.1, deadline - time.monotonic())
                        frame = await asyncio.wait_for(ws.recv(), timeout=remaining)
                    except asyncio.TimeoutError:
                        break
                    except Exception as e:  # noqa: BLE001
                        log(f"recv ended: {e}")
                        break
                    n += 1
                    ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
                    if isinstance(frame, (bytes, bytearray)):
                        b = bytes(frame)
                        decoded = decode_atr_frame(b)
                        # keep keepalive alive so the stream doesn't drop
                        if len(b) >= 2 and b[0] == 0xFF and b[1] == 254:
                            await ws.send(TEST_REPLAY)
                        log(f"[{ts}] {b[:48].hex(' ')}{'  ' + decoded if decoded else ''}")
                    else:
                        log(f"[{ts}] text: {frame}")
                log(f"\ncaptured {n} frame(s) on {uri}")
                if n:
                    return  # got data on this path; no need to try others
        except Exception as e:  # noqa: BLE001
            log(f"connect failed: {type(e).__name__}: {e}")

    log("\nNo frames captured on any path. Try: confirm the IP, that WiFi remote")
    log("is ON (device [Remote] screen), or read the WS path from section 2 /")
    log("Chrome DevTools and pass it with --ws-path.")


# ── main ─────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description="Probe an Antuner ATR-1000 to learn its protocol.")
    ap.add_argument("host", help="device address, e.g. 192.168.2.124 (optionally host:port)")
    ap.add_argument("--seconds", type=int, default=20, help="WS listen duration (default 20)")
    ap.add_argument("--ws-path", default=None, help="force a WebSocket path (e.g. /ws)")
    ap.add_argument("--poke", action="store_true",
                    help="send benign status/sync requests (no tuning, no relays)")
    ap.add_argument("--send", default=None,
                    help="advanced: send one exact raw frame you specify, then listen")
    ap.add_argument("--no-http", action="store_true", help="skip the HTTP steps")
    ap.add_argument("--no-ws", action="store_true", help="skip the WebSocket sniff")
    args = ap.parse_args()

    os.makedirs(OUTDIR, exist_ok=True)
    global _LOG_FH
    _LOG_FH = open(os.path.join(OUTDIR, "transcript.txt"), "w", encoding="utf-8")

    log(f"ATR-1000 probe — {datetime.now(timezone.utc).isoformat()}")
    log(f"target: {args.host}")
    log(f"output: ./{OUTDIR}/  (full transcript in transcript.txt)")

    ws_paths_from_code = []
    ws_port_from_code = None
    if not args.no_http:
        saved = fetch_index_and_assets(args.host)
        if saved:
            scan_assets_for_protocol(saved)
            blob = ""
            for fn in saved:
                try:
                    with open(os.path.join(OUTDIR, fn), encoding="utf-8", errors="replace") as f:
                        blob += f.read()
                except OSError:
                    pass
            for m in re.findall(r'wss?://[^\s"\'`]*?(/[A-Za-z0-9_./-]*)', blob):
                if m and m not in ws_paths_from_code:
                    ws_paths_from_code.append(m)
            port_hits = re.findall(r'wss?://[^\s"\'`]*?:(\d{2,5})', blob)
            if port_hits:
                ws_port_from_code = port_hits[0]
                log(f"\nWebSocket port found in code: {ws_port_from_code}")
        probe_http_endpoints(args.host)

    if not args.no_ws:
        # If the user gave a bare IP but the code revealed a port (e.g. 60001),
        # use it. An explicit host:port in the arg always wins.
        base = args.host
        if ":" not in base and ws_port_from_code:
            base = f"{base}:{ws_port_from_code}"
            log(f"using WebSocket endpoint host: {base}")

        if args.ws_path:
            paths = [args.ws_path]
        else:
            # Anything discovered in the frontend code first, then guesses.
            paths = ["/", "/ws", "/websocket", "/ws/", "/socket"]
            for p in ws_paths_from_code:
                if p in paths:
                    paths.remove(p)
                paths.insert(0, p)
        asyncio.run(ws_sniff(base, paths, args.seconds, args.poke, args.send))

    section("DONE")
    log(f"Share ./{OUTDIR}/transcript.txt (and any *.js saved) to finish the adapter.")
    if _LOG_FH:
        _LOG_FH.close()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
