#!/usr/bin/env bash
# build.sh — build the ATR-1000 Zeus plugin and package it as a zip.
#
# Usage:
#   ./build.sh
#   ./build.sh --zeus-repo /path/to/openhpsdr-zeus
#   ./build.sh --skip-ui
#   ./build.sh --configuration Debug
#
# Environment:
#   ZEUS_CONTRACTS_PROJECT — full path to Zeus.Plugins.Contracts.csproj
#                            (alternative to --zeus-repo)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ZEUS_REPO="../openhpsdr-zeus"
CONFIG="Release"
SKIP_UI=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --zeus-repo)       ZEUS_REPO="$2"; shift 2 ;;
        --configuration)   CONFIG="$2";    shift 2 ;;
        --skip-ui)         SKIP_UI=1;      shift   ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

VERSION=$(python3 -c "import json,sys; print(json.load(open('plugin.json'))['version'])")
echo ""
echo "=== ATR-1000 Zeus plugin — build v${VERSION} ==="
echo ""

# ── 1. UI ──────────────────────────────────────────────────────────────────
if [[ $SKIP_UI -eq 0 ]]; then
    echo "--- Building UI (npm + vite) ---"
    cd "$SCRIPT_DIR"
    npm install --prefer-offline
    npm run build
else
    echo "--- Skipping UI build (--skip-ui) ---"
fi

# ── 2. Backend ─────────────────────────────────────────────────────────────
echo ""
echo "--- Building backend (dotnet $CONFIG) ---"

if [[ -n "${ZEUS_CONTRACTS_PROJECT:-}" ]]; then
    CONTRACTS="$ZEUS_CONTRACTS_PROJECT"
else
    CONTRACTS="$(realpath "${ZEUS_REPO}")/Zeus.Plugins.Contracts/Zeus.Plugins.Contracts.csproj"
fi

if [[ ! -f "$CONTRACTS" ]]; then
    echo "ERROR: Zeus.Plugins.Contracts not found at:"
    echo "  $CONTRACTS"
    echo ""
    echo "Clone openhpsdr-zeus next to this repo, or pass:"
    echo "  ./build.sh --zeus-repo /path/to/openhpsdr-zeus"
    exit 1
fi

cd "$SCRIPT_DIR"
dotnet build Atr1000.csproj \
    -c "$CONFIG" \
    "/p:ZeusContractsProject=${CONTRACTS}"

# ── 3. Assemble dist ────────────────────────────────────────────────────────
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
cd "$DIST"
zip -r "$SCRIPT_DIR/$ZIP" .
cd "$SCRIPT_DIR"

echo ""
echo "=== Done: $ZIP ==="
echo ""

# Print SHA-256 for registry-entry.json.
if command -v sha256sum &>/dev/null; then
    HASH=$(sha256sum "$ZIP" | awk '{print $1}')
elif command -v shasum &>/dev/null; then
    HASH=$(shasum -a 256 "$ZIP" | awk '{print $1}')
else
    HASH="(sha256sum / shasum not found — compute manually)"
fi
echo "SHA-256 : $HASH"
echo ""
echo "Paste that hash into registry-entry.json -> versions[0].sha256"
