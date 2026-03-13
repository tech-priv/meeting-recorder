/**
 * main.js — Electron main process for Meeting Recorder
 *
 * Responsibilities:
 *  - Creates and manages the BrowserWindow
 *  - Handles all IPC calls from the renderer (index.html via preload.js)
 *  - Manages screen/audio capture via desktopCapturer + ffmpeg/BlackHole
 *  - Runs the Whisper transcription subprocess
 *  - Calls AI summarization APIs (Claude, ChatGPT, Gemini)
 *  - Saves session output files (transcript, notes, SRT)
 *  - Sends email via nodemailer/SMTP
 *  - Writes a per-session pipeline.log file for error diagnostics
 *
 * Data flow:
 *   renderer → IPC → main.js → ffmpeg / python3 / AI APIs → files → renderer
 */

'use strict';

const { app, BrowserWindow, ipcMain, desktopCapturer, shell } = require('electron');
const path      = require('path');
const fs        = require('fs');
const os        = require('os');
const { spawn } = require('child_process');
const nodemailer = require('nodemailer');

// ─── App-level paths ──────────────────────────────────────────────────────────

/** Config file: ~/.meetingrecorder/config.json */
const CONFIG_PATH    = path.join(os.homedir(), '.meetingrecorder', 'config.json');

/** All session folders live here: ~/MeetingRecorder/ */
const RECORDINGS_DIR = path.join(os.homedir(), 'MeetingRecorder');

/**
 * Ensures both the config directory and recordings root exist.
 * Called at app startup and before writing config.
 */
function ensureDirs() {
  [path.dirname(CONFIG_PATH), RECORDINGS_DIR].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
}

// ─── Config helpers ───────────────────────────────────────────────────────────

/**
 * Loads config from disk.
 * Returns a default object if the file doesn't exist or is malformed.
 * @returns {object} config
 */
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch (err) {
    console.warn('[config] Failed to parse config, using defaults:', err.message);
  }
  // Return sensible defaults for a fresh install
  return {
    anthropicKey:  '',
    openaiKey:     '',
    geminiKey:     '',
    aiProvider:    'claude',
    enableSummary: true,
    enableEmail:   true,   // whether to send email after pipeline completes
    smtpHost:      '',
    smtpPort:      587,
    smtpUser:      '',
    smtpPass:      '',
    emailFrom:     '',
    emailTo:       '',
    whisperModel:  'base'
  };
}

/**
 * Persists config to ~/.meetingrecorder/config.json.
 * @param {object} cfg - the full config object from the renderer
 */
function saveConfig(cfg) {
  ensureDirs();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

// ─── Session logging ──────────────────────────────────────────────────────────

/**
 * Per-session log file path.
 * Set when a new recording session starts, reset to null on cleanup.
 * @type {string|null}
 */
let sessionLogPath = null;

/**
 * Writes a timestamped log line to the session's pipeline.log file.
 * Falls back to console.log if no session is active.
 * @param {string} level  - 'INFO' | 'WARN' | 'ERROR'
 * @param {string} message
 */
function sessionLog(level, message) {
  const line = `[${new Date().toISOString()}] [${level}] ${message}\n`;
  console.log(line.trim());
  if (sessionLogPath) {
    try { fs.appendFileSync(sessionLogPath, line); } catch {}
  }
}

// ─── Window management ────────────────────────────────────────────────────────

/** Reference to the main BrowserWindow instance */
let mainWindow;

/**
 * Creates the primary app window with a hidden-inset title bar (macOS).
 * Context isolation is enabled and node integration is off for security.
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width:           900,
    height:          700,
    minWidth:        800,
    minHeight:       600,
    titleBarStyle:   'hiddenInset',
    backgroundColor: '#0f1117',
    webPreferences: {
      nodeIntegration:  false,   // never expose Node to renderer
      contextIsolation: true,    // required for contextBridge
      preload: path.join(__dirname, 'preload.js')
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  ensureDirs();
  createWindow();
});

// On macOS, re-create window when dock icon is clicked and no windows are open
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ─── IPC: Window/screen source picker ────────────────────────────────────────

/**
 * Returns all capturable windows and screens with thumbnails.
 * Used by the renderer to build the window picker grid/list.
 */
ipcMain.handle('get-windows', async () => {
  const sources = await desktopCapturer.getSources({
    types:         ['window', 'screen'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: true
  });
  return sources.map(s => ({
    id:        s.id,
    name:      s.name,
    thumbnail: s.thumbnail.toDataURL(),
    appIcon:   s.appIcon ? s.appIcon.toDataURL() : null
  }));
});

// ─── IPC: Config ──────────────────────────────────────────────────────────────

ipcMain.handle('load-config', () => loadConfig());
ipcMain.handle('save-config', (_, cfg) => { saveConfig(cfg); return true; });

// ─── IPC: Session lifecycle ───────────────────────────────────────────────────

/**
 * In-flight video chunks collected via MediaRecorder in the renderer.
 * Written to disk as a single webm file on recording-stop.
 * @type {Buffer[]}
 */
let videoChunks = [];

/**
 * Starts a new recording session:
 *  - Creates a timestamped folder under ~/MeetingRecorder/
 *  - Initialises the session log file (pipeline.log)
 *  - Resets the video chunk buffer
 * @returns {{ sessionDir: string, logPath: string, timestamp: string }}
 */
ipcMain.handle('recording-start', () => {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const sessionDir = path.join(RECORDINGS_DIR, `meeting-${ts}`);
  fs.mkdirSync(sessionDir, { recursive: true });

  // Initialise per-session log
  sessionLogPath = path.join(sessionDir, 'pipeline.log');
  fs.writeFileSync(sessionLogPath, `=== Meeting Recorder Pipeline Log ===\nSession: ${ts}\n\n`);
  sessionLog('INFO', 'Recording session started');

  videoChunks = [];
  return { sessionDir, logPath: sessionLogPath, timestamp: ts };
});

/**
 * Receives a video chunk (ArrayBuffer) from the renderer's MediaRecorder
 * and buffers it in memory.
 */
ipcMain.handle('save-video-chunk', (_, arrayBuffer) => {
  videoChunks.push(Buffer.from(arrayBuffer));
  return true;
});

/**
 * Finalises the recording:
 *  - Flushes all buffered video chunks to recording.webm
 *  - Returns the path to the written file (or null if no chunks)
 * @param {{ sessionDir: string }} params
 */
ipcMain.handle('recording-stop', async (_, { sessionDir }) => {
  if (videoChunks.length > 0) {
    const videoPath = path.join(sessionDir, 'recording.webm');
    fs.writeFileSync(videoPath, Buffer.concat(videoChunks));
    videoChunks = [];
    sessionLog('INFO', `Video written: ${videoPath}`);
    return { videoPath };
  }
  sessionLog('WARN', 'No video chunks received — recording.webm not created');
  return { videoPath: null };
});

// ─── IPC: Audio recording (renderer-based, no ffmpeg during capture) ──────────
//
// Audio is recorded entirely in the renderer via MediaRecorder (getUserMedia or
// desktopCapturer screen audio).  Chunks arrive via 'save-audio-chunk' IPC and
// are buffered here.  On stop, ffmpeg converts the resulting WebM to the 16kHz
// mono PCM WAV that Whisper expects.
//
// This approach works with any input device (AirPods, Built-in Mic, etc.)
// without needing BlackHole, virtual cables, or AVFoundation name matching —
// all of which are fragile on macOS Tahoe (15+).

let audioChunks = [];  // Buffer of ArrayBuffers received from renderer
let audioWebmPath = null;

/**
 * Prepares for a new audio recording session.
 * Returns the final audio.wav path so the renderer knows where it will land.
 * @param {{ sessionDir: string }} params
 * @returns {{ audioPath: string, audioWebmPath: string }}
 */
ipcMain.handle('start-audio', (_, { sessionDir }) => {
  audioChunks   = [];
  audioWebmPath = path.join(sessionDir, 'audio.webm');
  const audioPath = path.join(sessionDir, 'audio.wav');
  sessionLog('INFO', 'Audio recording started (renderer-based MediaRecorder)');
  return { audioPath, audioWebmPath };
});

/**
 * Receives a raw audio chunk (ArrayBuffer) from the renderer's MediaRecorder.
 */
ipcMain.handle('save-audio-chunk', (_, arrayBuffer) => {
  audioChunks.push(Buffer.from(arrayBuffer));
  return true;
});

/**
 * Finalises audio recording:
 *  1. Flushes buffered chunks to audio.webm
 *  2. Runs ffmpeg to convert audio.webm → audio.wav (16kHz mono PCM)
 *  3. Optionally removes the intermediate .webm
 * @param {{ sessionDir: string }} params
 * @returns {{ audioPath: string }}
 */
ipcMain.handle('stop-audio', (_, params) => {
  const { sessionDir } = params || {};
  return new Promise((resolve, reject) => {
    if (!audioChunks.length) {
      sessionLog('WARN', 'No audio chunks received — audio.wav will be empty');
      // Create a silent placeholder so Whisper does not crash
      const audioPath = path.join(sessionDir, 'audio.wav');
      resolve({ audioPath });
      return;
    }

    const webmPath  = audioWebmPath || path.join(sessionDir, 'audio.webm');
    const audioPath = path.join(sessionDir, 'audio.wav');

    // Write the raw WebM data
    fs.writeFileSync(webmPath, Buffer.concat(audioChunks));
    audioChunks = [];
    sessionLog('INFO', 'Audio WebM written: ' + webmPath + ' (' + Math.round(fs.statSync(webmPath).size / 1024) + ' KB)');

    // Convert to 16kHz mono WAV for Whisper
    sessionLog('INFO', 'Converting audio.webm → audio.wav via ffmpeg…');
    const proc = spawn('ffmpeg', [
      '-y',
      '-i',      webmPath,
      '-ar',     '16000',
      '-ac',     '1',
      '-acodec', 'pcm_s16le',
      audioPath
    ]);

    let ffmpegErr = '';
    proc.stderr.on('data', chunk => {
      const line = chunk.toString().trim();
      ffmpegErr += line + '\n';
      sessionLog('INFO', '[ffmpeg] ' + line);
    });

    proc.on('close', code => {
      if (code === 0) {
        sessionLog('INFO', 'audio.wav written: ' + audioPath);
        // Remove the intermediate webm to save space
        try { fs.unlinkSync(webmPath); } catch {}
        resolve({ audioPath });
      } else {
        const msg = 'ffmpeg conversion failed (exit ' + code + '):\n' + ffmpegErr.slice(-500);
        sessionLog('ERROR', msg);
        reject(new Error(msg));
      }
    });

    proc.on('error', err => {
      const msg = 'ffmpeg not found: ' + err.message + '\nInstall with: brew install ffmpeg';
      sessionLog('ERROR', msg);
      reject(new Error(msg));
    });
  });
});

// ─── IPC: Transcription via local Whisper ─────────────────────────────────────

/**
 * Runs whisper_transcribe.py as a subprocess against the recorded audio file.
 *
 * stdout parsing:
 *   The Python script uses a sentinel "__WHISPER_JSON_START__" followed by one
 *   JSON line.  We search for that sentinel so that ANY stray output Whisper
 *   prints to stdout (e.g. "Detected language: English") is simply discarded
 *   instead of breaking JSON.parse().  This is the fix for the
 *   "Unexpected token 'D', Detected l…" parse failure.
 *
 * Live log streaming:
 *   Every stderr line is immediately forwarded to the renderer via the
 *   'step-log' IPC event so the expandable pipeline log panels update in real
 *   time.
 *
 * @param {{ audioPath: string, model: string }} params
 * @returns {{ text: string, srt: string, segments: object[] }}
 */
ipcMain.handle('transcribe', async (event, { audioPath, model }) => {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, 'whisper_transcribe.py');
    sessionLog('INFO', `Transcribing ${audioPath} with model="${model || 'base'}"`);

    const proc = spawn('python3', [scriptPath, audioPath, '--model', model || 'base']);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', d => { stdout += d.toString(); });

    proc.stderr.on('data', d => {
      const chunk = d.toString();
      stderr += chunk;
      // Log each line individually so the session file and live panel stay readable
      chunk.split('\n').filter(l => l.trim()).forEach(line => {
        sessionLog('INFO', `[whisper] ${line.trim()}`);
        // Forward to renderer for the expandable step log panel
        try { event.sender.send('step-log', { step: 'transcribe', line: line.trim() }); } catch {}
      });
    });

    proc.on('close', code => {
      // ── Find the sentinel line and extract the JSON that follows it ──────────
      // This protects against any stray print() output Whisper emits to stdout
      // (some builds leak "Detected language: English", tqdm bars, etc.).
      const SENTINEL = '__WHISPER_JSON_START__';
      const sentinelIdx = stdout.indexOf(SENTINEL);

      let jsonStr = '';
      if (sentinelIdx !== -1) {
        // Take everything after the sentinel line
        jsonStr = stdout.slice(sentinelIdx + SENTINEL.length).trim();
      } else {
        // Fallback for older script versions: try the whole stdout trimmed
        jsonStr = stdout.trim();
      }

      if (code === 0 || jsonStr) {
        try {
          const result = JSON.parse(jsonStr);
          if (result.error) {
            const msg = `Whisper reported an error: ${result.error}`;
            sessionLog('ERROR', msg);
            reject(new Error(msg));
            return;
          }
          sessionLog('INFO', `Transcription complete — ${result.segments?.length ?? 0} segments`);
          resolve(result);
        } catch (parseErr) {
          const msg = `Failed to parse Whisper JSON output: ${parseErr.message}\nRaw stdout (first 500 chars): ${stdout.slice(0, 500)}`;
          sessionLog('ERROR', msg);
          reject(new Error(msg));
        }
      } else {
        const msg = `Whisper exited with code ${code}\nstderr: ${stderr.slice(-1000)}`;
        sessionLog('ERROR', msg);
        reject(new Error(msg));
      }
    });

    proc.on('error', err => {
      const msg = `Failed to spawn python3: ${err.message}`;
      sessionLog('ERROR', msg);
      reject(new Error(msg));
    });
  });
});

// ─── IPC: AI summarization ────────────────────────────────────────────────────

/**
 * Prompt template sent to the AI model.
 * Produces structured meeting notes in four sections.
 * @param {string} transcript - plain text transcript
 * @returns {string} the full prompt
 */
const SUMMARY_PROMPT = transcript => `You are an expert at writing clear, structured meeting notes.

Below is a full transcript from a recorded meeting. Produce professional meeting notes with these sections:

## Meeting Summary
A concise 2-4 sentence overview.

## Key Discussion Points
Main topics with brief explanations.

## Action Items
Decisions made or tasks assigned (with owner if mentioned).

## Follow-ups & Next Steps
Open questions, follow-up tasks, or next meeting topics.

---
TRANSCRIPT:
${transcript}
---

Write the meeting notes now:`;

/**
 * Calls the selected AI provider API to summarize the transcript.
 * Supported providers: 'claude' (Anthropic), 'chatgpt' (OpenAI), 'gemini' (Google).
 *
 * @param {{ transcript: string, provider: string, config: object }} params
 * @returns {string} AI-generated meeting notes markdown
 */
ipcMain.handle('summarize', async (event, { transcript, provider, config }) => {
  // Helper: emit a log line both to the session log file and live to the renderer
  const log = (msg) => {
    sessionLog('INFO', msg);
    try { event.sender.send('step-log', { step: 'summarize', line: msg }); } catch {}
  };

  log(`Summarizing with provider="${provider}" — transcript length ${transcript?.length ?? 0} chars`);

  if (provider === 'claude') {
    // Anthropic Claude — claude-opus-4-6
    log('Calling Anthropic API (claude-opus-4-6)…');
    const Anthropic = require('@anthropic-ai/sdk');
    const client    = new Anthropic.default({ apiKey: config.anthropicKey });
    const msg = await client.messages.create({
      model:      'claude-opus-4-6',
      max_tokens: 2048,
      messages:   [{ role: 'user', content: SUMMARY_PROMPT(transcript) }]
    });
    const notes = msg.content[0].text;
    log(`Claude returned ${notes.length} chars`);
    return notes;

  } else if (provider === 'chatgpt') {
    // OpenAI GPT-4o
    log('Calling OpenAI API (gpt-4o)…');
    const OpenAI = require('openai');
    const client = new OpenAI.default({ apiKey: config.openaiKey });
    const res = await client.chat.completions.create({
      model:      'gpt-4o',
      max_tokens: 2048,
      messages: [
        { role: 'system', content: 'You are an expert at writing clear, structured meeting notes.' },
        { role: 'user',   content: SUMMARY_PROMPT(transcript) }
      ]
    });
    const notes = res.choices[0].message.content;
    log(`ChatGPT returned ${notes.length} chars`);
    return notes;

  } else if (provider === 'gemini') {
    // Google Gemini 1.5 Pro
    log('Calling Google Gemini API (gemini-1.5-pro)…');
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(config.geminiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });
    const result = await model.generateContent(SUMMARY_PROMPT(transcript));
    const notes  = result.response.text();
    log(`Gemini returned ${notes.length} chars`);
    return notes;

  } else {
    throw new Error(`Unknown AI provider: "${provider}"`);
  }
});

// ─── IPC: Save output files ───────────────────────────────────────────────────

/**
 * Writes session output files to the session directory:
 *   - transcript.txt     — raw plain text transcript
 *   - meeting_notes.md   — AI-generated notes (skipped if notes is empty)
 *   - subtitles.srt      — SRT subtitle file (skipped if srt is empty)
 *
 * @param {{ sessionDir, transcript, notes, srt }} params
 * @returns {{ transcriptPath, notesPath, srtPath }}
 */
ipcMain.handle('save-outputs', (event, { sessionDir, transcript, notes, srt }) => {
  const log = (msg) => {
    sessionLog('INFO', msg);
    try { event.sender.send('step-log', { step: 'save', line: msg }); } catch {}
  };

  const transcriptPath = path.join(sessionDir, 'transcript.txt');
  const notesPath      = path.join(sessionDir, 'meeting_notes.md');
  const srtPath        = path.join(sessionDir, 'subtitles.srt');

  if (transcript !== null && transcript !== undefined) {
    fs.writeFileSync(transcriptPath, transcript || '');
    log(`Saved transcript → ${transcriptPath}`);
  }

  if (notes) {
    const header = `# Meeting Notes\n> Generated: ${new Date().toLocaleString()}\n\n---\n\n`;
    fs.writeFileSync(notesPath, header + notes);
    log(`Saved meeting notes → ${notesPath}`);
  }

  if (srt) {
    fs.writeFileSync(srtPath, srt);
    log(`Saved subtitles → ${srtPath}`);
  }

  return { transcriptPath, notesPath, srtPath };
});

// ─── IPC: Email ───────────────────────────────────────────────────────────────

/**
 * Sends meeting notes + attachments via configured SMTP server.
 * Attaches transcript.txt and meeting_notes.md if they exist on disk.
 *
 * @param {{ config, notes, transcriptPath, notesPath }} params
 */
ipcMain.handle('send-email', async (event, { config, notes, transcriptPath, notesPath }) => {
  const log = (msg) => {
    sessionLog('INFO', msg);
    try { event.sender.send('step-log', { step: 'email', line: msg }); } catch {}
  };

  log(`Connecting to SMTP: ${config.smtpHost}:${config.smtpPort}`);

  const transporter = nodemailer.createTransporter({
    host:   config.smtpHost,
    port:   parseInt(config.smtpPort),
    secure: parseInt(config.smtpPort) === 465, // true = SSL, false = STARTTLS
    auth: { user: config.smtpUser, pass: config.smtpPass }
  });

  // Build attachment list — only include files that were actually written
  const attachments = [];
  if (transcriptPath && fs.existsSync(transcriptPath)) {
    attachments.push({ filename: 'transcript.txt', path: transcriptPath });
    log(`Attaching transcript.txt`);
  }
  if (notesPath && fs.existsSync(notesPath)) {
    attachments.push({ filename: 'meeting_notes.md', path: notesPath });
    log(`Attaching meeting_notes.md`);
  }

  log(`Sending to ${config.emailTo}…`);
  await transporter.sendMail({
    from:        config.emailFrom,
    to:          config.emailTo,
    subject:     `Meeting Notes — ${new Date().toLocaleDateString()}`,
    text:        notes || '(No AI notes — see attached transcript)',
    html:        `<pre style="font-family:sans-serif;white-space:pre-wrap">${(notes || '').replace(/\n/g, '<br>')}</pre>`,
    attachments
  });

  log(`Email sent successfully to ${config.emailTo}`);
  return true;
});

// ─── IPC: Read log file ───────────────────────────────────────────────────────

/**
 * Reads the current session's pipeline.log and returns its contents.
 * Called by the renderer when a pipeline step fails, to display diagnostics.
 * @param {{ logPath: string }} params
 * @returns {string} full log text
 */
ipcMain.handle('read-log', (_, { logPath }) => {
  try {
    return fs.readFileSync(logPath, 'utf8');
  } catch {
    return '(Log file not found or could not be read)';
  }
});

// ─── IPC: Shell helpers ───────────────────────────────────────────────────────

/** Opens the ~/MeetingRecorder folder in Finder */
ipcMain.handle('open-recordings', () => {
  shell.openPath(RECORDINGS_DIR);
});

// ─── IPC: List audio devices via ffmpeg ───────────────────────────────────────

/**
 * Queries ffmpeg for the list of available AVFoundation audio input devices,
 * then supplements with Application Audio Capture sources (macOS 14+).
 *
 * Returns an array of:
 *   { index: string, name: string, type: 'device'|'app', appBundleId?: string }
 *
 * Regular devices (AirPods, BlackHole, Built-in Mic, etc.) come from the
 * standard AVFoundation device list.  Application Audio Capture entries are
 * synthesised from the running process list — they let you capture audio from
 * a specific app (Teams, Zoom, Chrome, etc.) without a loopback virtual device.
 *
 * The index field for app-capture entries is the string "app:<bundleId>" so
 * start-audio can distinguish them and pass the correct ffmpeg -i argument.
 *
 * @returns {{ index: string, name: string, type: string, appBundleId?: string }[]}
 */
ipcMain.handle('list-audio-devices', () => {
  return new Promise(resolve => {
    const proc = spawn('ffmpeg', ['-f', 'avfoundation', '-list_devices', 'true', '-i', '']);
    let stderr = '';

    proc.stderr.on('data', chunk => { stderr += chunk.toString(); });

    proc.on('close', () => {
      // ffmpeg exits non-zero when listing devices — that is expected
      const devices = [];
      let inAudioSection = false;

      for (const line of stderr.split('\n')) {
        if (line.includes('AVFoundation audio devices')) { inAudioSection = true; continue; }
        if (inAudioSection && line.includes('AVFoundation video devices')) break;
        if (inAudioSection) {
          // Lines: [AVFoundation input device @ 0x...] [0] BlackHole 2ch
          const m = line.match(/\[(\d+)\]\s+(.+)/);
          if (m) {
            devices.push({ index: m[1], name: m[2].trim(), type: 'device' });
          }
        }
      }

      sessionLog('INFO', `Found ${devices.length} audio device(s): ${devices.map(d => d.name).join(', ')}`);

      // ── Application Audio Capture (macOS 14 Sonoma+) ──────────────────────
      // Use system_profiler or a lightweight AppleScript to enumerate running
      // apps that have audio output.  We list the most common meeting/browser
      // apps explicitly and check if they are running, rather than enumerating
      // all processes (which would produce hundreds of irrelevant entries).
      const knownApps = [
        { name: 'Microsoft Teams',  bundleId: 'com.microsoft.teams'          },
        { name: 'Microsoft Teams (New)', bundleId: 'com.microsoft.teams2'    },
        { name: 'Zoom',             bundleId: 'us.zoom.xos'                   },
        { name: 'Google Chrome',    bundleId: 'com.google.Chrome'             },
        { name: 'Slack',            bundleId: 'com.tinyspeck.slackmacgap'     },
        { name: 'Google Meet',      bundleId: 'com.google.chrome.app.meet'    },
        { name: 'Firefox',          bundleId: 'org.mozilla.firefox'           },
        { name: 'Safari',           bundleId: 'com.apple.Safari'              },
        { name: 'FaceTime',         bundleId: 'com.apple.FaceTime'            },
        { name: 'Discord',          bundleId: 'com.hnc.Discord'               },
        { name: 'Webex',            bundleId: 'Cisco-Systems.Spark'           },
      ];

      // Check which of these are actually running by looking at /Applications
      // Detect running apps using two complementary methods:
      //   1. ps -ax (reliable on all macOS, no permissions needed)
      //   2. osascript bundle ID list (best-effort, may be blocked on Tahoe+)
      const { execSync } = require('child_process');
      let runningProcessNames = new Set();
      let runningBundleIds    = new Set();

      try {
        // Method 1: list all process executable names from ps
        const psOut = execSync('ps -ax -o comm=', { timeout: 2000 }).toString();
        psOut.split('\n').forEach(line => {
          const parts = line.trim().split('/');
          const name  = parts[parts.length - 1].trim().toLowerCase();
          if (name) runningProcessNames.add(name);
        });
      } catch {}

      try {
        // Method 2: osascript bundle IDs (may fail on Tahoe due to SIP restrictions)
        const out = execSync(
          "osascript -e 'tell application \"System Events\" to get bundle identifier of every process whose background only is false'",
          { timeout: 3000, encoding: 'utf8' }
        );
        out.split(',').forEach(b => { const t = b.trim(); if (t) runningBundleIds.add(t.toLowerCase()); });
      } catch {}

      // Process name hints per bundle ID (what macOS names the process in ps)
      const knownProcessNames = {
        'com.microsoft.teams':       ['teams', 'microsoft teams'],
        'com.microsoft.teams2':      ['teams', 'microsoft teams'],
        'us.zoom.xos':               ['zoom', 'zoom.us'],
        'com.google.Chrome':         ['google chrome', 'chrome'],
        'com.tinyspeck.slackmacgap': ['slack'],
        'org.mozilla.firefox':       ['firefox'],
        'com.apple.Safari':          ['safari'],
        'com.apple.FaceTime':        ['facetime'],
        'com.hnc.Discord':           ['discord'],
        'Cisco-Systems.Spark':       ['webex', 'cisco webex meetings', 'spark'],
      };

      const appDevices = knownApps.map(app => {
        const pNames  = knownProcessNames[app.bundleId] || [app.name.toLowerCase()];
        const running = runningBundleIds.has(app.bundleId.toLowerCase())
                     || pNames.some(n => runningProcessNames.has(n)
                          || [...runningProcessNames].some(p => p.includes(n)));
        return {
          index:       'app:' + app.bundleId,
          name:        app.name + ' (App Audio)',
          type:        'app',
          appBundleId: app.bundleId,
          running
        };
      });

      // Put running apps first, then others
      const sortedApps = [
        ...appDevices.filter(a => a.running),
        ...appDevices.filter(a => !a.running)
      ];

      const all = [...devices, ...sortedApps];
      sessionLog('INFO', 'Total sources: ' + all.length + ' (' + devices.length + ' devices, ' + sortedApps.length + ' app captures)');
      resolve(all);
    });

    proc.on('error', err => {
      sessionLog('ERROR', 'list-audio-devices failed: ' + err.message);
      resolve([]);
    });
  });
});

/**
 * Opens a file path in Finder (reveals it).
 * Used to show the user where pipeline.log lives after an error.
 * @param {{ filePath: string }} params
 */
ipcMain.handle('reveal-file', (_, { filePath }) => {
  shell.showItemInFolder(filePath);
});
