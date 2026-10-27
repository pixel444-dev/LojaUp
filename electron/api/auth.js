const dbm = require('../db');
const { fail, requireAdmin, requireUser, hashPassword, verifyPassword, allSettings, setSetting, SETTING_DEFAULTS } = require('./util');

const publicUser = (u) => u && ({ id: u.id, name: u.name, username: u.username, role: u.role });

module.exports = {
  'auth.status': (_, ctx) => {
    const count = dbm.get().prepare('SELECT COUNT(*) c FROM users').get().c;
    return { needsSetup: count === 0, user: publicUser(ctx.user), storeName: allSettings().store_name };
  },

  // Primeiro uso: cria loja + administrador
  'auth.setup': ({ storeName, name, username, password }, ctx) => {
    const db = dbm.get();
    if (db.prepare('SELECT COUNT(*) c FROM users').get().c > 0) fail('O sistema já foi configurado.');
    if (!name || !username || !password) fail('Preencha todos os campos.');
    if (String(password).length < 4) fail('A senha deve ter pelo menos 4 caracteres.');
    const id = db.prepare('INSERT INTO users (name, username, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(name.trim(), username.trim(), hashPassword(password), 'admin').lastInsertRowid;
    if (storeName) setSetting('store_name', storeName.trim());
    ctx.user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    return publicUser(ctx.user);
  },

  'auth.login': ({ username, password }, ctx) => {
    const u = dbm.get().prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(String(username || '').trim());
    if (!u || !verifyPassword(password, u.password_hash)) fail('Usuário ou senha inválidos.');
    ctx.user = u;
    return publicUser(u);
  },

  'auth.logout': (_, ctx) => { ctx.user = null; return true; },

  // Confirma a senha de um administrador (para liberar descontos acima do limite, cancelamentos etc.)
  'auth.authorize': ({ username, password }) => {
    const u = dbm.get().prepare("SELECT * FROM users WHERE username = ? AND active = 1 AND role = 'admin'").get(String(username || '').trim());
    if (!u || !verifyPassword(password, u.password_hash)) fail('Autorização negada.');
    return publicUser(u);
  },

  'auth.changePassword': ({ current, password }, ctx) => {
    const user = requireUser(ctx);
    const u = dbm.get().prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    if (!verifyPassword(current, u.password_hash)) fail('Senha atual incorreta.');
    if (String(password).length < 4) fail('A nova senha deve ter pelo menos 4 caracteres.');
    dbm.get().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), u.id);
    return true;
  },

  'users.list': (_, ctx) => {
    requireAdmin(ctx);
    return dbm.get().prepare('SELECT id, name, username, role, active, created_at FROM users ORDER BY name').all();
  },

  'users.save': (u, ctx) => {
    requireAdmin(ctx);
    const db = dbm.get();
    if (!u.name || !u.username) fail('Nome e usuário são obrigatórios.');
    const role = u.role === 'admin' ? 'admin' : 'vendedor';
    if (u.id) {
      if (u.id === ctx.user.id && (role !== 'admin' || !u.active)) fail('Você não pode remover seu próprio acesso de administrador.');
      db.prepare('UPDATE users SET name = ?, username = ?, role = ?, active = ? WHERE id = ?')
        .run(u.name.trim(), u.username.trim(), role, u.active ? 1 : 0, u.id);
      if (u.password) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(u.password), u.id);
      return u.id;
    }
    if (!u.password) fail('Informe uma senha para o novo usuário.');
    return db.prepare('INSERT INTO users (name, username, password_hash, role, active) VALUES (?, ?, ?, ?, 1)')
      .run(u.name.trim(), u.username.trim(), hashPassword(u.password), role).lastInsertRowid;
  },

  'settings.get': (_, ctx) => {
    requireUser(ctx);
    return allSettings();
  },

  'settings.save': (values, ctx) => {
    requireAdmin(ctx);
    const tx = dbm.get().transaction(() => {
      for (const [k, v] of Object.entries(values || {})) {
        if (k in SETTING_DEFAULTS) setSetting(k, typeof v === 'object' ? JSON.stringify(v) : v);
      }
    });
    tx();
    return allSettings();
  },
};
