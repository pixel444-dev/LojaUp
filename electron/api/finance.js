const dbm = require('../db');
const { fail, r2, requireUser, requireAdmin, localDate, localDateTime, addDays, addMonths } = require('./util');

function listWhere({ status, from, to, search }, table, dateCol) {
  const today = localDate();
  const where = [];
  const params = { today };
  if (status === 'aberta') where.push(`${table}.status = 'aberta'`);
  if (status === 'vencida') where.push(`${table}.status = 'aberta' AND ${table}.due_date < @today`);
  if (status === 'paga') where.push(`${table}.status = 'paga'`);
  if (from) { where.push(`${table}.${dateCol} >= @from`); params.from = from; }
  if (to) { where.push(`${table}.${dateCol} <= @to`); params.to = to; }
  if (search) { where.push(`(${table}.description LIKE @s OR ${table}.category LIKE @s)`); params.s = `%${search}%`; }
  return { sql: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
}

// Movimentos realizados e previstos por dia
function cashflow(db, from, to) {
  const days = new Map();
  const day = (d) => {
    if (!days.has(d)) days.set(d, { date: d, in: 0, out: 0, in_forecast: 0, out_forecast: 0, details: [] });
    return days.get(d);
  };
  const add = (d, field, value, label) => {
    if (!value) return;
    const row = day(d);
    row[field] = r2(row[field] + value);
    row.details.push({ field, label, value: r2(value) });
  };

  for (const r of db.prepare(`SELECT date(s.created_at) d, sp.method, SUM(sp.amount) v FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id
    WHERE s.status = 'concluida' AND sp.method NOT IN ('crediario','vale') AND date(s.created_at) BETWEEN ? AND ? GROUP BY d, sp.method`).all(from, to)) {
    add(r.d, 'in', r.v, `Vendas (${r.method})`);
  }
  for (const r of db.prepare(`SELECT date(created_at) d, SUM(amount + interest) v FROM installment_payments WHERE date(created_at) BETWEEN ? AND ? GROUP BY d`).all(from, to)) {
    add(r.d, 'in', r.v, 'Recebimentos de crediário');
  }
  for (const r of db.prepare(`SELECT date(received_at) d, SUM(received_amount) v FROM receivables WHERE status = 'paga' AND date(received_at) BETWEEN ? AND ? GROUP BY d`).all(from, to)) {
    add(r.d, 'in', r.v, 'Outros recebimentos');
  }
  for (const r of db.prepare(`SELECT date(paid_at) d, category, SUM(paid_amount) v FROM payables WHERE status = 'paga' AND date(paid_at) BETWEEN ? AND ? GROUP BY d, category`).all(from, to)) {
    add(r.d, 'out', r.v, `Pagamento: ${r.category || 'Outros'}`);
  }
  for (const r of db.prepare(`SELECT date(created_at) d, SUM(total) v FROM returns WHERE refund_method IN ('dinheiro','estorno') AND date(created_at) BETWEEN ? AND ? GROUP BY d`).all(from, to)) {
    add(r.d, 'out', r.v, 'Devoluções reembolsadas');
  }
  for (const r of db.prepare(`SELECT date(created_at) d, SUM(amount) v FROM cash_movements WHERE type = 'estorno' AND date(created_at) BETWEEN ? AND ? GROUP BY d`).all(from, to)) {
    add(r.d, 'out', r.v, 'Estornos de vendas canceladas');
  }
  // Previstos
  const today = localDate();
  const fStart = from > today ? from : today;
  for (const r of db.prepare(`SELECT due_date d, SUM(amount - paid_amount) v FROM installments WHERE status = 'aberta' AND due_date BETWEEN ? AND ? GROUP BY d`).all(fStart, to)) {
    add(r.d, 'in_forecast', r.v, 'Parcelas de crediário a receber');
  }
  for (const r of db.prepare(`SELECT due_date d, SUM(amount) v FROM receivables WHERE status = 'aberta' AND due_date BETWEEN ? AND ? GROUP BY d`).all(fStart, to)) {
    add(r.d, 'in_forecast', r.v, 'Contas a receber');
  }
  for (const r of db.prepare(`SELECT due_date d, SUM(amount) v FROM payables WHERE status = 'aberta' AND due_date BETWEEN ? AND ? GROUP BY d`).all(fStart, to)) {
    add(r.d, 'out_forecast', r.v, 'Contas a pagar');
  }
  // Atrasados entram como previstos para hoje
  if (to >= today) {
    const lateIn = db.prepare("SELECT COALESCE(SUM(amount - paid_amount),0) v FROM installments WHERE status = 'aberta' AND due_date < ?").get(today).v;
    const lateOut = db.prepare("SELECT COALESCE(SUM(amount),0) v FROM payables WHERE status = 'aberta' AND due_date < ?").get(today).v;
    if (lateIn > 0 && from <= today) add(today, 'in_forecast', lateIn, 'Parcelas em atraso (a cobrar)');
    if (lateOut > 0 && from <= today) add(today, 'out_forecast', lateOut, 'Contas atrasadas');
  }

  const rows = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  let balance = 0;
  for (const r of rows) {
    balance = r2(balance + r.in - r.out + r.in_forecast - r.out_forecast);
    r.balance = balance;
  }
  const t = (f) => r2(rows.reduce((a, r) => a + r[f], 0));
  return { rows, totals: { in: t('in'), out: t('out'), in_forecast: t('in_forecast'), out_forecast: t('out_forecast'), result: r2(t('in') - t('out')), projected: balance } };
}

// Demonstrativo simples de resultado do período
function dre(db, from, to) {
  const sales = db.prepare(`SELECT COALESCE(SUM(total),0) revenue, COALESCE(SUM(cost_total),0) cost, COALESCE(SUM(discount),0) discount, COUNT(*) qty
    FROM sales WHERE status = 'concluida' AND date(created_at) BETWEEN ? AND ?`).get(from, to);
  const ret = db.prepare(`SELECT COALESCE(SUM(ri.quantity * ri.unit_price),0) value, COALESCE(SUM(ri.quantity * si.unit_cost),0) cost
    FROM return_items ri JOIN returns r ON r.id = ri.return_id JOIN sale_items si ON si.id = ri.sale_item_id
    WHERE date(r.created_at) BETWEEN ? AND ?`).get(from, to);
  const interest = db.prepare('SELECT COALESCE(SUM(interest),0) v FROM installment_payments WHERE date(created_at) BETWEEN ? AND ?').get(from, to).v;
  // Despesas por competência (vencimento), exceto compras de mercadoria (já entram como CMV)
  const expenses = db.prepare(`SELECT expense_type, COALESCE(category,'Outros') category, SUM(amount) v FROM payables
    WHERE due_date BETWEEN ? AND ? AND purchase_id IS NULL GROUP BY expense_type, category ORDER BY v DESC`).all(from, to);
  const fixed = r2(expenses.filter((e) => e.expense_type === 'fixa').reduce((a, e) => a + e.v, 0));
  const variable = r2(expenses.filter((e) => e.expense_type !== 'fixa').reduce((a, e) => a + e.v, 0));
  const netRevenue = r2(sales.revenue - ret.value);
  const cmv = r2(sales.cost - ret.cost);
  const gross = r2(netRevenue - cmv);
  const net = r2(gross + interest - fixed - variable);
  return {
    sales_count: sales.qty, gross_revenue: r2(sales.revenue + sales.discount), discounts: r2(sales.discount), returns: r2(ret.value),
    net_revenue: netRevenue, cmv, gross_profit: gross, gross_margin: netRevenue ? r2((gross / netRevenue) * 100) : 0,
    interest_income: r2(interest), fixed_expenses: fixed, variable_expenses: variable, expenses,
    net_profit: net, net_margin: netRevenue ? r2((net / netRevenue) * 100) : 0,
  };
}

module.exports = {
  cashflow,
  dre,

  'payables.list': (filters = {}, ctx) => {
    requireUser(ctx);
    const { sql, params } = listWhere(filters, 'payables', 'due_date');
    return dbm.get().prepare(`SELECT payables.*, s.name AS supplier_name FROM payables LEFT JOIN suppliers s ON s.id = payables.supplier_id
      ${sql} ORDER BY payables.status = 'paga', payables.due_date, payables.id LIMIT 1000`).all(params);
  },

  'payables.save': (p, ctx) => {
    requireAdmin(ctx);
    const db = dbm.get();
    if (!p.description) fail('Informe a descrição.');
    const amount = r2(p.amount);
    if (amount <= 0) fail('Informe o valor.');
    if (!p.due_date) fail('Informe o vencimento.');
    const type = p.expense_type === 'fixa' ? 'fixa' : 'variavel';
    if (p.id) {
      db.prepare('UPDATE payables SET description=?, supplier_id=?, category=?, expense_type=?, amount=?, due_date=?, notes=? WHERE id=? AND status = \'aberta\'')
        .run(p.description, p.supplier_id || null, p.category || null, type, amount, p.due_date, p.notes || null, p.id);
      return p.id;
    }
    const repeat = Math.max(1, Math.min(Number(p.repeat) || 1, 36));
    const tx = db.transaction(() => {
      let first;
      for (let k = 0; k < repeat; k++) {
        const id = db.prepare(`INSERT INTO payables (description, supplier_id, category, expense_type, amount, due_date, installment_label, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(p.description, p.supplier_id || null, p.category || null, type, amount, addMonths(p.due_date, k), repeat > 1 ? `${k + 1}/${repeat}` : null, p.notes || null).lastInsertRowid;
        first = first || id;
      }
      return first;
    });
    return tx();
  },

  'payables.pay': ({ id, amount, method, date }, ctx) => {
    requireAdmin(ctx);
    const db = dbm.get();
    const p = db.prepare('SELECT * FROM payables WHERE id = ?').get(id);
    if (!p || p.status !== 'aberta') fail('Conta não encontrada ou já paga.');
    const paidAt = date ? `${date} ${localDateTime().slice(11)}` : localDateTime();
    db.prepare("UPDATE payables SET status = 'paga', paid_at = ?, paid_amount = ?, payment_method = ? WHERE id = ?")
      .run(paidAt, r2(amount ?? p.amount), method || 'dinheiro', id);
    return true;
  },

  'payables.reopen': ({ id }, ctx) => {
    requireAdmin(ctx);
    dbm.get().prepare("UPDATE payables SET status = 'aberta', paid_at = NULL, paid_amount = NULL, payment_method = NULL WHERE id = ?").run(id);
    return true;
  },

  'payables.delete': ({ id }, ctx) => {
    requireAdmin(ctx);
    const db = dbm.get();
    const p = db.prepare('SELECT * FROM payables WHERE id = ?').get(id);
    if (!p) fail('Conta não encontrada.');
    if (p.purchase_id) fail('Contas geradas por compras só podem ser removidas cancelando a compra.');
    db.prepare('DELETE FROM payables WHERE id = ?').run(id);
    return true;
  },

  'payables.categories': (_, ctx) => {
    requireUser(ctx);
    const used = dbm.get().prepare("SELECT DISTINCT category v FROM payables WHERE category IS NOT NULL AND category <> ''").all().map((r) => r.v);
    const base = ['Aluguel', 'Energia', 'Água', 'Internet/Telefone', 'Salários', 'Encargos', 'Pró-labore', 'Impostos', 'Contador',
      'Marketing', 'Embalagens', 'Manutenção', 'Taxas de cartão', 'Sistema/Software', 'Mercadorias', 'Outros'];
    return [...new Set([...base, ...used])];
  },

  'receivables.list': (filters = {}, ctx) => {
    requireUser(ctx);
    const { sql, params } = listWhere(filters, 'receivables', 'due_date');
    return dbm.get().prepare(`SELECT receivables.*, c.name AS customer_name FROM receivables LEFT JOIN customers c ON c.id = receivables.customer_id
      ${sql} ORDER BY receivables.status = 'paga', receivables.due_date LIMIT 1000`).all(params);
  },

  'receivables.save': (r, ctx) => {
    requireAdmin(ctx);
    if (!r.description) fail('Informe a descrição.');
    if (!(r2(r.amount) > 0)) fail('Informe o valor.');
    if (!r.due_date) fail('Informe o vencimento.');
    const db = dbm.get();
    const fields = [r.description, r.customer_id || null, r.category || null, r2(r.amount), r.due_date, r.notes || null];
    if (r.id) {
      db.prepare("UPDATE receivables SET description=?, customer_id=?, category=?, amount=?, due_date=?, notes=? WHERE id=? AND status='aberta'").run(...fields, r.id);
      return r.id;
    }
    return db.prepare('INSERT INTO receivables (description, customer_id, category, amount, due_date, notes) VALUES (?,?,?,?,?,?)').run(...fields).lastInsertRowid;
  },

  'receivables.receive': ({ id, amount, method }, ctx) => {
    requireAdmin(ctx);
    const db = dbm.get();
    const r = db.prepare('SELECT * FROM receivables WHERE id = ?').get(id);
    if (!r || r.status !== 'aberta') fail('Conta não encontrada ou já recebida.');
    db.prepare("UPDATE receivables SET status = 'paga', received_at = datetime('now','localtime'), received_amount = ?, payment_method = ? WHERE id = ?")
      .run(r2(amount ?? r.amount), method || 'dinheiro', id);
    return true;
  },

  'receivables.delete': ({ id }, ctx) => {
    requireAdmin(ctx);
    dbm.get().prepare('DELETE FROM receivables WHERE id = ?').run(id);
    return true;
  },

  'finance.cashflow': ({ from, to }, ctx) => {
    requireAdmin(ctx);
    return cashflow(dbm.get(), from || localDate(), to || addDays(localDate(), 30));
  },

  'finance.dre': ({ from, to }, ctx) => {
    requireAdmin(ctx);
    return dre(dbm.get(), from, to);
  },

  'finance.summary': (_, ctx) => {
    requireAdmin(ctx);
    const db = dbm.get();
    const today = localDate();
    const in7 = addDays(today, 7);
    const q = (sql, ...a) => r2(db.prepare(sql).get(...a).v);
    return {
      payables_overdue: q("SELECT COALESCE(SUM(amount),0) v FROM payables WHERE status='aberta' AND due_date < ?", today),
      payables_today: q("SELECT COALESCE(SUM(amount),0) v FROM payables WHERE status='aberta' AND due_date = ?", today),
      payables_7d: q("SELECT COALESCE(SUM(amount),0) v FROM payables WHERE status='aberta' AND due_date BETWEEN ? AND ?", today, in7),
      payables_open: q("SELECT COALESCE(SUM(amount),0) v FROM payables WHERE status='aberta'"),
      receivables_overdue: q("SELECT COALESCE(SUM(amount - paid_amount),0) v FROM installments WHERE status='aberta' AND due_date < ?", today)
        + q("SELECT COALESCE(SUM(amount),0) v FROM receivables WHERE status='aberta' AND due_date < ?", today),
      receivables_7d: q("SELECT COALESCE(SUM(amount - paid_amount),0) v FROM installments WHERE status='aberta' AND due_date BETWEEN ? AND ?", today, in7)
        + q("SELECT COALESCE(SUM(amount),0) v FROM receivables WHERE status='aberta' AND due_date BETWEEN ? AND ?", today, in7),
      receivables_open: q("SELECT COALESCE(SUM(amount - paid_amount),0) v FROM installments WHERE status='aberta'")
        + q("SELECT COALESCE(SUM(amount),0) v FROM receivables WHERE status='aberta'"),
    };
  },
};
