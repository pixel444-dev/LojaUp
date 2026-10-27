const dbm = require('../db');
const { fail, r2, requireUser, requireAdmin, localDate, addDays, addMonths } = require('./util');
const { moveStock } = require('./products');

module.exports = {
  // ---------- Fornecedores ----------
  'suppliers.list': ({ search = '' } = {}, ctx) => {
    requireUser(ctx);
    return dbm.get().prepare(`SELECT s.*,
      (SELECT COUNT(*) FROM purchases WHERE supplier_id = s.id AND status = 'recebida') AS purchase_count,
      (SELECT COALESCE(SUM(total),0) FROM purchases WHERE supplier_id = s.id AND status = 'recebida') AS purchase_total,
      (SELECT MAX(purchase_date) FROM purchases WHERE supplier_id = s.id AND status = 'recebida') AS last_purchase,
      (SELECT COALESCE(SUM(amount),0) FROM payables WHERE supplier_id = s.id AND status = 'aberta') AS open_payables
      FROM suppliers s WHERE s.active = 1 ${search ? 'AND (s.name LIKE @s OR s.document LIKE @s OR s.contact LIKE @s)' : ''}
      ORDER BY s.name`).all(search ? { s: `%${search}%` } : {});
  },

  'suppliers.get': ({ id }, ctx) => {
    requireUser(ctx);
    const db = dbm.get();
    const s = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
    if (!s) fail('Fornecedor não encontrado.');
    s.purchases = db.prepare("SELECT * FROM purchases WHERE supplier_id = ? ORDER BY purchase_date DESC, id DESC LIMIT 100").all(id);
    s.payables = db.prepare("SELECT * FROM payables WHERE supplier_id = ? AND status = 'aberta' ORDER BY due_date").all(id);
    s.products = db.prepare(`SELECT p.id, p.name, p.brand, p.model, COUNT(DISTINCT pu.id) times, SUM(pi.quantity) qty,
      ROUND(SUM(pi.landed_unit_cost * pi.quantity) / SUM(pi.quantity), 2) avg_cost, MAX(pu.purchase_date) last_date
      FROM purchase_items pi JOIN purchases pu ON pu.id = pi.purchase_id JOIN products p ON p.id = pi.product_id
      WHERE pu.supplier_id = ? AND pu.status = 'recebida' GROUP BY p.id ORDER BY last_date DESC`).all(id);
    return s;
  },

  'suppliers.save': (s, ctx) => {
    requireAdmin(ctx);
    if (!s.name || !s.name.trim()) fail('Informe o nome do fornecedor.');
    const db = dbm.get();
    const fields = [s.name.trim(), s.document || null, s.phone || null, s.email || null, s.contact || null, s.address || null, s.notes || null];
    if (s.id) {
      db.prepare('UPDATE suppliers SET name=?, document=?, phone=?, email=?, contact=?, address=?, notes=? WHERE id=?').run(...fields, s.id);
      return s.id;
    }
    return db.prepare('INSERT INTO suppliers (name, document, phone, email, contact, address, notes) VALUES (?,?,?,?,?,?,?)').run(...fields).lastInsertRowid;
  },

  'suppliers.delete': ({ id }, ctx) => {
    requireAdmin(ctx);
    dbm.get().prepare('UPDATE suppliers SET active = 0 WHERE id = ?').run(id);
    return true;
  },

  // Comparação de custo por produto entre fornecedores (com base no histórico de compras)
  'suppliers.priceComparison': ({ search = '' } = {}, ctx) => {
    requireUser(ctx);
    const db = dbm.get();
    const rows = db.prepare(`SELECT p.id product_id, p.name product_name, p.brand, p.model, p.sale_price,
        s.id supplier_id, s.name supplier_name,
        COUNT(DISTINCT pu.id) times, SUM(pi.quantity) qty,
        MIN(pi.landed_unit_cost) min_cost, MAX(pi.landed_unit_cost) max_cost,
        ROUND(SUM(pi.landed_unit_cost * pi.quantity) / SUM(pi.quantity), 2) avg_cost,
        MAX(pu.purchase_date) last_date
      FROM purchase_items pi JOIN purchases pu ON pu.id = pi.purchase_id JOIN products p ON p.id = pi.product_id
      JOIN suppliers s ON s.id = pu.supplier_id
      WHERE pu.status = 'recebida' ${search ? 'AND (p.name LIKE @s OR p.brand LIKE @s OR p.model LIKE @s OR p.category LIKE @s)' : ''}
      GROUP BY p.id, s.id ORDER BY p.name, avg_cost`).all(search ? { s: `%${search}%` } : {});
    const lastCost = db.prepare(`SELECT pi.landed_unit_cost FROM purchase_items pi JOIN purchases pu ON pu.id = pi.purchase_id
      WHERE pi.product_id = ? AND pu.supplier_id = ? AND pu.status = 'recebida' ORDER BY pu.purchase_date DESC, pu.id DESC LIMIT 1`);
    const map = new Map();
    for (const r of rows) {
      r.last_cost = lastCost.get(r.product_id, r.supplier_id)?.landed_unit_cost ?? r.avg_cost;
      if (!map.has(r.product_id)) map.set(r.product_id, { product_id: r.product_id, product_name: r.product_name, brand: r.brand, model: r.model, sale_price: r.sale_price, suppliers: [] });
      map.get(r.product_id).suppliers.push(r);
    }
    return [...map.values()].map((p) => {
      const best = p.suppliers.reduce((b, s) => (s.last_cost < b.last_cost ? s : b), p.suppliers[0]);
      const worst = p.suppliers.reduce((b, s) => (s.last_cost > b.last_cost ? s : b), p.suppliers[0]);
      return { ...p, best_supplier: best.supplier_name, best_cost: best.last_cost, saving_percent: worst.last_cost ? Math.round((1 - best.last_cost / worst.last_cost) * 100) : 0 };
    });
  },

  // ---------- Compras ----------
  'purchases.list': ({ from, to, supplierId } = {}, ctx) => {
    requireUser(ctx);
    const where = [];
    const params = {};
    if (from) { where.push('pu.purchase_date >= @from'); params.from = from; }
    if (to) { where.push('pu.purchase_date <= @to'); params.to = to; }
    if (supplierId) { where.push('pu.supplier_id = @supplierId'); params.supplierId = supplierId; }
    return dbm.get().prepare(`SELECT pu.*, s.name AS supplier_name,
      (SELECT COALESCE(SUM(quantity),0) FROM purchase_items WHERE purchase_id = pu.id) AS pieces,
      (SELECT COUNT(*) FROM payables WHERE purchase_id = pu.id AND status = 'aberta') AS open_payables
      FROM purchases pu LEFT JOIN suppliers s ON s.id = pu.supplier_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY pu.purchase_date DESC, pu.id DESC LIMIT 500`).all(params);
  },

  'purchases.get': ({ id }, ctx) => {
    requireUser(ctx);
    const db = dbm.get();
    const p = db.prepare('SELECT pu.*, s.name AS supplier_name FROM purchases pu LEFT JOIN suppliers s ON s.id = pu.supplier_id WHERE pu.id = ?').get(id);
    if (!p) fail('Compra não encontrada.');
    p.items = db.prepare(`SELECT pi.*, pr.name AS product_name, v.color, v.size, v.barcode FROM purchase_items pi
      JOIN product_variants v ON v.id = pi.variant_id JOIN products pr ON pr.id = pi.product_id WHERE pi.purchase_id = ?`).all(id);
    p.payables = db.prepare('SELECT * FROM payables WHERE purchase_id = ? ORDER BY due_date').all(id);
    return p;
  },

  'purchases.create': (data, ctx) => {
    const user = requireAdmin(ctx);
    const db = dbm.get();
    const tx = db.transaction(() => {
      const items = (data.items || []).filter((i) => Number(i.quantity) > 0);
      if (!items.length) fail('Adicione os produtos da compra.');
      const freight = r2(data.freight);
      const other = r2(data.other_costs);
      const discount = r2(data.discount);
      const productsTotal = r2(items.reduce((a, i) => a + r2(i.unit_cost) * Math.trunc(i.quantity), 0));
      const total = r2(productsTotal + freight + other - discount);
      if (total < 0) fail('Total da compra inválido.');
      const extra = r2(freight + other - discount);
      const date = data.purchase_date || localDate();

      const purchaseId = db.prepare(`INSERT INTO purchases (supplier_id, invoice_number, purchase_date, products_total, freight, other_costs, discount, total, notes, user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(data.supplier_id || null, data.invoice_number || null, date, productsTotal, freight, other, discount, total, data.notes || null, user.id).lastInsertRowid;

      const touchedProducts = new Set();
      for (const it of items) {
        const qty = Math.trunc(Number(it.quantity));
        const unit = r2(it.unit_cost);
        const v = db.prepare('SELECT v.*, p.cost_price AS product_cost, p.name AS product_name FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = ?').get(it.variant_id);
        if (!v) fail('Produto da compra não encontrado.');
        // Rateio de frete/despesas proporcional ao valor de cada item
        const share = productsTotal > 0 ? (unit * qty / productsTotal) * extra : extra / items.length;
        const landed = r2(unit + share / qty);
        db.prepare('INSERT INTO purchase_items (purchase_id, variant_id, product_id, quantity, unit_cost, landed_unit_cost, total) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(purchaseId, v.id, v.product_id, qty, unit, landed, r2(unit * qty));

        // Custo médio ponderado
        if (v.cost_price != null) {
          const prev = Math.max(0, v.stock);
          const newCost = r2((prev * v.cost_price + qty * landed) / (prev + qty));
          db.prepare('UPDATE product_variants SET cost_price = ? WHERE id = ?').run(newCost, v.id);
        } else {
          const prev = Math.max(0, db.prepare('SELECT COALESCE(SUM(stock),0) s FROM product_variants WHERE product_id = ? AND cost_price IS NULL').get(v.product_id).s);
          const newCost = r2((prev * v.product_cost + qty * landed) / (prev + qty));
          db.prepare('UPDATE products SET cost_price = ? WHERE id = ?').run(newCost, v.product_id);
        }
        if (data.supplier_id) db.prepare('UPDATE products SET supplier_id = COALESCE(supplier_id, ?) WHERE id = ?').run(data.supplier_id, v.product_id);
        moveStock(db, { variantId: v.id, qty, type: 'compra', unitCost: landed, refType: 'compra', refId: purchaseId,
          notes: `Compra #${purchaseId}${data.invoice_number ? ' NF ' + data.invoice_number : ''}`, userId: user.id });
        touchedProducts.add(v.product_id);
      }

      // Contas a pagar
      const pay = data.payment || {};
      const supplierName = data.supplier_id ? db.prepare('SELECT name FROM suppliers WHERE id = ?').get(data.supplier_id)?.name : null;
      const desc = `Compra #${purchaseId}${supplierName ? ' — ' + supplierName : ''}${data.invoice_number ? ' NF ' + data.invoice_number : ''}`;
      if (pay.mode === 'avista') {
        db.prepare(`INSERT INTO payables (description, supplier_id, purchase_id, category, expense_type, amount, due_date, paid_at, paid_amount, payment_method, status)
          VALUES (?, ?, ?, 'Mercadorias', 'variavel', ?, ?, ?, ?, ?, 'paga')`)
          .run(desc, data.supplier_id || null, purchaseId, total, date, date + ' 12:00:00', total, pay.method || 'dinheiro');
      } else if (total > 0) {
        const n = Math.max(1, Math.min(Number(pay.installments) || 1, 24));
        const first = pay.first_due || addDays(date, 30);
        const interval = Number(pay.interval_days) || 30;
        const base = Math.floor((total / n) * 100) / 100;
        for (let k = 1; k <= n; k++) {
          const due = interval === 30 ? addMonths(first, k - 1) : addDays(first, interval * (k - 1));
          db.prepare(`INSERT INTO payables (description, supplier_id, purchase_id, category, expense_type, amount, due_date, installment_label)
            VALUES (?, ?, ?, 'Mercadorias', 'variavel', ?, ?, ?)`)
            .run(desc, data.supplier_id || null, purchaseId, k === 1 ? r2(total - base * (n - 1)) : base, due, `${k}/${n}`);
        }
      }

      // Atualiza preço de venda, se informado
      for (const u of data.price_updates || []) {
        if (u.product_id && Number(u.sale_price) > 0) db.prepare('UPDATE products SET sale_price = ? WHERE id = ?').run(r2(u.sale_price), u.product_id);
      }
      return purchaseId;
    });
    return tx();
  },

  'purchases.cancel': ({ id }, ctx) => {
    const user = requireAdmin(ctx);
    const db = dbm.get();
    const tx = db.transaction(() => {
      const p = db.prepare('SELECT * FROM purchases WHERE id = ?').get(id);
      if (!p || p.status !== 'recebida') fail('Compra não encontrada ou já cancelada.');
      const paid = db.prepare("SELECT COUNT(*) c FROM payables WHERE purchase_id = ? AND status = 'paga' AND paid_at IS NOT NULL AND date(paid_at) <> ?").get(id, p.purchase_date).c;
      if (paid) fail('Esta compra tem parcelas já pagas. Estorne os pagamentos antes de cancelar.');
      const items = db.prepare('SELECT * FROM purchase_items WHERE purchase_id = ?').all(id);
      for (const it of items) {
        moveStock(db, { variantId: it.variant_id, qty: -it.quantity, type: 'saida', unitCost: it.landed_unit_cost, refType: 'compra', refId: id,
          notes: `Cancelamento da compra #${id}`, userId: user.id });
      }
      db.prepare('DELETE FROM payables WHERE purchase_id = ?').run(id);
      db.prepare("UPDATE purchases SET status = 'cancelada' WHERE id = ?").run(id);
      return true;
    });
    return tx();
  },

  'purchases.lastCost': ({ variantId }, ctx) => {
    requireUser(ctx);
    const r = dbm.get().prepare(`SELECT pi.unit_cost, pu.purchase_date, s.name supplier_name FROM purchase_items pi
      JOIN purchases pu ON pu.id = pi.purchase_id LEFT JOIN suppliers s ON s.id = pu.supplier_id
      WHERE pi.variant_id = ? AND pu.status = 'recebida' ORDER BY pu.purchase_date DESC, pu.id DESC LIMIT 1`).get(variantId);
    return r || null;
  },

};
