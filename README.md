# 🎙 Meeting Recorder

> Record any meeting window, transcribe it privately on your Mac, summarize it with AI, and email the notes automatically.

Built for **macOS Apple Silicon (M-series)**. Uses Electron for the UI, local Whisper for transcription, and Claude or ChatGPT for meeting notes.

---

## Table of Contents

- [How it works](#how-it-works)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [BlackHole audio routing](#blackhole-audio-routing-one-time-setup)
- [Configuration](#configuration)
- [Running the app](#running-the-app)
- [Usage walkthrough](#usage-walkthrough)
- [Example scenarios](#example-scenarios)
- [Token usage estimates](#token-usage-estimates)
- [Privacy & data security](#privacy--data-security)
- [Output files](#output-files)
- [Whisper model guide](#whisper-model-guide)
- [Troubleshooting](#troubleshooting)

---

## How it works

```
Teams window  ──► Electron desktopCapturer ──► recording.webm
BlackHole 2ch ──► ffmpeg audio capture    ──► audio.wav
                                                    │
                                              Local Whisper
                                            (on your M4 chip)
                                                    │
                                              transcript.txt
                                              subtitles.srt
                                                    │
                                          Claude API / GPT-4o
                                            (cloud call only
                                             for this step)
                                                    │
                                            meeting_notes.md
                                                    │
                                           SMTP email → you
```

Only the **summarization step** sends data to the cloud. Everything else — recording, audio capture, and transcription — happens entirely on your machine.

---

## Prerequisites

### Required software

| Requirement | Version | Notes |
|---|---|---|
| macOS | Sequoia (15) or later | Tested on Tahoe / M4 |
| [Homebrew](https://brew.sh) | any | Package manager |
| Node.js | 18+ | Via Homebrew or nodejs.org |
| Python | 3.9+ | Usually pre-installed on macOS |
| ffmpeg | any recent | Installed by `setup.sh` |
| BlackHole 2ch | 0.6+ | Installed by `setup.sh` |

### Required accounts / API keys

You need **at least one** of these:

| Provider | Where to get a key | Used for |
|---|---|---|
| Anthropic | [console.anthropic.com](https://console.anthropic.com) | Claude Opus summarization |
| OpenAI | [platform.openai.com](https://platform.openai.com) | GPT-4o summarization |

Both keys are optional — only the one you select at recording time is needed.

### macOS permissions (granted on first launch)

- **Screen Recording** — to capture the meeting window
- **Microphone** — optional, only if capturing your own mic in addition to BlackHole

---

## Installation

```bash
# 1. Unzip the project
unzip meetingrecorder.zip
cd meetingrecorder

# 2. Run the one-time setup script
chmod +x setup.sh
./setup.sh
```

The `setup.sh` script automatically:

1. Checks for Homebrew
2. Installs `ffmpeg` if missing
3. Installs `blackhole-2ch` if missing, and guides you through audio routing
4. Checks for Python 3
5. Installs `openai-whisper` via pip
6. Runs `npm install` to install Electron and Node dependencies

If you prefer to install manually:

```bash
brew install ffmpeg blackhole-2ch
pip3 install openai-whisper
npm install
```

---

## BlackHole audio routing (one-time setup)

BlackHole is a virtual audio driver that creates a loopback: Teams audio goes to your speakers **and** simultaneously into the recorder. Without this, the recording captures no audio.

1. Open **Audio MIDI Setup** — in `/Applications/Utilities/` or via Spotlight
2. Click the **+** button bottom-left → **Create Multi-Output Device**
3. In the right panel, check both:
   - Your normal speakers/headphones (e.g. "MacBook Pro Speakers" or "AirPods")
   - **BlackHole 2ch**
4. Double-click the device and rename it to `MeetingOut`
5. Go to **System Settings → Sound → Output** and select `MeetingOut`

All system audio now plays through your speakers **and** gets captured by the recorder.

**To revert after a meeting:** System Settings → Sound → Output → select your speakers directly.

---

## Configuration

Open the app and go to the **⚙️ Settings** tab. Settings are saved locally in `~/.meetingrecorder/config.json`.

### AI API Keys

| Field | Example | Notes |
|---|---|---|
| Anthropic API Key | `sk-ant-api03-...` | From [console.anthropic.com/keys](https://console.anthropic.com/keys) |
| OpenAI API Key | `sk-proj-...` | From [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| Whisper Model | `base` | See Whisper model guide below |

### Email (SMTP)

| Field | Gmail example | Notes |
|---|---|---|
| SMTP Host | `smtp.gmail.com` | Outlook: `smtp.office365.com` |
| SMTP Port | `587` | Use `465` for SSL |
| SMTP Username | `you@gmail.com` | Your email address |
| SMTP Password | `abcd efgh ijkl mnop` | See App Password setup below |
| From Address | `you@gmail.com` | Displayed as sender |
| Send Notes To | `team@company.com` | Receives notes after each meeting |

### Gmail App Password setup

Gmail blocks direct password login from third-party apps. Generate an App Password:

1. Go to [myaccount.google.com](https://myaccount.google.com) → **Security**
2. Click **2-Step Verification** (must be enabled first)
3. Scroll to bottom → click **App passwords**
4. Select "Mail" + "Mac" → **Generate**
5. Copy the 16-character password into the SMTP Password field

For **Outlook/Microsoft 365**, use `smtp.office365.com` on port `587` with your regular credentials or an app password if MFA is enabled.

---

## Running the app

```bash
npm start
```

On first launch, macOS will request Screen Recording permission. Grant it in:

**System Settings → Privacy & Security → Screen & System Audio Recording → enable Meeting Recorder**

Restart the app after granting permission.

---

## Usage walkthrough

### 1. Select a window

Click **🔄 Refresh Windows**. A grid of thumbnails shows every open window. Click the Teams window to select it (purple border = selected).

### 2. Choose AI provider

Toggle **Claude** or **ChatGPT** below the window grid. Must match a configured API key.

### 3. Record

Press **⏺**. The button turns red and pulses. The timer counts up. Audio is captured in the background via BlackHole.

### 4. Stop

Press **⏹**. The pipeline runs automatically:

| Step | What happens |
|---|---|
| 🎤 Transcribing | Whisper runs locally on your M4, converting audio to text |
| 🤖 Summarizing | Transcript sent to Claude or GPT-4o for structured meeting notes |
| 💾 Saving | Files written to `~/MeetingRecorder/meeting-YYYY-MM-DD.../` |
| 📧 Emailing | Notes + attachments sent via your SMTP config |

### 5. View results

Switch to the **📄 Results** tab. Click **📁 Open in Finder** to access all session files.

---

## Example scenarios

### Quick standup (10–15 min)

```
1. Join Teams standup
2. Switch audio output to MeetingOut
3. npm start → Refresh Windows → select Teams window
4. Press ⏺ Record
5. After standup, press ⏹ Stop
6. Pipeline runs in ~2 minutes, notes emailed automatically
```

### Technical meeting with jargon

Change Whisper model to `small` or `medium` in Settings before recording.
Transcription takes a bit longer but handles acronyms and technical terms better.

### Google Meet or Zoom (browser-based)

Same process — select the browser window showing the meeting instead of Teams.

### Reviewing a past recording

Open `~/MeetingRecorder/` in Finder. Each timestamped folder contains the full session.
Load `subtitles.srt` in VLC (Subtitle menu → Add Subtitle File) to replay with captions.

---

## Token usage estimates

When recording stops, the full plain-text transcript is sent to the AI API in one request.
Estimates are based on ~130 words per minute of spoken speech and ~0.75 tokens per word.

| Meeting length | ~Words | Input tokens (transcript) | Prompt overhead | **Total input** | Output tokens (notes) | **Claude Opus cost** | **GPT-4o cost** |
|---|---|---|---|---|---|---|---|
| 1 min | ~130 | ~100 | ~200 | **~300** | ~400 | ~$0.005 | ~$0.004 |
| 10 min | ~1,300 | ~975 | ~200 | **~1,175** | ~600 | ~$0.025 | ~$0.018 |
| 60 min | ~7,800 | ~5,850 | ~200 | **~6,050** | ~800 | ~$0.11 | ~$0.07 |
| 90 min | ~11,700 | ~8,775 | ~200 | **~8,975** | ~900 | ~$0.16 | ~$0.10 |

Pricing basis (early 2026): Claude Opus ~$15/M input + $75/M output tokens; GPT-4o ~$5/M input + $15/M output tokens. Verify current pricing at console.anthropic.com and platform.openai.com.

Both models support 128k+ token context windows, so even a 3-hour meeting (~18,000 input tokens) fits comfortably in a single request.

---

## Privacy & data security

This is critical to understand if you record confidential meetings.

---

### What the data flow looks like

```
Recording  ──► Local disk only             (never leaves your Mac)
Whisper    ──► Local disk only             (never leaves your Mac)
Transcript ──► Sent to Claude/GPT-4o API  (HTTPS, deleted in 7–30 days)
Notes      ──► Returned from API           (not re-sent anywhere)
Email      ──► Your SMTP server            (goes to your configured address)
```

---

### Stage 1 — Recording and audio capture: fully local

The screen video and BlackHole audio are captured on-device by Electron and ffmpeg.
`recording.webm` and `audio.wav` are written to your local disk. No data is transmitted anywhere.

### Stage 2 — Transcription: fully local

Whisper runs as a local Python process. Model weights are stored on your Mac after first download.
The audio file is processed entirely on your M4 chip. No audio or text is sent to any server.

### Stage 3 — Summarization: the only external call

The plain-text transcript is sent over HTTPS to the Claude or GPT-4o API. This is the only step that touches external servers.

#### Anthropic (Claude API) — privacy position

| Question | Answer |
|---|---|
| Is my transcript used to train Claude? | **No.** API inputs/outputs are excluded from model training by default. |
| Does Anthropic store my transcript? | Temporarily — API logs are retained for **7 days** for abuse monitoring, then deleted automatically. |
| Can I get zero retention? | Yes — **Zero Data Retention (ZDR)** is available for enterprise API customers. Contact Anthropic. |
| Encryption | TLS 1.2+ in transit |
| Will data be sold? | No — explicitly stated in Anthropic's policy. |

The training changes Anthropic announced in 2025 (opt-in/opt-out for model improvement) apply **only to consumer Free/Pro/Max accounts**, not to API usage. API data is never used for training.

#### OpenAI (GPT-4o API) — privacy position

| Question | Answer |
|---|---|
| Is my transcript used to train GPT? | **No.** API data is not used for training unless you explicitly opt in. |
| Does OpenAI store my transcript? | Abuse monitoring logs for up to 30 days, then deleted. |
| Can I get zero retention? | Yes — **Zero Data Retention** available for qualifying API organizations. |
| Encryption | TLS 1.2+, AES-256 at rest |

---

### Summary table

| Data | Stored locally | Sent externally |
|---|---|---|
| Video (`recording.webm`) | ✅ Yes | ❌ Never |
| Raw audio (`audio.wav`) | ✅ Yes | ❌ Never |
| Transcript (`transcript.txt`) | ✅ Yes | ⚠️ Sent once to AI API for summarization |
| Meeting notes (`meeting_notes.md`) | ✅ Yes | ❌ Never (returned from API) |
| Subtitles (`subtitles.srt`) | ✅ Yes | ❌ Never |
| API keys | ✅ Local config file | Used only as auth header |

---

### Recommendations by sensitivity level

**Standard meetings (standups, project syncs)**
The default setup is appropriate. Neither API provider trains on your data and logs are deleted within 7–30 days.

**Business-sensitive meetings (strategy, financials)**
Request **Zero Data Retention** for your API org from Anthropic or OpenAI. The transcript is then processed in memory and never written to their logs.

**Highly confidential meetings (legal, M&A, HR, regulated data)**
Skip the cloud summarization step entirely. You still get `transcript.txt` and `subtitles.srt` from Whisper — these are generated locally and never leave your machine. Write your own notes from the transcript.

**Enterprise / GDPR compliance**
Both Anthropic and OpenAI offer **Data Processing Addendums (DPAs)** for commercial API customers, providing contractual guarantees under GDPR. Contact their enterprise teams.

> **Bottom line:** Transcription is 100% private — nothing leaves your Mac. Summarization sends the transcript text to the AI provider over encrypted HTTPS, where it is processed and deleted within days. Neither provider uses API data to train their models by default.

---

## Output files

All sessions are saved to `~/MeetingRecorder/meeting-YYYY-MM-DDTHH-MM-SS/`:

```
meeting-2026-02-19T14-30-00/
├── recording.webm     ← screen capture video
├── audio.wav          ← raw audio from BlackHole
├── transcript.txt     ← plain text transcript (generated locally by Whisper)
├── meeting_notes.md   ← AI-generated structured meeting notes
└── subtitles.srt      ← subtitle file (load in VLC, Premiere, Final Cut, etc.)
```

---

## Whisper model guide

All models run locally on your Mac. No internet required after initial model download.

| Model | Download size | Speed on M4 | Accuracy | Recommended for |
|---|---|---|---|---|
| `tiny` | ~75 MB | ~10× real-time | Basic | Quick tests, clean audio |
| `base` | ~145 MB | ~7× real-time | Good | Most meetings ✅ |
| `small` | ~465 MB | ~4× real-time | Better | Technical jargon, mixed accents |
| `medium` | ~1.5 GB | ~2× real-time | High | Important recordings |
| `large` | ~2.9 GB | ~1× real-time | Best | Critical recordings, noisy calls |

"7× real-time" means a 60-minute meeting transcribes in ~8 minutes. `base` is the recommended default.

Models are downloaded from Hugging Face on first use and cached in `~/.cache/whisper/`. All subsequent runs are fully offline.

---

## Troubleshooting

**No audio in the recording**
System output must be set to `MeetingOut` (not BlackHole directly). Check System Settings → Sound → Output.

**Screen recording permission denied**
System Settings → Privacy & Security → Screen & System Audio Recording → enable the app. Restart after granting.

**Whisper fails / not found**
Run `pip3 install openai-whisper` manually. If you see a missing `setuptools` error, also run `pip3 install setuptools`.

**Email fails**
For Gmail, confirm you're using an App Password (16 characters), not your account password. Try port 587 with host `smtp.gmail.com`. Use "Test Email" in Settings to diagnose.

**Teams window not in the picker**
Teams must be open and visible on screen — not minimized to the Dock. Click "Refresh Windows" with Teams showing.

**Electron won't start**
Run `npm install` again. If you see a Node version error, install Node 18+ via `brew install node`.

**BlackHole not detected by ffmpeg**
Open Audio MIDI Setup and confirm BlackHole 2ch appears. If not, re-run `brew install blackhole-2ch` and restart your Mac.
