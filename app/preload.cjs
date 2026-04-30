'use strict';

// Preload script for the Electron renderer. Exposes a narrow, typed-shape
// terminalAPI to the renderer via contextBridge so the page can spawn / write /
// resize PTY processes hosted in the main process — without enabling
// nodeIntegration on the renderer itself.

const { contextBridge, ipcRenderer } = require('electron');

const dataListeners = new Set();
const exitListeners = new Set();

ipcRenderer.on('terminal:data', (_event, payload) => {
  for (const fn of dataListeners) {
    try { fn(payload); } catch (e) { /* listener errors must not break the bus */ }
  }
});

ipcRenderer.on('terminal:exit', (_event, payload) => {
  for (const fn of exitListeners) {
    try { fn(payload); } catch (e) {}
  }
});

contextBridge.exposeInMainWorld('terminalAPI', {
  create({ cwd, cols, rows } = {}) {
    return ipcRenderer.invoke('terminal:create', { cwd, cols, rows });
  },
  write(id, data) {
    return ipcRenderer.invoke('terminal:write', { id, data });
  },
  resize(id, cols, rows) {
    return ipcRenderer.invoke('terminal:resize', { id, cols, rows });
  },
  kill(id) {
    return ipcRenderer.invoke('terminal:kill', { id });
  },
  pickDirectory() {
    return ipcRenderer.invoke('terminal:pick-dir');
  },
  defaultCwd() {
    return ipcRenderer.invoke('terminal:default-cwd');
  },
  onData(fn) {
    dataListeners.add(fn);
    return () => dataListeners.delete(fn);
  },
  onExit(fn) {
    exitListeners.add(fn);
    return () => exitListeners.delete(fn);
  },
});
