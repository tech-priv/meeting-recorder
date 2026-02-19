const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getWindows:       ()      => ipcRenderer.invoke('get-windows'),
  loadConfig:       ()      => ipcRenderer.invoke('load-config'),
  saveConfig:       (cfg)   => ipcRenderer.invoke('save-config', cfg),
  recordingStart:   ()      => ipcRenderer.invoke('recording-start'),
  saveVideoChunk:   (buf)   => ipcRenderer.invoke('save-video-chunk', buf),
  recordingStop:    (data)  => ipcRenderer.invoke('recording-stop', data),
  startAudio:       (data)  => ipcRenderer.invoke('start-audio', data),
  stopAudio:        ()      => ipcRenderer.invoke('stop-audio'),
  transcribe:       (data)  => ipcRenderer.invoke('transcribe', data),
  summarize:        (data)  => ipcRenderer.invoke('summarize', data),
  saveOutputs:      (data)  => ipcRenderer.invoke('save-outputs', data),
  sendEmail:        (data)  => ipcRenderer.invoke('send-email', data),
  openRecordings:   ()      => ipcRenderer.invoke('open-recordings'),
});
