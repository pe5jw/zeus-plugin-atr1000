param(
    [string] $ZeusInstallDir = "",
    [string] $Configuration  = "Release",
    [switch] $SkipUi
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root    = $PSScriptRoot
$Dist    = Join-Path $Root "dist"
$Version = (Get-Content (Join-Path $Root "plugin.json") | ConvertFrom-Json).version

Write-Host ""
Write-Host "=== ATR-1000 Zeus plugin  v$Version ===" -ForegroundColor Cyan
Write-Host ""

# --- 1. UI (Vite) ---
if (-not $SkipUi) {
    Write-Host "--- UI build (npm + vite) ---" -ForegroundColor Yellow
    Push-Location $Root
    try {
        npm install --prefer-offline
        if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
        npm run build
        if ($LASTEXITCODE -ne 0) { throw "vite build failed" }
    } finally { Pop-Location }
} else {
    Write-Host "--- Skipping UI build ---" -ForegroundColor DarkGray
}

# --- 2. Backend (.NET) ---
Write-Host ""
Write-Host "--- Backend build (dotnet $Configuration) ---" -ForegroundColor Yellow

$ExtraArgs = @()
if ($ZeusInstallDir -ne "") {
    $ExtraArgs += "/p:ZeusInstallDir=$ZeusInstallDir"
}

dotnet build "$Root\Atr1000.csproj" -c $Configuration @ExtraArgs
if ($LASTEXITCODE -ne 0) { throw "dotnet build failed" }

# --- 3. Assemble dist/ ---
Write-Host ""
Write-Host "--- Assembling dist/ ---" -ForegroundColor Yellow

$BinDir = Join-Path $Root "bin\$Configuration\net10.0"

Remove-Item $Dist -Recurse -Force -ErrorAction SilentlyContinue
New-Item $Dist -ItemType Directory | Out-Null

Copy-Item (Join-Path $Root "plugin.json")   $Dist
Copy-Item (Join-Path $BinDir "Atr1000.dll") $Dist

if (-not $SkipUi) {
    New-Item (Join-Path $Dist "ui") -ItemType Directory | Out-Null
    Copy-Item (Join-Path $Root "ui\atr1000.es.js") (Join-Path $Dist "ui")
} else {
    Write-Host "  (ui\atr1000.es.js skipped - run without -SkipUi for full build)"
}

# --- 4. Zip ---
$ZipName = "atr1000-$Version.zip"
$ZipPath = Join-Path $Root $ZipName
Remove-Item $ZipPath -Force -ErrorAction SilentlyContinue
Compress-Archive -Path "$Dist\*" -DestinationPath $ZipPath

Write-Host ""
Write-Host "=== Done ===" -ForegroundColor Green
Write-Host "File    : $ZipName"

$Hash = (Get-FileHash $ZipPath -Algorithm SHA256).Hash.ToLower()
Write-Host "SHA-256 : $Hash" -ForegroundColor Cyan
Write-Host ""
Write-Host "Install : Zeus -> Plugins -> Install from file -> $ZipName"
