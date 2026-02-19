const { app, BrowserWindow, ipcMain, desktopCapturer, screen, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execSync } = require('child_process');
const nodemailer = require('nodemailer');

// ─── Paths ────────────────────────────────────────────────────────────────────
const CONFIG_PATH = path.join(os.homedir(), '.meetingrecorder', 'config.json');
const RECORDINGS_DIR = path.join(os.homedir(), 'MeetingRecorder');

function ensureDirs() {
  [path.dirname(CONFIG_PATH), RECORDINGS_DIR].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
}

// ─── Config ───────────────────────────────────────────────────────────────────
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {}
  return {
    anthropicKey: '',
    openaiKey: '',
    aiProvider: 'claude',
    smtpHost: '',
    smtpPort: 587,
    smtpUser: '',
    smtpPass: '',
    emailFrom: '',
    emailTo: '',
    whisperModel: 'base'
  };
}

function saveConfig(cfg) {
  ensureDirs();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

// ─── Main Window ──────────────────────────────────────────────────────────────
let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f1117',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  ensureDirs();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ─── IPC: Get windows ─────────────────────────────────────────────────────────
ipcMain.handle('get-windows', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['window', 'screen'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: true
  });
  return sources.map(s => ({
    id: s.id,
    name: s.name,
    thumbnail: s.thumbnail.toDataURL(),
    appIcon: s.appIcon ? s.appIcon.toDataURL() : null
  }));
});

// ─── IPC: Config ──────────────────────────────────────────────────────────────
ipcMain.handle('load-config', () => loadConfig());
ipcMain.handle('save-config', (_, cfg) => { saveConfig(cfg); return true; });

// ─── IPC: Save video chunk ────────────────────────────────────────────────────
let currentSessionDir = null;
let videoChunks = [];

ipcMain.handle('recording-start', () => {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  currentSessionDir = path.join(RECORDINGS_DIR, `meeting-${ts}`);
  fs.mkdirSync(currentSessionDir, { recursive: true });
  videoChunks = [];
  return { sessionDir: currentSessionDir, timestamp: ts };
});

ipcMain.handle('save-video-chunk', (_, arrayBuffer) => {
  videoChunks.push(Buffer.from(arrayBuffer));
  return true;
});

ipcMain.handle('recording-stop', async (_, { sessionDir }) => {
  if (videoChunks.length > 0) {
    const videoPath = path.join(sessionDir, 'recording.webm');
    fs.writeFileSync(videoPath, Buffer.concat(videoChunks));
    videoChunks = [];
    return { videoPath };
  }
  return { videoPath: null };
});

// ─── IPC: Audio recording via BlackHole + ffmpeg ──────────────────────────────
let audioProcess = null;

ipcMain.handle('start-audio', (_, { sessionDir }) => {
  const audioPath = path.join(sessionDir, 'audio.wav');
  // Record from BlackHole 2ch (system audio loopback)
  // ffmpeg captures from BlackHole virtual device
  audioProcess = spawn('ffmpeg', [
    '-y',
    '-f', 'avfoundation',
    '-i', ':BlackHole 2ch',   // audio-only capture from BlackHole
    '-ar', '16000',
    '-ac', '1',
    '-acodec', 'pcm_s16le',
    audioPath
  ]);
  audioProcess.stderr.on('data', () => {}); // suppress ffmpeg logs
  return { audioPath };
});

ipcMain.handle('stop-audio', () => {
  return new Promise((resolve) => {
    if (audioProcess) {
      audioProcess.stdin.write('q'); // graceful ffmpeg quit
      audioProcess.on('close', () => {
        audioProcess = null;
        resolve(true);
      });
      setTimeout(() => {
        if (audioProcess) { audioProcess.kill('SIGTERM'); audioProcess = null; }
        resolve(true);
      }, 3000);
    } else {
      resolve(true);
    }
  });
});

// ─── IPC: Transcribe with local Whisper ───────────────────────────────────────
ipcMain.handle('transcribe', async (_, { audioPath, model }) => {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, 'whisper_transcribe.py');
    const proc = spawn('python3', [scriptPath, audioPath, '--model', model || 'base']);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => stdout += d.toString());
    proc.stderr.on('data', d => stderr += d.toString());
    proc.on('close', code => {
      if (code === 0) {
        try {
          const result = JSON.parse(stdout);
          resolve(result);
        } catch {
          reject(new Error('Failed to parse Whisper output: ' + stdout));
        }
      } else {
        reject(new Error('Whisper failed: ' + stderr));
      }
    });
  });
});

// ─── IPC: Summarize ───────────────────────────────────────────────────────────
const SUMMARY_PROMPT = (transcript) => `You are an expert at writing clear, structured meeting notes.

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

ipcMain.handle('summarize', async (_, { transcript, provider, config }) => {
  if (provider === 'claude') {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic.default({ apiKey: config.anthropicKey });
    const msg = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 2048,
      messages: [{ role: 'user', content: SUMMARY_PROMPT(transcript) }]
    });
    return msg.content[0].text;
  } else {
    const OpenAI = require('openai');
    const client = new OpenAI.default({ apiKey: config.openaiKey });
    const res = await client.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 2048,
      messages: [
        { role: 'system', content: 'You are an expert at writing clear, structured meeting notes.' },
        { role: 'user', content: SUMMARY_PROMPT(transcript) }
      ]
    });
    return res.choices[0].message.content;
  }
});

// ─── IPC: Save transcript & notes ─────────────────────────────────────────────
ipcMain.handle('save-outputs', (_, { sessionDir, transcript, notes, srt, timestamp }) => {
  const transcriptPath = path.join(sessionDir, 'transcript.txt');
  const notesPath = path.join(sessionDir, 'meeting_notes.md');
  const srtPath = path.join(sessionDir, 'subtitles.srt');

  fs.writeFileSync(transcriptPath, transcript);
  fs.writeFileSync(notesPath, `# Meeting Notes\n> ${new Date().toLocaleString()}\n\n---\n\n${notes}`);
  if (srt) fs.writeFileSync(srtPath, srt);

  return { transcriptPath, notesPath, srtPath };
});

// ─── IPC: Send email ──────────────────────────────────────────────────────────
ipcMain.handle('send-email', async (_, { config, notes, transcriptPath, notesPath, sessionDir }) => {
  const transporter = nodemailer.createTransporter({
    host: config.smtpHost,
    port: parseInt(config.smtpPort),
    secure: parseInt(config.smtpPort) === 465,
    auth: { user: config.smtpUser, pass: config.smtpPass }
  });

  const attachments = [];
  if (fs.existsSync(transcriptPath)) {
    attachments.push({ filename: 'transcript.txt', path: transcriptPath });
  }
  if (fs.existsSync(notesPath)) {
    attachments.push({ filename: 'meeting_notes.md', path: notesPath });
  }

  await transporter.sendMail({
    from: config.emailFrom,
    to: config.emailTo,
    subject: `Meeting Notes — ${new Date().toLocaleDateString()}`,
    text: notes,
    html: `<pre style="font-family:sans-serif;white-space:pre-wrap">${notes.replace(/\n/g, '<br>')}</pre>`,
    attachments
  });

  return true;
});

// ─── IPC: Open recordings folder ─────────────────────────────────────────────
ipcMain.handle('open-recordings', () => {
  require('electron').shell.openPath(RECORDINGS_DIR);
});
