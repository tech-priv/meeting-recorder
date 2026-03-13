/**
 * preload.js — Electron contextBridge: main process <-> renderer
 *
 * Security model:
 *   nodeIntegration is OFF in the renderer — it cannot require() Node modules.
 *   contextIsolation is ON — renderer and main have separate JS worlds.
 *   Only the explicitly listed api.* calls are accessible to index.html.
 *
 * IPC invoke calls (request/response):
 *   getWindows        — list capturable windows/screens with thumbnails
 *   loadConfig        — read ~/.meetingrecorder/config.json
 *   saveConfig        — write ~/.meetingrecorder/config.json
 *   recordingStart    — create session folder + pipeline.log, return paths
 *   saveVideoChunk    — buffer a video MediaRecorder chunk in main process
 *   saveAudioChunk    — buffer an audio MediaRecorder chunk in main process
 *   recordingStop     — flush buffered video chunks to recording.webm
 *   startAudio        — prepare audio session, return target path
 *   stopAudio         — convert buffered audio WebM → WAV via ffmpeg
 *   listAudioDevices  — list AVFoundation devices + app capture sources
 *   transcribe        — run whisper_transcribe.py subprocess
 *   summarize         — call AI API (Claude / ChatGPT / Gemini)
 *   saveOutputs       — write transcript.txt, meeting_notes.md, subtitles.srt
 *   sendEmail         — send notes via nodemailer SMTP
 *   readLog           — read session pipeline.log for error display
 *   revealFile        — reveal a file path in Finder / Explorer
 *   openRecordings    — open ~/MeetingRecorder/ in the file manager
 *   openExternal      — open a URL in the default browser
 *
 * IPC event listeners (main → renderer push):
 *   onStepLog(cb)     — real-time log lines per pipeline step
 *   offStepLog(cb)    — remove the listener
 */

'use strict';

const { contextBridge, ipcRenderer, shell } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Window / screen source picker
  getWindows:       ()      => ipcRenderer.invoke('get-windows'),

  // Config persistence
  loadConfig:       ()      => ipcRenderer.invoke('load-config'),
  saveConfig:       (cfg)   => ipcRenderer.invoke('save-config', cfg),

  // Session lifecycle
  recordingStart:   ()      => ipcRenderer.invoke('recording-start'),
  saveVideoChunk:   (buf)   => ipcRenderer.invoke('save-video-chunk', buf),
  saveAudioChunk:   (buf)   => ipcRenderer.invoke('save-audio-chunk', buf),
  recordingStop:    (data)  => ipcRenderer.invoke('recording-stop', data),

  // Audio capture (renderer MediaRecorder → main ffmpeg conversion)
  startAudio:       (data)  => ipcRenderer.invoke('start-audio', data),
  stopAudio:        (data)  => ipcRenderer.invoke('stop-audio', data),
  listAudioDevices: ()      => ipcRenderer.invoke('list-audio-devices'),

  // Pipeline steps
  transcribe:       (data)  => ipcRenderer.invoke('transcribe', data),
  summarize:        (data)  => ipcRenderer.invoke('summarize', data),
  saveOutputs:      (data)  => ipcRenderer.invoke('save-outputs', data),
  sendEmail:        (data)  => ipcRenderer.invoke('send-email', data),

  // Diagnostics
  readLog:          (data)  => ipcRenderer.invoke('read-log', data),
  revealFile:       (data)  => ipcRenderer.invoke('reveal-file', data),

  // Shell helpers
  openRecordings:   ()      => ipcRenderer.invoke('open-recordings'),
  openExternal:     (url)   => shell.openExternal(url),

  // Real-time pipeline log streaming (main → renderer push)
  onStepLog:  (cb) => ipcRenderer.on('step-log',  (_, data) => cb(data)),
  offStepLog: (cb) => ipcRenderer.removeListener('step-log', cb),
});
