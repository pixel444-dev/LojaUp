const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const Database = require('better-sqlite3');
const dbm = require('../db');
const { fail, requireAdmin, requireUser, getSetting, setSetting, localDateTime } = require('./util');

const PREFIX = 'LojaUp-backup-';
const PENDRIVE_FOLDER = 'Backup LojaUp';

function oneDriveFolders() {
  const out = [];
  for (const key of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']) {
    const p = process.env[key];
    if (p && fs.existsSync(p) && !out.includes(p)) out.push(p);
  }
  return out;
}

// Pendrives / discos removíveis conectados (Windows)
function removableDrives() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve([]);
    const cmd = "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=2' | Select-Object DeviceID,VolumeName,FreeSpace,Size | ConvertTo-Json -Compress";
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { windowsHide: true, timeout: 15000 }, (err, stdout) => {
      if (err || !stdout.trim()) return resolve([]);
      try {
        let data = JSON.parse(stdout);
        if (!Array.isArray(data)) data = [data];
        resolve(data.filter((d) => d.Size).map((d) => ({ drive: d.DeviceID, label: d.VolumeName || 'Pendrive', free: d.FreeSpace, size: d.Size })));
      } catch (e) { resolve([]); }
    });
  });
}

function stamp() {
  return localDateTime().replace(/:/g, '').replace(' ', '_');
}

function log(destination, file, status, message) {
  try {
    dbm.get().prepare('INSERT INTO backup_log (destination, file, status, message) VALUES (?, ?, ?, ?)').run(destination, file, status, message || null);
  } catch (e) { /* ignora */ }
}

function prune(folder, keep) {
  try {
    const files = fs.readdirSync(folder).filter((f) => f.startsWith(PREFIX) && f.endsWith('.db')).sort().reverse();
    for (const f of files.slice(keep)) fs.unlinkSync(path.join(folder, f));
  } catch (e) { /* ignora */ }
}

async function backupToFolder(folder) {
  const root = path.parse(path.resolve(folder)).root;
  if (!fs.existsSync(root)) throw new Error(`Unidade ${root} não está conectada.`);
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, `${PREFIX}${stamp()}.db`);
  await dbm.get().backup(file);
  // Confere se o arquivo gerado abre corretamente
  const test = new Database(file, { readonly: true });
  try { test.prepare('SELECT COUNT(*) FROM settings').get(); } finally { test.close(); }
  prune(folder, Number(getSetting('backup_keep')) || 30);
  return file;
}

function destinations() {
  try { return JSON.parse(getSetting('backup_folders') || '[]'); } catch (e) { return []; }
}

// Executa o backup em todos os destinos configurados
async function runAll() {
  const results = [];
  const dests = destinations();
  // Cópia local sempre (pasta do sistema), protege contra erro humano
  const localFolder = path.join(path.dirname(dbm.getPath()), 'backups');
  try { results.push({ destination: 'Cópia local', ok: true, file: await backupToFolder(localFolder) }); } catch (e) { results.push({ destination: 'Cópia local', ok: false, error: e.message }); }

  for (const d of dests) {
    if (d.type === 'pendrive') {
      const drives = await removableDrives();
      if (!drives.length) {
        results.push({ destination: 'Pendrive', ok: false, error: 'Nenhum pendrive conectado.' });
        log('Pendrive', null, 'erro', 'Nenhum pendrive conectado.');
        continue;
      }
      for (const drv of drives) {
        const name = `Pendrive ${drv.label} (${drv.drive})`;
        try {
          const file = await backupToFolder(path.join(drv.drive + '\\', PENDRIVE_FOLDER));
          results.push({ destination: name, ok: true, file });
          log(name, file, 'ok');
        } catch (e) {
          results.push({ destination: name, ok: false, error: e.message });
          log(name, null, 'erro', e.message);
        }
      }
    } else if (d.path) {
      const name = d.label || d.path;
      try {
        const file = await backupToFolder(d.path);
        results.push({ destination: name, ok: true, file });
        log(name, file, 'ok');
      } catch (e) {
        results.push({ destination: name, ok: false, error: e.message });
        log(name, null, 'erro', e.message);
      }
    }
  }
  if (results.some((r) => r.ok && r.destination !== 'Cópia local') || !dests.length) setSetting('last_backup_at', localDateTime());
  return results;
}

function needsScheduledBackup() {
  const hours = Number(getSetting('backup_interval_hours')) || 0;
  if (!hours || !destinations().length) return false;
  const last = getSetting('last_backup_at');
  if (!last) return true;
  const t = new Date(last.replace(' ', 'T')).getTime();
  return Date.now() - t >= hours * 3600 * 1000;
}

function isValidBackup(file) {
  let test;
  try {
    test = new Database(file, { readonly: true, fileMustExist: true });
    const tables = test.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((t) => t.name);
    return ['products', 'sales', 'settings', 'users'].every((t) => tables.includes(t));
  } catch (e) {
    return false;
  } finally {
    if (test) test.close();
  }
}

module.exports = {
  runAll,
  needsScheduledBackup,

  'backup.info': async (_, ctx) => {
    requireAdmin(ctx);
    const db = dbm.get();
    let size = 0;
    for (const ext of ['', '-wal']) {
      try { size += fs.statSync(dbm.getPath() + ext).size; } catch (e) { /* ignora */ }
    }
    return {
      dbPath: dbm.getPath(),
      dbSize: size,
      destinations: destinations(),
      oneDrive: oneDriveFolders(),
      drives: await removableDrives(),
      lastBackup: getSetting('last_backup_at'),
      log: db.prepare('SELECT * FROM backup_log ORDER BY id DESC LIMIT 30').all(),
      localFolder: path.join(path.dirname(dbm.getPath()), 'backups'),
      computer: os.hostname(),
    };
  },

  'backup.drives': async (_, ctx) => { requireUser(ctx); return removableDrives(); },

  'backup.run': async (_, ctx) => { requireAdmin(ctx); return runAll(); },

  'backup.runTo': async ({ folder }, ctx) => {
    requireAdmin(ctx);
    if (!folder) fail('Escolha a pasta de destino.');
    const file = await backupToFolder(folder);
    log(folder, file, 'ok', 'Backup manual');
    return file;
  },

  'backup.list': ({ folder }, ctx) => {
    requireAdmin(ctx);
    const folders = folder ? [folder] : [path.join(path.dirname(dbm.getPath()), 'backups'), ...destinations().filter((d) => d.path).map((d) => d.path)];
    const out = [];
    for (const f of folders) {
      try {
        for (const name of fs.readdirSync(f)) {
          if (!name.startsWith(PREFIX) || !name.endsWith('.db')) continue;
          const st = fs.statSync(path.join(f, name));
          out.push({ file: path.join(f, name), name, folder: f, size: st.size, date: st.mtime.toISOString() });
        }
      } catch (e) { /* pasta inexistente */ }
    }
    return out.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 100);
  },

  // Restaura um arquivo de backup (faz cópia de segurança do banco atual antes)
  'backup.restore': async ({ file }, ctx) => {
    requireAdmin(ctx);
    if (!file || !fs.existsSync(file)) fail('Arquivo não encontrado.');
    if (!isValidBackup(file)) fail('O arquivo selecionado não é um backup válido do LojaUp.');
    const dbPath = dbm.getPath();
    const dir = path.dirname(dbPath);
    const safety = path.join(dir, 'backups');
    fs.mkdirSync(safety, { recursive: true });
    await dbm.get().backup(path.join(safety, `${PREFIX}${stamp()}-antes-restauracao.db`));
    const tmp = path.join(dir, 'restore-tmp.db');
    fs.copyFileSync(file, tmp);
    dbm.close();
    for (const ext of ['-wal', '-shm']) { try { fs.unlinkSync(dbPath + ext); } catch (e) { /* ignora */ } }
    fs.renameSync(tmp, dbPath);
    dbm.open(path.dirname(dir));
    ctx.user = null;
    return true;
  },
};
