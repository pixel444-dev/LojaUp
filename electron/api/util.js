const crypto = require('crypto');
const dbm = require('../db');

class AppError extends Error {}

const fail = (msg) => { throw new AppError(msg); };
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const pad = (n) => String(n).padStart(2, '0');

function localDate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function localDateTime(d = new Date()) {
  return `${localDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return localDate(new Date(y, m - 1, d + days));
}
function addMonths(dateStr, months) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = new Date(y, m - 1 + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d, lastDay));
  return localDate(target);
}
function daysBetween(a, b) {
  const pa = a.split('-').map(Number), pb = b.split('-').map(Number);
  return Math.round((new Date(pb[0], pb[1] - 1, pb[2]) - new Date(pa[0], pa[1] - 1, pa[2])) / 86400000);
}

function requireUser(ctx) {
  if (!ctx.user) fail('Sessão expirada. Faça login novamente.');
  return ctx.user;
}
function requireAdmin(ctx) {
  const u = requireUser(ctx);
  if (u.role !== 'admin') fail('Apenas administradores podem realizar esta operação.');
  return u;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(String(password), salt, 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
}

const SETTING_DEFAULTS = {
  store_name: 'Minha Loja',
  store_document: '',
  store_address: '',
  store_phone: '',
  receipt_footer: 'Obrigado pela preferência! Trocas em até 30 dias com etiqueta.',
  printer_name: '',
  printer_width: '80',
  print_auto: '0',
  print_silent: '1',
  default_min_stock: '2',
  stale_days: '60',
  credit_block_overdue_days: '30',
  credit_late_fee_percent: '2',
  credit_interest_month_percent: '3',
  credit_max_installments: '6',
  card_max_installments: '6',
  max_discount_percent_seller: '10',
  backup_folders: '[]',
  backup_auto_on_close: '1',
  backup_interval_hours: '24',
  backup_keep: '30',
  last_backup_at: '',
  return_days: '30',
};

function getSetting(key) {
  const row = dbm.get().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : SETTING_DEFAULTS[key] ?? null;
}
function getSettingNum(key) {
  return Number(getSetting(key)) || 0;
}
function setSetting(key, value) {
  dbm.get().prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value == null ? '' : String(value));
}
function allSettings() {
  const out = { ...SETTING_DEFAULTS };
  for (const row of dbm.get().prepare('SELECT key, value FROM settings').all()) out[row.key] = row.value;
  return out;
}

// Gera um EAN-13 interno (prefixo 2, reservado para uso interno da loja)
function generateBarcode() {
  const db = dbm.get();
  for (let attempt = 0; attempt < 50; attempt++) {
    let base = '2' + String(Date.now()).slice(-7) + String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    base = base.slice(0, 12);
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += Number(base[i]) * (i % 2 === 0 ? 1 : 3);
    const code = base + ((10 - (sum % 10)) % 10);
    if (!db.prepare('SELECT 1 FROM product_variants WHERE barcode = ?').get(code)) return code;
  }
  fail('Não foi possível gerar código de barras');
}

module.exports = {
  AppError, fail, r2, localDate, localDateTime, addDays, addMonths, daysBetween,
  requireUser, requireAdmin, hashPassword, verifyPassword,
  getSetting, getSettingNum, setSetting, allSettings, generateBarcode, SETTING_DEFAULTS,
};
