#!/usr/bin/env bash
# build.sh — build the ATR-1000 Zeus plugin (Linux / macOS).
#
# Locally this uses the installed Zeus DLL (see Atr1000.csproj default).
# Pass --zeus-contracts to override with a source .csproj for CI or
# if you're on Linux without a Zeus install.
#
# Usage:
#   ./build.sh
#   ./build.sh --skip-ui
#   ./build.sh --configuration Debug
#   ./build.sh --zeus-contracts /path/to/Zeus.Plugins.Contracts.csproj

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="Release"
SKIP_UI=0
ZEUS_CONTRACTS=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --configuration)  CONFIG="$2";         shift 2 ;;
        --skip-ui)         SKIP_UI=1;           shift   ;;
        --zeus-contracts)  ZEUS_CONTRACTS="$2"; shift 2 ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

VERSION=$(python3 -c "import json; print(json.load(open('plugin.json'))['version'])")
echo ""
echo "=== ATR-1000 Zeus plugin  v${VERSION} ==="
echo ""

# ── 1. UI ──────────────────────────────────────────────────────────────────
if [[ $SKIP_UI -eq 0 ]]; then
    echo "--- UI build (npm + vite) ---"
    cd "$SCRIPT_DIR"
    npm install --prefer-offline
    npm run build
else
    echo "--- Skipping UI build ---"
fi

# ── 2. Backend ─────────────────────────────────────────────────────────────
echo ""
echo "--- Backend build (dotnet $CONFIG) ---"
cd "$SCRIPT_DIR"

EXTRA_ARGS=()
if [[ -n "$ZEUS_CONTRACTS" ]]; then
    EXTRA_ARGS+=("/p:ZeusContractsProject=${ZEUS_CONTRACTS}")
fi

dotnet build Atr1000.csproj -c "$CONFIG" "${EXTRA_ARGS[@]}"

# ── 3. Assemble dist/ ───────────────────────────────────────────────────────
echo ""
echo "--- Assembling dist/ ---"
DIST="$SCRIPT_DIR/dist"
BIN="$SCRIPT_DIR/bin/$CONFIG/net10.0"

rm -rf "$DIST"
mkdir -p "$DIST/ui"
cp "$SCRIPT_DIR/plugin.json"       "$DIST/"
cp "$BIN/Atr1000.dll"              "$DIST/"
cp "$SCRIPT_DIR/ui/atr1000.es.js"  "$DIST/ui/"

# ── 4. Zip ──────────────────────────────────────────────────────────────────
ZIP="atr1000-${VERSION}.zip"
rm -f "$SCRIPT_DIR/$ZIP"
cd "$DIST" && zip -r "$SCRIPT_DIR/$ZIP" . && cd "$SCRIPT_DIR"

echo ""
echo "=== Done ==="
echo "File    : $ZIP"
if command -v sha256sum &>/dev/null; then
    echo "SHA-256 : $(sha256sum "$ZIP" | awk '{print $1}')"
elif command -v shasum &>/dev/null; then
    echo "SHA-256 : $(shasum -a 256 "$ZIP" | awk '{print $1}')"
fi
