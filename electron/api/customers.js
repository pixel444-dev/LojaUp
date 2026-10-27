const crypto = require('crypto');
const dbm = require('../db');
const { fail, r2, requireUser, requireAdmin, localDate, daysBetween, getSettingNum } = require('./util');

// Juros e multa de uma parcela em atraso (sugestão — o operador pode dispensar)
function lateCharges(ins, today = localDate()) {
  const remaining = r2(ins.amount - ins.paid_amount);
  const days = daysBetween(ins.due_date, today);
  if (days <= 0 || remaining <= 0) return { remaining, days: Math.max(0, days), fee: 0, interest: 0, total: remaining };
  const fee = r2(remaining * getSettingNum('credit_late_fee_percent') / 100);
  const interest = r2(remaining * (getSettingNum('credit_interest_month_percent') / 100 / 30) * days);
  return { remaining, days, fee, interest, total: r2(remaining + fee + interest) };
}

// Situação de crédito e análise de inadimplência do cliente
function customerCreditStatus(db, customerId) {
  const c = db.prepare('SELECT credit_limit FROM customers WHERE id = ?').get(customerId);
  if (!c) fail('Cliente não encontrado.');
  const today = localDate();
  const open = db.prepare("SELECT * FROM installments WHERE customer_id = ? AND status = 'aberta'").all(customerId);
  const balance = r2(open.reduce((a, i) => a + i.amount - i.paid_amount, 0));
  const overdue = open.filter((i) => i.due_date < today);
  const overdueAmount = r2(overdue.reduce((a, i) => a + i.amount - i.paid_amount, 0));
  const maxDaysLate = overdue.reduce((m, i) => Math.max(m, daysBetween(i.due_date, today)), 0);

  // Histórico: parcelas pagas no prazo x com atraso
  const paid = db.prepare("SELECT due_date, paid_at FROM installments WHERE customer_id = ? AND status = 'paga' AND paid_at IS NOT NULL").all(customerId);
  const late = paid.filter((p) => p.paid_at.slice(0, 10) > p.due_date);
  const avgDelay = late.length ? Math.round(late.reduce((a, p) => a + daysBetween(p.due_date, p.paid_at.slice(0, 10)), 0) / late.length) : 0;
  const onTimeRate = paid.length ? Math.round(((paid.length - late.length) / paid.length) * 100) : null;

  let rating = 'novo';
  if (maxDaysLate > 30) rating = 'inadimplente';
  else if (maxDaysLate > 0 || (onTimeRate !== null && onTimeRate < 70)) rating = 'atencao';
  else if (paid.length >= 3 && onTimeRate >= 90) rating = 'otimo';
  else if (paid.length > 0) rating = 'bom';

  return {
    limit: r2(c.credit_limit), balance, available: r2(Math.max(0, c.credit_limit - balance)),
    overdueAmount, overdueCount: overdue.length, maxDaysLate,
    paidCount: paid.length, lateCount: late.length, onTimeRate, avgDelay, rating,
  };
}

module.exports = {
  customerCreditStatus,
  lateCharges,

  'customers.list': ({ search = '', filter = '' } = {}, ctx) => {
    requireUser(ctx);
    const db = dbm.get();
    const today = localDate();
    const params = { today };
    let where = 'c.active = 1';
    if (search) {
      where += ' AND (c.name LIKE @s OR c.cpf LIKE @s OR c.phone LIKE @s)';
      params.s = `%${search}%`;
    }
    const rows = db.prepare(`SELECT c.*,
      (SELECT COALESCE(SUM(amount - paid_amount),0) FROM installments WHERE customer_id = c.id AND status = 'aberta') AS balance,
      (SELECT COALESCE(SUM(amount - paid_amount),0) FROM installments WHERE customer_id = c.id AND status = 'aberta' AND due_date < @today) AS overdue,
      (SELECT MIN(due_date) FROM installments WHERE customer_id = c.id AND status = 'aberta' AND due_date < @today) AS oldest_overdue,
      (SELECT MAX(created_at) FROM sales WHERE customer_id = c.id AND status = 'concluida') AS last_purchase,
      (SELECT COALESCE(SUM(total),0) FROM sales WHERE customer_id = c.id AND status = 'concluida') AS total_spent
      FROM customers c WHERE ${where} ORDER BY c.name`).all(params);
    if (filter === 'devedores') return rows.filter((r) => r.balance > 0);
    if (filter === 'atrasados') return rows.filter((r) => r.overdue > 0);
    if (filter === 'aniversariantes') {
      const m = today.slice(5, 7);
      return rows.filter((r) => r.birth_date && r.birth_date.slice(5, 7) === m);
    }
    return rows;
  },

  'customers.get': ({ id }, ctx) => {
    requireUser(ctx);
    const db = dbm.get();
    const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    if (!c) fail('Cliente não encontrado.');
    c.credit = customerCreditStatus(db, id);
    c.sales = db.prepare(`SELECT s.*, (SELECT GROUP_CONCAT(description || ' x' || quantity, ', ') FROM sale_items WHERE sale_id = s.id) AS items_desc,
      (SELECT GROUP_CONCAT(DISTINCT method) FROM sale_payments WHERE sale_id = s.id) AS methods
      FROM sales s WHERE s.customer_id = ? ORDER BY s.id DESC LIMIT 200`).all(id);
    c.installments = db.prepare("SELECT * FROM installments WHERE customer_id = ? AND status <> 'cancelada' ORDER BY due_date, number").all(id)
      .map((i) => (i.status === 'aberta' ? { ...i, charges: lateCharges(i) } : i));
    c.payments = db.prepare(`SELECT ip.*, i.number, i.total_numbers, i.sale_id, u.name AS user_name FROM installment_payments ip
      JOIN installments i ON i.id = ip.installment_id LEFT JOIN users u ON u.id = ip.user_id
      WHERE ip.customer_id = ? ORDER BY ip.id DESC LIMIT 200`).all(id);
    c.vouchers = db.prepare('SELECT * FROM vouchers WHERE customer_id = ? AND balance > 0').all(id);
    const stats = db.prepare(`SELECT COUNT(*) qty, COALESCE(SUM(total),0) total, MAX(created_at) last FROM sales WHERE customer_id = ? AND status = 'concluida'`).get(id);
    c.stats = { ...stats, ticket: stats.qty ? r2(stats.total / stats.qty) : 0 };
    c.favorites = db.prepare(`SELECT p.category, p.brand, v.size, SUM(si.quantity) qty FROM sale_items si
      JOIN sales s ON s.id = si.sale_id JOIN product_variants v ON v.id = si.variant_id JOIN products p ON p.id = si.product_id
      WHERE s.customer_id = ? AND s.status = 'concluida' GROUP BY p.category, v.size ORDER BY qty DESC LIMIT 5`).all(id);
    return c;
  },

  'customers.credit': ({ id }, ctx) => {
    requireUser(ctx);
    return customerCreditStatus(dbm.get(), id);
  },

  'customers.save': (c, ctx) => {
    const user = requireUser(ctx);
    const db = dbm.get();
    if (!c.name || !c.name.trim()) fail('Informe o nome do cliente.');
    const cpf = (c.cpf || '').replace(/\D/g, '') || null;
    if (cpf) {
      const dup = db.prepare('SELECT id, name FROM customers WHERE cpf = ? AND id <> ? AND active = 1').get(cpf, c.id || 0);
      if (dup) fail(`CPF já cadastrado para ${dup.name}.`);
    }
    // Somente administrador altera limite de crédito
    let limit = r2(c.credit_limit);
    if (user.role !== 'admin') {
      const prev = c.id ? db.prepare('SELECT credit_limit FROM customers WHERE id = ?').get(c.id) : null;
      limit = prev ? prev.credit_limit : 0;
    }
    const fields = [c.name.trim(), cpf, c.phone || null, c.email || null, c.birth_date || null, c.address || null, c.city || null, limit, c.notes || null];
    if (c.id) {
      db.prepare('UPDATE customers SET name=?, cpf=?, phone=?, email=?, birth_date=?, address=?, city=?, credit_limit=?, notes=? WHERE id=?').run(...fields, c.id);
      return c.id;
    }
    return db.prepare('INSERT INTO customers (name, cpf, phone, email, birth_date, address, city, credit_limit, notes) VALUES (?,?,?,?,?,?,?,?,?)').run(...fields).lastInsertRowid;
  },

  'customers.delete': ({ id }, ctx) => {
    requireAdmin(ctx);
    const db = dbm.get();
    const st = customerCreditStatus(db, id);
    if (st.balance > 0) fail('Cliente possui parcelas em aberto.');
    db.prepare('UPDATE customers SET active = 0 WHERE id = ?').run(id);
    return true;
  },

  // ---------- Crediário ----------
  'installments.list': ({ status = 'aberta', from, to, search = '' } = {}, ctx) => {
    requireUser(ctx);
    const today = localDate();
    const where = ["i.status <> 'cancelada'"];
    const params = { today };
    if (status === 'aberta') where.push("i.status = 'aberta'");
    if (status === 'vencida') where.push("i.status = 'aberta' AND i.due_date < @today");
    if (status === 'paga') where.push("i.status = 'paga'");
    if (from) { where.push('i.due_date >= @from'); params.from = from; }
    if (to) { where.push('i.due_date <= @to'); params.to = to; }
    if (search) { where.push('(c.name LIKE @s OR c.cpf LIKE @s)'); params.s = `%${search}%`; }
    return dbm.get().prepare(`SELECT i.*, c.name AS customer_name, c.phone AS customer_phone
      FROM installments i JOIN customers c ON c.id = i.customer_id WHERE ${where.join(' AND ')}
      ORDER BY i.due_date, c.name LIMIT 1000`).all(params)
      .map((i) => (i.status === 'aberta' ? { ...i, charges: lateCharges(i, today) } : i));
  },

  // Recebe uma ou mais parcelas. items: [{installment_id, amount, interest}]
  'installments.pay': ({ customerId, items, method }, ctx) => {
    const user = requireUser(ctx);
    const db = dbm.get();
    if (!['dinheiro', 'pix', 'debito', 'credito'].includes(method)) fail('Forma de pagamento inválida.');
    const tx = db.transaction(() => {
      const session = db.prepare("SELECT * FROM cash_sessions WHERE status = 'aberto' ORDER BY id DESC LIMIT 1").get();
      if (!session && method === 'dinheiro') fail('Abra o caixa para receber em dinheiro.');
      const group = crypto.randomBytes(6).toString('hex');
      let count = 0;
      for (const it of items || []) {
        const ins = db.prepare('SELECT * FROM installments WHERE id = ? AND customer_id = ?').get(it.installment_id, customerId);
        if (!ins || ins.status !== 'aberta') fail('Parcela inválida ou já quitada.');
        const remaining = r2(ins.amount - ins.paid_amount);
        const principal = r2(Math.min(r2(it.amount), remaining));
        const interest = r2(Math.max(0, it.interest || 0));
        if (principal <= 0) continue;
        const paidTotal = r2(ins.paid_amount + principal);
        const done = paidTotal >= ins.amount - 0.001;
        db.prepare(`UPDATE installments SET paid_amount = ?, status = ?, paid_at = CASE WHEN ? THEN datetime('now','localtime') ELSE paid_at END WHERE id = ?`)
          .run(paidTotal, done ? 'paga' : 'aberta', done ? 1 : 0, ins.id);
        db.prepare(`INSERT INTO installment_payments (installment_id, customer_id, amount, interest, method, cash_session_id, user_id, receipt_group)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(ins.id, customerId, principal, interest, method, session ? session.id : null, user.id, group);
        count++;
      }
      if (!count) fail('Nenhum valor informado.');
      return group;
    });
    return tx();
  },

  'installments.receipt': ({ group }, ctx) => {
    requireUser(ctx);
    const db = dbm.get();
    const rows = db.prepare(`SELECT ip.*, i.number, i.total_numbers, i.due_date, i.sale_id, i.amount AS installment_amount, i.paid_amount AS installment_paid,
      c.name AS customer_name, c.cpf AS customer_cpf, u.name AS user_name
      FROM installment_payments ip JOIN installments i ON i.id = ip.installment_id JOIN customers c ON c.id = ip.customer_id
      LEFT JOIN users u ON u.id = ip.user_id WHERE ip.receipt_group = ? ORDER BY i.due_date`).all(group);
    if (!rows.length) fail('Recibo não encontrado.');
    const credit = customerCreditStatus(db, rows[0].customer_id);
    return { group, rows, total: r2(rows.reduce((a, r) => a + r.amount + r.interest, 0)), balance: credit.balance, created_at: rows[0].created_at };
  },

  // Análise geral de inadimplência
  'credit.analysis': (_, ctx) => {
    requireUser(ctx);
    const db = dbm.get();
    const today = localDate();
    const open = db.prepare("SELECT i.*, c.name AS customer_name FROM installments i JOIN customers c ON c.id = i.customer_id WHERE i.status = 'aberta'").all();
    const buckets = { a_vencer: 0, ate_30: 0, de_31_60: 0, de_61_90: 0, acima_90: 0 };
    for (const i of open) {
      const rem = i.amount - i.paid_amount;
      const d = daysBetween(i.due_date, today);
      if (d <= 0) buckets.a_vencer += rem;
      else if (d <= 30) buckets.ate_30 += rem;
      else if (d <= 60) buckets.de_31_60 += rem;
      else if (d <= 90) buckets.de_61_90 += rem;
      else buckets.acima_90 += rem;
    }
    Object.keys(buckets).forEach((k) => { buckets[k] = r2(buckets[k]); });
    const totalOpen = r2(open.reduce((a, i) => a + i.amount - i.paid_amount, 0));
    const overdue = r2(totalOpen - buckets.a_vencer);
    const next30 = r2(open.filter((i) => i.due_date >= today && daysBetween(today, i.due_date) <= 30).reduce((a, i) => a + i.amount - i.paid_amount, 0));
    const debtors = db.prepare(`SELECT c.id, c.name, c.phone, SUM(i.amount - i.paid_amount) overdue, MIN(i.due_date) oldest, COUNT(*) qty
      FROM installments i JOIN customers c ON c.id = i.customer_id WHERE i.status = 'aberta' AND i.due_date < ?
      GROUP BY c.id ORDER BY overdue DESC`).all(today).map((d) => ({ ...d, overdue: r2(d.overdue), days: daysBetween(d.oldest, today) }));
    const monthStart = today.slice(0, 8) + '01';
    const received = db.prepare('SELECT COALESCE(SUM(amount + interest),0) v FROM installment_payments WHERE date(created_at) >= ?').get(monthStart).v;
    return { buckets, totalOpen, overdue, overdueRate: totalOpen ? Math.round((overdue / totalOpen) * 100) : 0, next30, debtors, receivedMonth: r2(received) };
  },
};
