#!/bin/bash
# Meeting Recorder — One-time setup script for macOS (Apple Silicon)
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo ""
echo "🎙  Meeting Recorder — Setup"
echo "=============================="
echo ""

# ── Check Homebrew ──────────────────────────────────────────────────────────
if ! command -v brew &>/dev/null; then
  echo -e "${RED}✗ Homebrew not found.${NC}"
  echo "  Install it first: https://brew.sh"
  exit 1
fi
echo -e "${GREEN}✓ Homebrew found${NC}"

# ── ffmpeg ──────────────────────────────────────────────────────────────────
if ! command -v ffmpeg &>/dev/null; then
  echo "  Installing ffmpeg..."
  brew install ffmpeg
else
  echo -e "${GREEN}✓ ffmpeg found${NC}"
fi

# ── BlackHole 2ch ────────────────────────────────────────────────────────────
if ! system_profiler SPAudioDataType 2>/dev/null | grep -q "BlackHole 2ch"; then
  echo ""
  echo -e "${YELLOW}⚠  BlackHole 2ch not detected.${NC}"
  echo "  Installing BlackHole audio driver..."
  brew install blackhole-2ch
  echo ""
  echo -e "${YELLOW}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${YELLOW}║  ACTION REQUIRED — Configure audio routing in macOS          ║${NC}"
  echo -e "${YELLOW}║                                                              ║${NC}"
  echo -e "${YELLOW}║  1. Open 'Audio MIDI Setup' (in /Applications/Utilities/)   ║${NC}"
  echo -e "${YELLOW}║  2. Click '+' → 'Create Multi-Output Device'                ║${NC}"
  echo -e "${YELLOW}║  3. Check both your speakers AND 'BlackHole 2ch'            ║${NC}"
  echo -e "${YELLOW}║  4. Name it 'MeetingOut'                                    ║${NC}"
  echo -e "${YELLOW}║  5. In System Settings → Sound → Output → select 'MeetingOut'║${NC}"
  echo -e "${YELLOW}║  6. Teams audio will now go to speakers + BlackHole          ║${NC}"
  echo -e "${YELLOW}╚══════════════════════════════════════════════════════════════╝${NC}"
  echo ""
  echo "  Press Enter when done to continue setup..."
  read -r
else
  echo -e "${GREEN}✓ BlackHole 2ch detected${NC}"
fi

# ── Node.js ─────────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo "  Installing Node.js..."
  brew install node
else
  echo -e "${GREEN}✓ Node.js $(node --version) found${NC}"
fi

# ── Python + Whisper ─────────────────────────────────────────────────────────
if ! command -v python3 &>/dev/null; then
  echo -e "${RED}✗ Python3 not found. Installing...${NC}"
  brew install python
fi
echo -e "${GREEN}✓ Python $(python3 --version) found${NC}"

if ! python3 -c "import whisper" &>/dev/null; then
  echo "  Installing openai-whisper (this may take a few minutes)..."
  pip3 install openai-whisper
else
  echo -e "${GREEN}✓ openai-whisper already installed${NC}"
fi

# ── npm install ─────────────────────────────────────────────────────────────
echo ""
echo "  Installing Node dependencies..."
npm install

echo ""
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo -e "${GREEN}✓ Setup complete!${NC}"
echo ""
echo "  Start the app:"
echo -e "  ${YELLOW}npm start${NC}"
echo ""
echo "  Then:"
echo "  1. Go to ⚙️  Settings and add your API keys"
echo "  2. Configure SMTP email"
echo "  3. Select a window and hit Record!"
echo ""
