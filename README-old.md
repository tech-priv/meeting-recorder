# 🎙 Meeting Recorder

Record a Teams (or any) meeting window, transcribe it locally with Whisper on your M4, summarize it with Claude or ChatGPT, and email the notes automatically.

---

## What it does

1. **Picks any open window** (Teams, Zoom, browser, etc.) from a visual grid
2. **Records the window video** via Electron's `desktopCapturer`
3. **Captures system audio** through BlackHole 2ch (Teams audio, not your mic)
4. After stopping: **auto-runs the full pipeline**:
   - 🎤 Transcribes audio locally with Whisper (runs on your M4 Neural Engine, fully private)
   - 🤖 Summarizes with Claude Opus or GPT-4o (your choice per session)
   - 💾 Saves `transcript.txt`, `meeting_notes.md`, `subtitles.srt`, `recording.webm`
   - 📧 Emails the notes to your configured address

---

## Requirements

- macOS (Apple Silicon M-series)
- [Homebrew](https://brew.sh)
- Anthropic and/or OpenAI API keys

---

## Install

```bash
chmod +x setup.sh
./setup.sh
```

The script installs: `ffmpeg`, `blackhole-2ch`, `openai-whisper`, and all Node dependencies.

### ⚠️ BlackHole audio routing (one-time setup)

BlackHole routes Teams audio into the recorder. You must set up a Multi-Output Device once:

1. Open **Audio MIDI Setup** (in `/Applications/Utilities/`)
2. Click **+** → **Create Multi-Output Device**
3. Check both **your speakers** and **BlackHole 2ch**
4. Name it `MeetingOut`
5. Go to **System Settings → Sound → Output** → select `MeetingOut`
6. Now Teams (and all system audio) plays through speakers AND gets captured by the recorder

> To go back to normal audio, just switch Output back to your speakers.

---

## Run

```bash
npm start
```

### First launch permissions

macOS will ask for:
- **Screen Recording** — required to capture the Teams window
- Grant access in **System Settings → Privacy & Security → Screen & System Audio Recording**

---

## Configure (Settings tab)

| Field | Value |
|-------|-------|
| Anthropic API Key | `sk-ant-...` from [console.anthropic.com](https://console.anthropic.com) |
| OpenAI API Key | `sk-...` from [platform.openai.com](https://platform.openai.com) |
| Whisper Model | `base` recommended; `small` or `medium` for better accuracy |
| SMTP Host | `smtp.gmail.com` for Gmail |
| SMTP Port | `587` (TLS) or `465` (SSL) |
| SMTP User | your email address |
| SMTP Password | Gmail: use an **App Password** (not your login password) |
| From / To | sender and recipient email addresses |

### Gmail App Password

1. Go to [myaccount.google.com](https://myaccount.google.com) → Security
2. Enable 2-Step Verification if not already done
3. Search for **App passwords**
4. Create one for "Mail" → copy the 16-char password

---

## Output files

All sessions are saved to `~/MeetingRecorder/meeting-YYYY-MM-DDTHH-MM-SS/`:

```
meeting-2026-02-19T14-30-00/
├── recording.webm     ← screen capture video
├── audio.wav          ← raw audio from BlackHole
├── transcript.txt     ← plain text transcript
├── meeting_notes.md   ← AI-generated structured notes
└── subtitles.srt      ← subtitle file (can be loaded in VLC etc.)
```

---

## Whisper model guide

| Model  | Speed on M4 | Accuracy | Best for |
|--------|-------------|----------|----------|
| tiny   | ~10x RT     | Basic    | Quick tests |
| base   | ~7x RT      | Good     | Most meetings ✅ |
| small  | ~4x RT      | Better   | Technical meetings |
| medium | ~2x RT      | High     | Multi-accent calls |
| large  | ~1x RT      | Best     | Critical recordings |

RT = Real-time. "7x RT" means a 60-min meeting transcribes in ~8 minutes.

---

## Troubleshooting

**No audio in recording**
→ Make sure your system output is set to the `MeetingOut` Multi-Output Device, not just BlackHole directly.

**Screen recording permission denied**
→ System Settings → Privacy & Security → Screen & System Audio Recording → enable for the app.

**Whisper not found**
→ Run `pip3 install openai-whisper` manually.

**Email fails**
→ Double-check SMTP credentials. For Gmail, use an App Password, not your account password. Try port 587.

**Electron app doesn't show Teams window**
→ Click "Refresh Windows" with Teams already open. Teams must be running and not minimized to the Dock.
