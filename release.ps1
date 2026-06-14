<#
.SYNOPSIS
  Prepare and push a new release of the ATR-1000 Zeus plugin to GitHub.

.DESCRIPTION
  1. Verifies the working directory is clean enough to release.
  2. Builds the full plugin (UI + backend).
  3. Commits all source changes to main.
  4. Tags the commit with the version from plugin.json.
  5. Pushes main + tag to GitHub.
  6. The GitHub Actions workflow then builds the release zip and
     attaches it to the GitHub Release automatically.

.PARAMETER ZeusInstallDir
  Path to the installed Zeus application folder (for the contracts DLL).
  Default: C:\Users\joeri\AppData\Local\Programs\OpenHPSDR-Zeus

.PARAMETER DryRun
  Show what would happen without actually pushing or tagging.

.EXAMPLE
  .\release.ps1
  .\release.ps1 -DryRun
#>
param(
    [string] $ZeusInstallDir = "",
    [switch] $DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root    = $PSScriptRoot
$Version = (Get-Content (Join-Path $Root "plugin.json") | ConvertFrom-Json).version
$Tag     = "v$Version"

Write-Host ""
Write-Host "=== ATR-1000 Zeus plugin  release $Tag ===" -ForegroundColor Cyan
if ($DryRun) { Write-Host "  DRY RUN — nothing will be pushed" -ForegroundColor Yellow }
Write-Host ""

# --- 1. Check we are in a git repo on main ---
Push-Location $Root
try {
    $branch = git rev-parse --abbrev-ref HEAD 2>&1
    if ($branch -ne "main") {
        Write-Warning "Current branch is '$branch', not 'main'. Switch to main first."
        exit 1
    }

    $existing = git tag --list $Tag
    if ($existing -and -not $DryRun) {
        Write-Error "Tag $Tag already exists. Bump the version in plugin.json first."
    }

    # --- 2. Build ---
    Write-Host "--- Building plugin (UI + backend) ---" -ForegroundColor Yellow
    $buildArgs = @()
    if ($ZeusInstallDir -ne "") { $buildArgs += "-ZeusInstallDir"; $buildArgs += $ZeusInstallDir }
    & powershell -ExecutionPolicy Bypass -File "$Root\build.ps1" @buildArgs
    if ($LASTEXITCODE -ne 0) { throw "Build failed" }

    # --- 3. Stage all source files (exclude build outputs) ---
    Write-Host ""
    Write-Host "--- Staging source files ---" -ForegroundColor Yellow

    $sourceFiles = @(
        ".github\workflows\build.yml",
        ".gitignore",
        "Atr1000.csproj",
        "Atr1000Plugin.cs",
        "CHANGELOG.md",
        "LICENSE",
        "PROTOCOL.md",
        "README.md",
        "build.ps1",
        "build.sh",
        "package.json",
        "plugin.json",
        "registry-entry.json",
        "tsconfig.json",
        "vite.config.ts",
        "ui\atr1000.tsx",
        "tools\atr_probe.py"
    )

    foreach ($f in $sourceFiles) {
        $full = Join-Path $Root $f
        if (Test-Path $full) {
            git add $full
            Write-Host "  staged: $f"
        } else {
            Write-Warning "  missing: $f"
        }
    }

    # --- 4. Commit ---
    $status = git status --porcelain
    if ($status) {
        Write-Host ""
        Write-Host "--- Committing ---" -ForegroundColor Yellow
        $msg = "Release $Tag"
        if ($DryRun) {
            Write-Host "  (dry run) would commit: $msg"
        } else {
            git commit -m $msg
        }
    } else {
        Write-Host "  Nothing to commit — working tree clean"
    }

    # --- 5. Tag ---
    Write-Host ""
    Write-Host "--- Tagging $Tag ---" -ForegroundColor Yellow
    if ($DryRun) {
        Write-Host "  (dry run) would tag: $Tag"
    } else {
        git tag $Tag
        Write-Host "  tagged: $Tag"
    }

    # --- 6. Push ---
    Write-Host ""
    Write-Host "--- Pushing to GitHub ---" -ForegroundColor Yellow
    if ($DryRun) {
        Write-Host "  (dry run) would push: main + $Tag"
    } else {
        git push origin main
        git push origin $Tag
        Write-Host ""
        Write-Host "=== Done ===" -ForegroundColor Green
        Write-Host "GitHub Actions is now building the release zip."
        Write-Host "Check: https://github.com/pe5jw/zeus-plugin-atr1000/releases/tag/$Tag"
        Write-Host ""
        Write-Host "Once the zip is attached, copy the SHA-256 from the release notes"
        Write-Host "into registry-entry.json -> versions[0].sha256"
    }
} finally {
    Pop-Location
}
