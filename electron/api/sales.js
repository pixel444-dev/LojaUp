const dbm = require('../db');
const {
  fail, r2, requireUser, requireAdmin, verifyPassword, localDate, addDays, addMonths,
  getSettingNum,
} = require('./util');
const { moveStock, VARIANT_SELECT, withPromo, variantLabel } = require('./products');
const { customerCreditStatus } = require('./customers');

const METHODS = ['dinheiro', 'pix', 'debito', 'credito', 'crediario', 'vale'];

function openSession(db) {
  return db.prepare("SELECT * FROM cash_sessions WHERE status = 'aberto' ORDER BY id DESC LIMIT 1").get();
}

function checkAuthorization(db, auth) {
  if (!auth || !auth.username) return null;
  const u = db.prepare("SELECT * FROM users WHERE username = ? AND role = 'admin' AND active = 1").get(auth.username);
  if (!u || !verifyPassword(auth.password, u.password_hash)) fail('Autorização do administrador inválida.');
  return u;
}

function sessionSummary(db, session) {
  const id = session.id;
  const salesByMethod = db.prepare(`SELECT sp.method, SUM(sp.amount) total, COUNT(DISTINCT s.id) qty
    FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id
    WHERE s.cash_session_id = ? AND s.status = 'concluida' GROUP BY sp.method`).all(id);
  const salesInfo = db.prepare(`SELECT COUNT(*) qty, COALESCE(SUM(total),0) total, COALESCE(SUM(discount),0) discount
    FROM sales WHERE cash_session_id = ? AND status = 'concluida'`).get(id);
  const canceled = db.prepare("SELECT COUNT(*) qty, COALESCE(SUM(total),0) total FROM sales WHERE cash_session_id = ? AND status = 'cancelada'").get(id);
  const receiptsByMethod = db.prepare(`SELECT method, SUM(amount + interest) total, COUNT(*) qty
    FROM installment_payments WHERE cash_session_id = ? GROUP BY method`).all(id);
  const refunds = db.prepare(`SELECT refund_method method, SUM(total) total, COUNT(*) qty
    FROM returns WHERE cash_session_id = ? GROUP BY refund_method`).all(id);
  const moves = db.prepare(`SELECT cm.*, u.name AS user_name FROM cash_movements cm LEFT JOIN users u ON u.id = cm.user_id
    WHERE session_id = ? ORDER BY id`).all(id);

  const sum = (arr, method) => r2(arr.filter((r) => r.method === method).reduce((a, r) => a + r.total, 0));
  const suprimentos = r2(moves.filter((m) => m.type === 'suprimento').reduce((a, m) => a + m.amount, 0));
  const sangrias = r2(moves.filter((m) => m.type === 'sangria').reduce((a, m) => a + m.amount, 0));
  const estornos = r2(moves.filter((m) => m.type === 'estorno').reduce((a, m) => a + m.amount, 0));
  const cashRefunds = sum(refunds, 'dinheiro');
  const expectedCash = r2(session.opening_amount + sum(salesByMethod, 'dinheiro') + sum(receiptsByMethod, 'dinheiro')
    + suprimentos - sangrias - estornos - cashRefunds);

  const byMethod = {};
  for (const m of METHODS) {
    byMethod[m] = { sales: sum(salesByMethod, m), receipts: sum(receiptsByMethod, m) };
  }
  return {
    session, byMethod, salesInfo, canceled, refunds, moves,
    suprimentos, sangrias, estornos, cashRefunds, expectedCash,
    ticket: salesInfo.qty ? r2(salesInfo.total / salesInfo.qty) : 0,
  };
}

function genVoucherCode(db) {
  for (;;) {
    const code = 'VT' + String(Math.floor(100000 + Math.random() * 900000));
    if (!db.prepare('SELECT 1 FROM vouchers WHERE code = ?').get(code)) return code;
  }
}

function saleDetail(db, id) {
  const sale = db.prepare(`SELECT s.*, c.name AS customer_name, c.cpf AS customer_cpf, c.phone AS customer_phone, u.name AS user_name
    FROM sales s LEFT JOIN customers c ON c.id = s.customer_id LEFT JOIN users u ON u.id = s.user_id WHERE s.id = ?`).get(id);
  if (!sale) fail('Venda não encontrada.');
  sale.items = db.prepare(`SELECT si.*, v.barcode, v.color, v.size FROM sale_items si
    JOIN product_variants v ON v.id = si.variant_id WHERE si.sale_id = ? ORDER BY si.id`).all(id);
  sale.payments = db.prepare(`SELECT sp.*, vo.code AS voucher_code FROM sale_payments sp
    LEFT JOIN vouchers vo ON vo.id = sp.voucher_id WHERE sp.sale_id = ?`).all(id);
  sale.installments = db.prepare('SELECT * FROM installments WHERE sale_id = ? ORDER BY number').all(id);
  sale.returns = db.prepare(`SELECT r.*, u.name AS user_name, vo.code AS voucher_code FROM returns r
    LEFT JOIN users u ON u.id = r.user_id LEFT JOIN vouchers vo ON vo.id = r.voucher_id WHERE r.sale_id = ? ORDER BY r.id`).all(id);
  for (const r of sale.returns) {
    r.items = db.prepare(`SELECT ri.*, si.description FROM return_items ri JOIN sale_items si ON si.id = ri.sale_item_id WHERE ri.return_id = ?`).all(r.id);
  }
  return sale;
}

module.exports = {
  openSession,
  sessionSummary,
  saleDetail,

  // ---------- Caixa ----------
  'cash.current': (_, ctx) => {
    requireUser(ctx);
    const db = dbm.get();
    const s = openSession(db);
    if (!s) return null;
    const summary = sessionSummary(db, s);
    summary.session.user_name = db.prepare('SELECT name FROM users WHERE id = ?').get(s.user_id)?.name;
    return summary;
  },

  'cash.open': ({ amount }, ctx) => {
    const user = requireUser(ctx);
    const db = dbm.get();
    if (openSession(db)) fail('Já existe um caixa aberto.');
    return db.prepare('INSERT INTO cash_sessions (user_id, opening_amount) VALUES (?, ?)').run(user.id, r2(amount)).lastInsertRowid;
  },

  'cash.movement': ({ type, amount, description }, ctx) => {
    const user = requireUser(ctx);
    const db = dbm.get();
    const s = openSession(db);
    if (!s) fail('Nenhum caixa aberto.');
    if (!['sangria', 'suprimento'].includes(type)) fail('Tipo inválido.');
    const value = r2(amount);
    if (value <= 0) fail('Informe um valor maior que zero.');
    if (type === 'sangria') {
      const { expectedCash } = sessionSummary(db, s);
      if (value > expectedCash + 0.001) fail(`Valor maior que o dinheiro em caixa (R$ ${expectedCash.toFixed(2)}).`);
    }
    return db.prepare('INSERT INTO cash_movements (session_id, type, amount, description, user_id) VALUES (?, ?, ?, ?, ?)')
      .run(s.id, type, value, description || null, user.id).lastInsertRowid;
  },

  'cash.close': ({ counted, notes }, ctx) => {
    const user = requireUser(ctx);
    const db = dbm.get();
    const s = openSession(db);
    if (!s) fail('Nenhum caixa aberto.');
    const { expectedCash } = sessionSummary(db, s);
    const c = r2(counted);
    db.prepare(`UPDATE cash_sessions SET status = 'fechado', closed_at = datetime('now','localtime'), closed_by = ?,
      counted_amount = ?, expected_amount = ?, difference = ?, notes = ? WHERE id = ?`)
      .run(user.id, c, expectedCash, r2(c - expectedCash), notes || null, s.id);
    return s.id;
  },

  'cash.history': ({ limit = 60 } = {}, ctx) => {
    requireUser(ctx);
    return dbm.get().prepare(`SELECT cs.*, u.name AS user_name, u2.name AS closed_by_name,
      (SELECT COALESCE(SUM(total),0) FROM sales WHERE cash_session_id = cs.id AND status = 'concluida') AS sales_total,
      (SELECT COUNT(*) FROM sales WHERE cash_session_id = cs.id AND status = 'concluida') AS sales_count
      FROM cash_sessions cs LEFT JOIN users u ON u.id = cs.user_id LEFT JOIN users u2 ON u2.id = cs.closed_by
      ORDER BY cs.id DESC LIMIT ${Number(limit) || 60}`).all();
  },

  'cash.get': ({ id }, ctx) => {
    requireUser(ctx);
    const db = dbm.get();
    const s = db.prepare(`SELECT cs.*, u.name AS user_name, u2.name AS closed_by_name FROM cash_sessions cs
      LEFT JOIN users u ON u.id = cs.user_id LEFT JOIN users u2 ON u2.id = cs.closed_by WHERE cs.id = ?`).get(id);
    if (!s) fail('Caixa não encontrado.');
    return sessionSummary(db, s);
  },

  // ---------- Vendas ----------
  'vouchers.get': ({ code }, ctx) => {
    requireUser(ctx);
    const v = dbm.get().prepare(`SELECT vo.*, c.name AS customer_name FROM vouchers vo LEFT JOIN customers c ON c.id = vo.customer_id
      WHERE vo.code = ?`).get(String(code || '').trim().toUpperCase());
    if (!v) fail('Vale-troca não encontrado.');
    return v;
  },

  'sales.create': (data, ctx) => {
    const user = requireUser(ctx);
    const db = dbm.get();
    const tx = db.transaction(() => {
      const session = openSession(db);
      if (!session) fail('Abra o caixa antes de registrar vendas.');
      if (!data.items || !data.items.length) fail('Adicione pelo menos um produto.');
      const authorizer = checkAuthorization(db, data.authorization);

      // Monta itens com preço de referência do servidor
      let subtotal = 0;
      let listTotal = 0;
      const items = data.items.map((it) => {
        const v = db.prepare(`${VARIANT_SELECT} WHERE v.id = ?`).get(it.variant_id);
        if (!v) fail('Produto não encontrado.');
        const [pv] = withPromo(db, [v]);
        const qty = Math.trunc(Number(it.quantity));
        if (!(qty > 0)) fail(`Quantidade inválida para ${variantLabel(v)}.`);
        const reference = pv.promo_price ?? pv.price;
        const unitPrice = r2(it.unit_price ?? reference);
        const itemDiscount = r2(it.discount || 0);
        const gross = r2(unitPrice * qty);
        if (itemDiscount < 0 || itemDiscount > gross) fail('Desconto do item inválido.');
        subtotal += gross;
        listTotal += r2(pv.price * qty);
        return {
          v: pv, qty, unitPrice, itemDiscount, gross,
          promotion_id: pv.promo_price != null && unitPrice === pv.promo_price ? pv.promotion_id : null,
          manualDiscount: r2(Math.max(0, reference * qty - (gross - itemDiscount))),
        };
      });
      subtotal = r2(subtotal);
      const globalDiscount = r2(data.discount || 0);
      const itemsDiscount = r2(items.reduce((a, i) => a + i.itemDiscount, 0));
      const total = r2(subtotal - itemsDiscount - globalDiscount);
      if (globalDiscount < 0 || total < 0) fail('Desconto inválido.');

      // Limite de desconto do vendedor (descontos manuais, promoções não contam)
      const manual = r2(items.reduce((a, i) => a + i.manualDiscount, 0) + globalDiscount);
      const reference = r2(items.reduce((a, i) => a + (i.v.promo_price ?? i.v.price) * i.qty, 0));
      const maxPct = getSettingNum('max_discount_percent_seller');
      if (user.role !== 'admin' && !authorizer && reference > 0 && manual / reference * 100 > maxPct + 0.001) {
        fail(`AUTH_REQUIRED:Desconto acima de ${maxPct}% precisa de autorização do administrador.`);
      }

      // Pagamentos
      const payments = (data.payments || []).filter((p) => r2(p.amount) > 0);
      if (!payments.length) fail('Informe a forma de pagamento.');
      for (const p of payments) if (!METHODS.includes(p.method)) fail('Forma de pagamento inválida.');
      const paid = r2(payments.reduce((a, p) => a + r2(p.amount), 0));
      const cashPaid = r2(payments.filter((p) => p.method === 'dinheiro').reduce((a, p) => a + r2(p.amount), 0));
      let change = r2(paid - total);
      if (change < -0.001) fail(`Pagamento insuficiente. Faltam R$ ${(-change).toFixed(2)}.`);
      if (change > 0.001 && change > cashPaid + 0.001) fail('Troco só pode ser dado em pagamentos em dinheiro.');
      change = Math.max(0, change);

      const crediario = payments.filter((p) => p.method === 'crediario');
      const crediarioTotal = r2(crediario.reduce((a, p) => a + r2(p.amount), 0));
      if (crediarioTotal > 0) {
        if (!data.customer_id) fail('Selecione o cliente para vender no crediário.');
        const status = customerCreditStatus(db, data.customer_id);
        if (status.limit <= 0 && !authorizer) fail('AUTH_REQUIRED:Cliente sem limite de crédito definido. Defina um limite no cadastro ou peça autorização.');
        if (status.limit > 0 && crediarioTotal > status.available + 0.001 && !authorizer) {
          fail(`AUTH_REQUIRED:Limite insuficiente. Disponível: R$ ${status.available.toFixed(2)}.`);
        }
        const blockDays = getSettingNum('credit_block_overdue_days');
        if (blockDays > 0 && status.maxDaysLate >= blockDays && !authorizer) {
          fail(`AUTH_REQUIRED:Cliente com parcela vencida há ${status.maxDaysLate} dias.`);
        }
      }

      const costTotal = r2(items.reduce((a, i) => a + (i.v.cost || 0) * i.qty, 0));
      const saleId = db.prepare(`INSERT INTO sales (customer_id, user_id, cash_session_id, subtotal, discount, total, cost_total, change_amount, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(data.customer_id || null, user.id, session.id, subtotal, r2(itemsDiscount + globalDiscount), total, costTotal, change, data.notes || null).lastInsertRowid;

      // Rateia o desconto geral entre os itens (para devoluções proporcionais)
      let remainingGlobal = globalDiscount;
      items.forEach((i, idx) => {
        const base = r2(i.gross - i.itemDiscount);
        const share = idx === items.length - 1 ? remainingGlobal : r2(subtotal - itemsDiscount > 0 ? globalDiscount * base / (subtotal - itemsDiscount) : 0);
        remainingGlobal = r2(remainingGlobal - share);
        const lineTotal = r2(base - share);
        db.prepare(`INSERT INTO sale_items (sale_id, variant_id, product_id, description, quantity, unit_price, unit_cost, discount, total, promotion_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(saleId, i.v.id, i.v.product_id, variantLabel(i.v), i.qty, i.unitPrice, i.v.cost || 0, r2(i.itemDiscount + share), lineTotal, i.promotion_id);
        moveStock(db, { variantId: i.v.id, qty: -i.qty, type: 'venda', unitCost: i.v.cost, refType: 'venda', refId: saleId, userId: user.id });
      });

      for (const p of payments) {
        let amount = r2(p.amount);
        let voucherId = null;
        if (p.method === 'dinheiro' && change > 0) {
          const used = Math.min(change, amount);
          amount = r2(amount - used);
          change = r2(change - used);
        }
        if (p.method === 'vale') {
          const vo = db.prepare('SELECT * FROM vouchers WHERE code = ?').get(String(p.voucher_code || '').trim().toUpperCase());
          if (!vo) fail('Vale-troca não encontrado.');
          if (vo.balance + 0.001 < amount) fail(`Saldo do vale ${vo.code} insuficiente (R$ ${vo.balance.toFixed(2)}).`);
          db.prepare('UPDATE vouchers SET balance = ? WHERE id = ?').run(r2(vo.balance - amount), vo.id);
          voucherId = vo.id;
        }
        if (amount > 0) {
          db.prepare('INSERT INTO sale_payments (sale_id, method, amount, installments, voucher_id) VALUES (?, ?, ?, ?, ?)')
            .run(saleId, p.method, amount, Math.max(1, Number(p.installments) || 1), voucherId);
        }
      }

      // Parcelas do crediário
      if (crediarioTotal > 0) {
        const cfg = data.crediario || {};
        const n = Math.max(1, Math.min(Number(cfg.installments) || 1, 24));
        let due = cfg.first_due || addDays(localDate(), 30);
        const base = Math.floor((crediarioTotal / n) * 100) / 100;
        const first = r2(crediarioTotal - base * (n - 1));
        const firstDue = due;
        for (let k = 1; k <= n; k++) {
          due = k === 1 ? firstDue : addMonths(firstDue, k - 1);
          db.prepare('INSERT INTO installments (sale_id, customer_id, number, total_numbers, amount, due_date) VALUES (?, ?, ?, ?, ?, ?)')
            .run(saleId, data.customer_id, k, n, k === 1 ? first : base, due);
        }
      }
      return saleId;
    });
    return tx();
  },

  'sales.list': ({ from, to, status, customerId, userId, search, limit = 500 } = {}, ctx) => {
    requireUser(ctx);
    const where = [];
    const params = {};
    if (from) { where.push('date(s.created_at) >= @from'); params.from = from; }
    if (to) { where.push('date(s.created_at) <= @to'); params.to = to; }
    if (status) { where.push('s.status = @status'); params.status = status; }
    if (customerId) { where.push('s.customer_id = @customerId'); params.customerId = customerId; }
    if (userId) { where.push('s.user_id = @userId'); params.userId = userId; }
    if (search) {
      where.push('(CAST(s.id AS TEXT) = @exact OR c.name LIKE @like OR EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id = s.id AND si.description LIKE @like))');
      params.exact = String(search).replace(/^#/, '');
      params.like = `%${search}%`;
    }
    return dbm.get().prepare(`SELECT s.*, c.name AS customer_name, u.name AS user_name,
      (SELECT GROUP_CONCAT(DISTINCT method) FROM sale_payments WHERE sale_id = s.id) AS methods,
      (SELECT COALESCE(SUM(quantity),0) FROM sale_items WHERE sale_id = s.id) AS pieces,
      (SELECT COALESCE(SUM(total),0) FROM returns WHERE sale_id = s.id) AS returned_total
      FROM sales s LEFT JOIN customers c ON c.id = s.customer_id LEFT JOIN users u ON u.id = s.user_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY s.id DESC LIMIT ${Number(limit) || 500}`).all(params);
  },

  'sales.get': ({ id }, ctx) => {
    requireUser(ctx);
    return saleDetail(dbm.get(), id);
  },

  'sales.cancel': ({ id, reason }, ctx) => {
    const user = requireAdmin(ctx);
    const db = dbm.get();
    if (!reason) fail('Informe o motivo do cancelamento.');
    const tx = db.transaction(() => {
      const sale = saleDetail(db, id);
      if (sale.status !== 'concluida') fail('Esta venda já está cancelada.');
      if (sale.returns.length) fail('Esta venda possui devoluções/trocas registradas e não pode ser cancelada.');
      if (sale.installments.some((i) => i.paid_amount > 0)) fail('Há parcelas do crediário já pagas. Use a devolução para esta venda.');

      for (const it of sale.items) {
        moveStock(db, { variantId: it.variant_id, qty: it.quantity, type: 'cancelamento', unitCost: it.unit_cost,
          refType: 'venda', refId: id, notes: `Cancelamento da venda #${id}`, userId: user.id });
      }
      db.prepare("UPDATE installments SET status = 'cancelada' WHERE sale_id = ?").run(id);
      for (const p of sale.payments) {
        if (p.method === 'vale' && p.voucher_id) {
          db.prepare('UPDATE vouchers SET balance = balance + ? WHERE id = ?').run(p.amount, p.voucher_id);
        }
      }
      // Dinheiro de venda de caixa anterior: registra estorno no caixa atual
      const current = openSession(db);
      const cash = r2(sale.payments.filter((p) => p.method === 'dinheiro').reduce((a, p) => a + p.amount, 0));
      if (cash > 0 && current && current.id !== sale.cash_session_id) {
        db.prepare("INSERT INTO cash_movements (session_id, type, amount, description, reference_type, reference_id, user_id) VALUES (?, 'estorno', ?, ?, 'venda', ?, ?)")
          .run(current.id, cash, `Estorno venda #${id}`, id, user.id);
      }
      db.prepare("UPDATE sales SET status = 'cancelada', cancel_reason = ?, canceled_at = datetime('now','localtime'), canceled_by = ? WHERE id = ?")
        .run(reason, user.id, id);
      return true;
    });
    return tx();
  },

  // ---------- Trocas e devoluções ----------
  'returns.create': (data, ctx) => {
    const user = requireUser(ctx);
    const db = dbm.get();
    const tx = db.transaction(() => {
      const sale = saleDetail(db, data.saleId);
      if (sale.status !== 'concluida') fail('Venda cancelada não aceita devolução.');
      const lines = (data.items || []).filter((i) => Number(i.quantity) > 0);
      if (!lines.length) fail('Selecione os itens devolvidos.');
      const method = data.refund_method;
      if (!['vale', 'dinheiro', 'estorno', 'abater_crediario'].includes(method)) fail('Forma de reembolso inválida.');
      const session = openSession(db);
      if (method === 'dinheiro' && !session) fail('Abra o caixa para devolver em dinheiro.');

      let total = 0;
      const resolved = lines.map((l) => {
        const it = sale.items.find((x) => x.id === l.sale_item_id);
        if (!it) fail('Item não pertence a esta venda.');
        const qty = Math.trunc(Number(l.quantity));
        if (qty > it.quantity - it.returned_qty) fail(`Quantidade maior que a disponível para devolução: ${it.description}`);
        const unit = r2(it.total / it.quantity);
        total += unit * qty;
        return { it, qty, unit, back: l.back_to_stock !== false };
      });
      total = r2(total);

      const returnId = db.prepare(`INSERT INTO returns (sale_id, customer_id, type, total, refund_method, reason, user_id, cash_session_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(sale.id, sale.customer_id, data.type === 'troca' ? 'troca' : 'devolucao', total, method, data.reason || null, user.id,
          method === 'dinheiro' ? session.id : (session ? session.id : null)).lastInsertRowid;

      for (const r of resolved) {
        db.prepare('INSERT INTO return_items (return_id, sale_item_id, variant_id, quantity, unit_price, back_to_stock) VALUES (?, ?, ?, ?, ?, ?)')
          .run(returnId, r.it.id, r.it.variant_id, r.qty, r.unit, r.back ? 1 : 0);
        db.prepare('UPDATE sale_items SET returned_qty = returned_qty + ? WHERE id = ?').run(r.qty, r.it.id);
        if (r.back) {
          moveStock(db, { variantId: r.it.variant_id, qty: r.qty, type: 'devolucao', unitCost: r.it.unit_cost,
            refType: 'devolucao', refId: returnId, notes: `${data.type === 'troca' ? 'Troca' : 'Devolução'} da venda #${sale.id}`, userId: user.id });
        }
      }

      let voucherAmount = 0;
      if (method === 'vale') voucherAmount = total;
      if (method === 'abater_crediario') {
        let remaining = total;
        const open = db.prepare("SELECT * FROM installments WHERE sale_id = ? AND status = 'aberta' ORDER BY number DESC").all(sale.id);
        for (const ins of open) {
          if (remaining <= 0) break;
          const due = r2(ins.amount - ins.paid_amount);
          const cut = Math.min(due, remaining);
          const newAmount = r2(ins.amount - cut);
          remaining = r2(remaining - cut);
          const status = newAmount <= ins.paid_amount + 0.001 ? (ins.paid_amount > 0 ? 'paga' : 'cancelada') : 'aberta';
          db.prepare('UPDATE installments SET amount = ?, status = ? WHERE id = ?').run(newAmount, status, ins.id);
        }
        voucherAmount = r2(remaining); // o que sobrar vira vale
      }
      let voucher = null;
      if (voucherAmount > 0) {
        const code = genVoucherCode(db);
        const vid = db.prepare('INSERT INTO vouchers (code, customer_id, amount, balance, return_id) VALUES (?, ?, ?, ?, ?)')
          .run(code, sale.customer_id, voucherAmount, voucherAmount, returnId).lastInsertRowid;
        db.prepare('UPDATE returns SET voucher_id = ? WHERE id = ?').run(vid, returnId);
        voucher = { code, amount: voucherAmount };
      }
      return { returnId, total, voucher };
    });
    return tx();
  },

  'returns.list': ({ from, to } = {}, ctx) => {
    requireUser(ctx);
    const where = [];
    const params = {};
    if (from) { where.push('date(r.created_at) >= @from'); params.from = from; }
    if (to) { where.push('date(r.created_at) <= @to'); params.to = to; }
    return dbm.get().prepare(`SELECT r.*, c.name AS customer_name, u.name AS user_name, vo.code AS voucher_code, vo.balance AS voucher_balance,
      (SELECT GROUP_CONCAT(si.description || ' x' || ri.quantity, ', ') FROM return_items ri JOIN sale_items si ON si.id = ri.sale_item_id WHERE ri.return_id = r.id) AS items_desc
      FROM returns r LEFT JOIN customers c ON c.id = r.customer_id LEFT JOIN users u ON u.id = r.user_id LEFT JOIN vouchers vo ON vo.id = r.voucher_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY r.id DESC LIMIT 500`).all(params);
  },

  'vouchers.list': (_, ctx) => {
    requireUser(ctx);
    return dbm.get().prepare(`SELECT vo.*, c.name AS customer_name FROM vouchers vo LEFT JOIN customers c ON c.id = vo.customer_id
      ORDER BY (vo.balance > 0) DESC, vo.id DESC LIMIT 500`).all();
  },
};
