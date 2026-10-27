const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const http = require('http');
const dbm = require('./db');
const { AppError } = require('./api/util');
const backup = require('./api/backup');

const isDev = process.env.LOJAUP_DEV === '1';
// Em desenvolvimento os dados ficam separados da instalação real
if (isDev) app.setPath('userData', path.join(app.getPath('appData'), 'LojaUp-dev'));
let mainWindow = null;
let quitting = false;

// Contexto da sessão (usuário logado)
const ctx = { user: null };

// Junta todos os métodos da API ("modulo.acao")
const handlers = {};
for (const mod of ['auth', 'products', 'sales', 'customers', 'purchases', 'finance', 'reports', 'backup']) {
  const m = require(`./api/${mod}`);
  for (const [k, fn] of Object.entries(m)) if (k.includes('.') && typeof fn === 'function') handlers[k] = fn;
}

// Métodos que dependem do Electron (janelas, diálogos, impressoras)
handlers['system.chooseFolder'] = async ({ title } = {}) => {
  const r = await dialog.showOpenDialog(mainWindow, { title: title || 'Escolha a pasta', properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
};
handlers['system.chooseFile'] = async ({ title, filters } = {}) => {
  const r = await dialog.showOpenDialog(mainWindow, { title: title || 'Escolha o arquivo', properties: ['openFile'], filters: filters || [{ name: 'Backup LojaUp', extensions: ['db'] }] });
  return r.canceled ? null : r.filePaths[0];
};
handlers['system.openPath'] = async ({ target }) => { await shell.openPath(target); return true; };
handlers['system.info'] = () => ({ version: app.getVersion(), userData: app.getPath('userData'), dbPath: dbm.getPath(), isDev });
handlers['print.printers'] = async () => {
  if (!mainWindow) return [];
  const list = await mainWindow.webContents.getPrintersAsync();
  return list.map((p) => ({ name: p.name, displayName: p.displayName || p.name, isDefault: p.isDefault }));
};
// Imprime um HTML. Para bobina térmica, ajusta a altura da página ao conteúdo.
handlers['print.html'] = async ({ html, silent = true, deviceName, widthMm }) => {
  const win = new BrowserWindow({ show: false, width: 800, height: 1000, webPreferences: { sandbox: true } });
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    await new Promise((r) => setTimeout(r, 150));
    const options = { silent: !!silent, printBackground: true, margins: { marginType: 'none' } };
    if (deviceName) options.deviceName = deviceName;
    if (widthMm) {
      const heightPx = await win.webContents.executeJavaScript('document.documentElement.scrollHeight');
      const heightMm = Math.max(40, Math.ceil((heightPx * 25.4) / 96) + 8);
      options.pageSize = { width: Math.round(widthMm * 1000), height: Math.round(heightMm * 1000) };
    }
    await new Promise((resolve, reject) => {
      win.webContents.print(options, (ok, reason) => (ok || reason === 'cancelled' ? resolve() : reject(new AppError('Falha ao imprimir: ' + reason))));
    });
    return true;
  } finally {
    if (!win.isDestroyed()) win.close();
  }
};
handlers['system.reload'] = () => { setTimeout(() => mainWindow && mainWindow.reload(), 100); return true; };

async function call(method, args) {
  const fn = handlers[method];
  if (!fn) return { ok: false, error: `Método desconhecido: ${method}` };
  try {
    return { ok: true, data: await fn(args || {}, ctx) };
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    if (!(err instanceof AppError)) console.error(`[api] ${method}:`, err);
    if (msg.startsWith('AUTH_REQUIRED:')) return { ok: false, error: msg.slice(14), authRequired: true };
    let friendly = msg;
    if (/UNIQUE constraint failed/.test(msg)) friendly = 'Registro duplicado: já existe um cadastro com esses dados.';
    else if (/FOREIGN KEY constraint failed/.test(msg)) friendly = 'Este registro está vinculado a outros dados e não pode ser alterado/excluído.';
    else if (!(err instanceof AppError)) friendly = 'Erro inesperado: ' + msg;
    return { ok: false, error: friendly };
  }
}

ipcMain.handle('api', (_e, method, args) => call(method, args));

// Em desenvolvimento, expõe a API via HTTP local para testes no navegador
function startDevBridge() {
  http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', 'http://localhost:5173');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.end(); return; }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      try {
        const { method, args } = JSON.parse(body || '{}');
        const out = await call(method, args);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(out));
      } catch (e) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
  }).listen(5174, '127.0.0.1');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 820,
    minWidth: 1100,
    minHeight: 680,
    title: 'LojaUp',
    backgroundColor: '#f4f5f7',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  Menu.setApplicationMenu(null);
  mainWindow.once('ready-to-show', () => { mainWindow.maximize(); mainWindow.show(); });
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12' && isDev) mainWindow.webContents.toggleDevTools();
    if (input.type === 'keyDown' && input.control && input.key.toLowerCase() === 'r' && !isDev) event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
  });

  app.whenReady().then(() => {
    dbm.open(app.getPath('userData'));
    if (isDev) startDevBridge();
    createWindow();

    // Backup automático periódico
    const tick = () => { if (backup.needsScheduledBackup()) backup.runAll().catch((e) => console.error('backup', e)); };
    setTimeout(tick, 60 * 1000);
    setInterval(tick, 30 * 60 * 1000);
  });

  // Backup ao fechar o sistema
  app.on('before-quit', (e) => {
    if (quitting) return;
    const { getSetting } = require('./api/util');
    let auto = false;
    try { auto = getSetting('backup_auto_on_close') === '1'; } catch (err) { auto = false; }
    if (!auto) { quitting = true; dbm.close(); return; }
    e.preventDefault();
    quitting = true;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.executeJavaScript("document.body.innerHTML = '<div style=\"font:16px Segoe UI;display:flex;height:100vh;align-items:center;justify-content:center;color:#334\">Fazendo backup dos dados, aguarde…</div>'").catch(() => {});
    }
    Promise.race([backup.runAll(), new Promise((r) => setTimeout(r, 60000))])
      .catch((err) => console.error('backup ao fechar', err))
      .finally(() => { dbm.close(); app.exit(0); });
  });

  app.on('window-all-closed', () => app.quit());
}
