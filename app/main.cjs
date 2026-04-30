const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

let pty = null;
try {
  pty = require('node-pty');
} catch (e) {
  console.error('[auto-test-browser] node-pty not loaded:', e && e.message);
  console.error('[auto-test-browser] terminal panel will be disabled. Run: npm install && npx electron-rebuild -f -w node-pty');
}

const terminals = new Map(); // id -> { ptyProcess, cwd, cols, rows }

function nextId() {
  return `term_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function defaultShell() {
  if (process.platform === 'win32') return process.env.COMSPEC || 'powershell.exe';
  return process.env.SHELL || '/bin/zsh';
}

function broadcastData(win, id, data) {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('terminal:data', { id, data });
}

function broadcastExit(win, id, exitCode) {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('terminal:exit', { id, exitCode });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 950,
    title: 'Auto-Test Browser',
    webPreferences: {
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  win.loadFile(path.join(__dirname, 'index.html'));

  ipcMain.handle('terminal:create', async (event, { cwd, cols, rows } = {}) => {
    if (!pty) return { ok: false, error: 'node-pty not installed — run npm install && npx electron-rebuild -f -w node-pty' };
    const workingDir = cwd && fs.existsSync(cwd) ? cwd : os.homedir();
    const id = nextId();
    const ptyProcess = pty.spawn(defaultShell(), [], {
      name: 'xterm-256color',
      cols: cols || 100,
      rows: rows || 30,
      cwd: workingDir,
      env: { ...process.env, TERM: 'xterm-256color', FORCE_COLOR: '1', COLORTERM: 'truecolor' },
    });
    terminals.set(id, { ptyProcess, cwd: workingDir, cols: cols || 100, rows: rows || 30 });
    ptyProcess.onData((data) => broadcastData(win, id, data));
    ptyProcess.onExit(({ exitCode }) => {
      terminals.delete(id);
      broadcastExit(win, id, exitCode);
    });
    return { ok: true, id, cwd: workingDir };
  });

  ipcMain.handle('terminal:write', async (_event, { id, data }) => {
    const t = terminals.get(id);
    if (!t) return { ok: false, error: 'unknown terminal id' };
    try { t.ptyProcess.write(data); return { ok: true }; }
    catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  });

  ipcMain.handle('terminal:resize', async (_event, { id, cols, rows }) => {
    const t = terminals.get(id);
    if (!t) return { ok: false, error: 'unknown terminal id' };
    try {
      t.ptyProcess.resize(Math.max(1, cols | 0), Math.max(1, rows | 0));
      t.cols = cols; t.rows = rows;
      return { ok: true };
    } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  });

  ipcMain.handle('terminal:kill', async (_event, { id }) => {
    const t = terminals.get(id);
    if (!t) return { ok: false, error: 'unknown terminal id' };
    try { t.ptyProcess.kill(); } catch {}
    terminals.delete(id);
    return { ok: true };
  });

  ipcMain.handle('terminal:default-cwd', async () => os.homedir());

  ipcMain.handle('terminal:pick-dir', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Pick working directory for the terminal',
      properties: ['openDirectory'],
    });
    if (res.canceled || !res.filePaths || res.filePaths.length === 0) return { ok: false };
    return { ok: true, path: res.filePaths[0] };
  });

  win.on('closed', () => {
    for (const { ptyProcess } of terminals.values()) {
      try { ptyProcess.kill(); } catch {}
    }
    terminals.clear();
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
