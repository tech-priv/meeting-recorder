# setup-windows.ps1
# =================
# One-command setup script for Meeting Recorder on Windows 11.
#
# Run from an elevated (Administrator) PowerShell prompt:
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#   .\setup-windows.ps1
#
# What this script does:
#   1. Installs Chocolatey (Windows package manager) if not present
#   2. Installs Node.js LTS, Python 3, ffmpeg, VB-Audio Virtual Cable
#   3. Installs Python packages: openai-whisper, torch (CPU build)
#   4. Installs Node.js dependencies (npm install)
#   5. Prints a summary of what still needs manual attention
#
# Audio note (Windows equivalent of BlackHole on macOS):
#   VB-Audio Virtual Cable creates a "CABLE Input/Output" loopback device.
#   In Windows Sound settings, set your meeting app to output to "CABLE Input",
#   and configure Meeting Recorder to record from "CABLE Output".
#   Free download: https://vb-audio.com/Cable/

$ErrorActionPreference = "Stop"
$ProgressPreference    = "SilentlyContinue"   # speeds up Invoke-WebRequest

Write-Host ""
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "  Meeting Recorder — Windows Setup    " -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

# ── Helper: print a section header ───────────────────────────────────────────
function Section($title) {
    Write-Host ""
    Write-Host "── $title" -ForegroundColor Yellow
}

# ── Helper: check if a command exists ────────────────────────────────────────
function CommandExists($cmd) {
    return [bool](Get-Command $cmd -ErrorAction SilentlyContinue)
}

# ── 1. Chocolatey ─────────────────────────────────────────────────────────────
Section "Chocolatey (package manager)"
if (-not (CommandExists choco)) {
    Write-Host "Installing Chocolatey…"
    Set-ExecutionPolicy Bypass -Scope Process -Force
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
    Invoke-Expression ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
    # Reload PATH so choco is available in this session
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("PATH", "User")
    Write-Host "Chocolatey installed." -ForegroundColor Green
} else {
    Write-Host "Chocolatey already installed — skipping." -ForegroundColor Green
}

# ── 2. Node.js LTS ────────────────────────────────────────────────────────────
Section "Node.js LTS"
if (-not (CommandExists node)) {
    Write-Host "Installing Node.js LTS via Chocolatey…"
    choco install nodejs-lts -y
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("PATH", "User")
    Write-Host "Node.js installed." -ForegroundColor Green
} else {
    $nodeVer = node --version
    Write-Host "Node.js already installed: $nodeVer — skipping." -ForegroundColor Green
}

# ── 3. Python 3 ───────────────────────────────────────────────────────────────
Section "Python 3"
if (-not (CommandExists python)) {
    Write-Host "Installing Python 3 via Chocolatey…"
    choco install python3 -y
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("PATH", "User")
    Write-Host "Python 3 installed." -ForegroundColor Green
} else {
    $pyVer = python --version
    Write-Host "Python already installed: $pyVer — skipping." -ForegroundColor Green
}

# ── 4. ffmpeg ─────────────────────────────────────────────────────────────────
Section "ffmpeg"
if (-not (CommandExists ffmpeg)) {
    Write-Host "Installing ffmpeg via Chocolatey…"
    choco install ffmpeg -y
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("PATH", "User")
    Write-Host "ffmpeg installed." -ForegroundColor Green
} else {
    Write-Host "ffmpeg already installed — skipping." -ForegroundColor Green
}

# ── 5. VB-Audio Virtual Cable (audio loopback device) ────────────────────────
Section "VB-Audio Virtual Cable"
# Check if the driver is already installed by looking for the device in registry
$vbInstalled = Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*" `
               -ErrorAction SilentlyContinue |
               Where-Object { $_.DisplayName -like "*VB-Audio*" }
if (-not $vbInstalled) {
    Write-Host "Downloading VB-Audio Virtual Cable installer…"
    $vbUrl     = "https://download.vb-audio.com/Download_CABLE/VBCABLE_Driver_Pack43.zip"
    $vbZip     = "$env:TEMP\vbcable.zip"
    $vbDir     = "$env:TEMP\vbcable"
    Invoke-WebRequest -Uri $vbUrl -OutFile $vbZip
    Expand-Archive -Path $vbZip -DestinationPath $vbDir -Force
    # The installer must be run interactively with UAC — launch it for the user
    Write-Host ""
    Write-Host "IMPORTANT: The VB-Audio installer window will open." -ForegroundColor Magenta
    Write-Host "Click 'Install Driver' and accept the UAC prompt." -ForegroundColor Magenta
    Write-Host "A reboot may be required after installation." -ForegroundColor Magenta
    Write-Host ""
    Start-Process "$vbDir\VBCABLE_Setup_x64.exe" -Wait
    Write-Host "VB-Audio installation complete." -ForegroundColor Green
} else {
    Write-Host "VB-Audio Virtual Cable already installed — skipping." -ForegroundColor Green
}

# ── 6. Python packages: openai-whisper + PyTorch CPU ─────────────────────────
Section "Python packages (Whisper + PyTorch CPU)"
Write-Host "Upgrading pip…"
python -m pip install --upgrade pip --quiet

# Install PyTorch CPU-only build first (smaller download, no CUDA needed)
Write-Host "Installing PyTorch (CPU build)…"
python -m pip install torch torchvision torchaudio `
    --index-url https://download.pytorch.org/whl/cpu --quiet

Write-Host "Installing openai-whisper…"
python -m pip install openai-whisper --quiet

Write-Host "Python packages installed." -ForegroundColor Green

# ── 7. Node.js dependencies ───────────────────────────────────────────────────
Section "Node.js dependencies (npm install)"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
if (Test-Path "$scriptDir\package.json") {
    Write-Host "Running npm install in $scriptDir …"
    Push-Location $scriptDir
    npm install
    Pop-Location
    Write-Host "npm install complete." -ForegroundColor Green
} else {
    Write-Host "package.json not found in $scriptDir — run 'npm install' manually." -ForegroundColor Yellow
}

# ── Summary ───────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "  Setup complete!                     " -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Reboot if VB-Audio prompted for one."
Write-Host "  2. In Windows Sound settings:"
Write-Host "     - Set your meeting app (Teams/Zoom) to output to 'CABLE Input'"
Write-Host "     - Meeting Recorder will record from 'CABLE Output'"
Write-Host "  3. Start the app:  npm start"
Write-Host "  4. To build a Windows installer:  npm run build:win"
Write-Host ""
