const dbm = require('../db');
const { fail, r2, requireUser, requireAdmin, localDate, generateBarcode, getSettingNum } = require('./util');

const VARIANT_SELECT = `
  SELECT v.*, p.name AS product_name, p.brand, p.model, p.category, p.supplier_id,
         COALESCE(v.sale_price, p.sale_price) AS price,
         COALESCE(v.cost_price, p.cost_price) AS cost,
         COALESCE(v.min_stock, p.min_stock) AS min_qty
  FROM product_variants v JOIN products p ON p.id = v.product_id`;

function variantLabel(v) {
  return [v.product_name, v.color, v.size].filter(Boolean).join(' ');
}

// Movimenta o estoque e registra histórico. Quantidade positiva = entrada, negativa = saída.
function moveStock(db, { variantId, qty, type, unitCost = null, refType = null, refId = null, notes = null, userId = null }) {
  const v = db.prepare('SELECT id, stock FROM product_variants WHERE id = ?').get(variantId);
  if (!v) fail('Variação de produto não encontrada.');
  const balance = v.stock + qty;
  db.prepare('UPDATE product_variants SET stock = ? WHERE id = ?').run(balance, variantId);
  db.prepare(`INSERT INTO stock_movements (variant_id, type, quantity, balance_after, unit_cost, reference_type, reference_id, notes, user_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(variantId, type, qty, balance, unitCost, refType, refId, notes, userId);
  return balance;
}

function activePromotions(db) {
  const today = localDate();
  return db.prepare(`SELECT * FROM promotions WHERE active = 1
    AND (start_date IS NULL OR start_date = '' OR start_date <= ?)
    AND (end_date IS NULL OR end_date = '' OR end_date >= ?)`).all(today, today);
}

// Retorna o melhor preço promocional aplicável à variação
function applyPromotion(v, promos) {
  let best = null;
  for (const p of promos) {
    const val = String(p.scope_value || '').toLowerCase();
    const match =
      p.scope === 'all' ||
      (p.scope === 'category' && String(v.category || '').toLowerCase() === val) ||
      (p.scope === 'brand' && String(v.brand || '').toLowerCase() === val) ||
      (p.scope === 'product' && String(v.product_id) === String(p.scope_value));
    if (!match) continue;
    const price = p.discount_type === 'percent' ? r2(v.price * (1 - p.value / 100)) : r2(Math.max(0, v.price - p.value));
    if (!best || price < best.price) best = { price, promotion_id: p.id, promotion_name: p.name };
  }
  return best;
}

function withPromo(db, variants) {
  const promos = activePromotions(db);
  return variants.map((v) => {
    const promo = promos.length ? applyPromotion(v, promos) : null;
    return { ...v, label: variantLabel(v), promo_price: promo ? promo.price : null, promotion_id: promo?.promotion_id ?? null, promotion_name: promo?.promotion_name ?? null };
  });
}

module.exports = {
  moveStock,
  variantLabel,
  VARIANT_SELECT,
  withPromo,

  'products.list': ({ search = '', category = '', brand = '', filter = '', showInactive = false } = {}, ctx) => {
    requireUser(ctx);
    const db = dbm.get();
    const where = [];
    const params = {};
    if (!showInactive) where.push('p.active = 1');
    if (search) {
      where.push(`(p.name LIKE @s OR p.brand LIKE @s OR p.model LIKE @s OR p.category LIKE @s
        OR EXISTS (SELECT 1 FROM product_variants x WHERE x.product_id = p.id AND x.barcode = @code))`);
      params.s = `%${search}%`;
      params.code = search;
    }
    if (category) { where.push('p.category = @category'); params.category = category; }
    if (brand) { where.push('p.brand = @brand'); params.brand = brand; }
    const rows = db.prepare(`
      SELECT p.*, s.name AS supplier_name,
        (SELECT COALESCE(SUM(stock),0) FROM product_variants WHERE product_id = p.id AND active = 1) AS total_stock,
        (SELECT COUNT(*) FROM product_variants WHERE product_id = p.id AND active = 1) AS variant_count,
        (SELECT COUNT(*) FROM product_variants v WHERE v.product_id = p.id AND v.active = 1 AND v.stock <= COALESCE(v.min_stock, p.min_stock)) AS low_count,
        (SELECT MAX(sa.created_at) FROM sale_items si JOIN sales sa ON sa.id = si.sale_id WHERE si.product_id = p.id AND sa.status = 'concluida') AS last_sale
      FROM products p LEFT JOIN suppliers s ON s.id = p.supplier_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY p.name`).all(params);
    if (filter === 'low') return rows.filter((r) => r.low_count > 0);
    if (filter === 'zero') return rows.filter((r) => r.total_stock <= 0);
    return rows;
  },

  'products.get': ({ id }, ctx) => {
    requireUser(ctx);
    const db = dbm.get();
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    if (!product) fail('Produto não encontrado.');
    product.variants = withPromo(db, db.prepare(`${VARIANT_SELECT} WHERE v.product_id = ? ORDER BY v.color, v.id`).all(id));
    return product;
  },

  'products.options': (_, ctx) => {
    requireUser(ctx);
    const db = dbm.get();
    const distinct = (sql) => db.prepare(sql).all().map((r) => r.v).filter(Boolean);
    return {
      categories: distinct("SELECT DISTINCT category v FROM products WHERE category <> '' ORDER BY category"),
      brands: distinct("SELECT DISTINCT brand v FROM products WHERE brand <> '' ORDER BY brand"),
      colors: distinct("SELECT DISTINCT color v FROM product_variants WHERE color <> '' ORDER BY color"),
      sizes: distinct("SELECT DISTINCT size v FROM product_variants WHERE size <> '' ORDER BY size"),
    };
  },

  'products.save': (data, ctx) => {
    const user = requireAdmin(ctx);
    const db = dbm.get();
    if (!data.name || !data.name.trim()) fail('Informe o nome do produto.');
    if (!(Number(data.sale_price) > 0)) fail('Informe o preço de venda.');
    if (!data.variants || !data.variants.length) fail('Cadastre pelo menos uma variação (cor/tamanho).');
    const tx = db.transaction(() => {
      const fields = [data.name.trim(), data.brand || null, data.model || null, data.category || null, data.supplier_id || null,
        r2(data.cost_price), r2(data.sale_price), Number(data.min_stock) || 0, data.notes || null, data.active === false ? 0 : 1];
      let productId = data.id;
      if (productId) {
        db.prepare(`UPDATE products SET name=?, brand=?, model=?, category=?, supplier_id=?, cost_price=?, sale_price=?, min_stock=?, notes=?, active=? WHERE id=?`)
          .run(...fields, productId);
      } else {
        productId = db.prepare(`INSERT INTO products (name, brand, model, category, supplier_id, cost_price, sale_price, min_stock, notes, active)
          VALUES (?,?,?,?,?,?,?,?,?,?)`).run(...fields).lastInsertRowid;
      }
      const seen = new Set();
      for (const v of data.variants) {
        const key = `${(v.color || '').toLowerCase()}|${(v.size || '').toLowerCase()}`;
        if (seen.has(key) && v.active !== false) fail(`Variação repetida: ${v.color || ''} ${v.size || ''}`);
        seen.add(key);
        let barcode = (v.barcode || '').trim() || null;
        if (barcode) {
          const dup = db.prepare('SELECT id FROM product_variants WHERE barcode = ? AND id <> ?').get(barcode, v.id || 0);
          if (dup) fail(`O código de barras ${barcode} já está em uso por outro produto.`);
        } else {
          barcode = generateBarcode();
        }
        const vf = [v.color || null, v.size || null, barcode,
          v.min_stock === '' || v.min_stock == null ? null : Number(v.min_stock),
          v.cost_price === '' || v.cost_price == null ? null : r2(v.cost_price),
          v.sale_price === '' || v.sale_price == null ? null : r2(v.sale_price),
          v.active === false ? 0 : 1];
        if (v.id) {
          db.prepare('UPDATE product_variants SET color=?, size=?, barcode=?, min_stock=?, cost_price=?, sale_price=?, active=? WHERE id=? AND product_id=?')
            .run(...vf, v.id, productId);
        } else {
          const vid = db.prepare('INSERT INTO product_variants (product_id, color, size, barcode, min_stock, cost_price, sale_price, active) VALUES (?,?,?,?,?,?,?,?)')
            .run(productId, ...vf).lastInsertRowid;
          const initial = Number(v.stock) || 0;
          if (initial) {
            moveStock(db, { variantId: vid, qty: initial, type: 'entrada', unitCost: v.cost_price || data.cost_price,
              notes: 'Estoque inicial (cadastro)', userId: user.id });
          }
        }
      }
      return productId;
    });
    return tx();
  },

  'products.delete': ({ id }, ctx) => {
    requireAdmin(ctx);
    const db = dbm.get();
    const used = db.prepare(`SELECT
      (SELECT COUNT(*) FROM sale_items WHERE product_id = @id) +
      (SELECT COUNT(*) FROM purchase_items WHERE product_id = @id) AS c`).get({ id }).c;
    const tx = db.transaction(() => {
      if (used) {
        db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(id);
        return 'inativado';
      }
      const vids = db.prepare('SELECT id FROM product_variants WHERE product_id = ?').all(id).map((r) => r.id);
      for (const vid of vids) {
        db.prepare('DELETE FROM stock_movements WHERE variant_id = ?').run(vid);
        db.prepare('DELETE FROM inventory_items WHERE variant_id = ?').run(vid);
      }
      db.prepare('DELETE FROM product_variants WHERE product_id = ?').run(id);
      db.prepare('DELETE FROM products WHERE id = ?').run(id);
      return 'excluido';
    });
    return tx();
  },

  // Busca por código de barras (leitor) — usado no PDV, inventário e compras
  'products.findBarcode': ({ code }, ctx) => {
    requireUser(ctx);
    const db = dbm.get();
    const v = db.prepare(`${VARIANT_SELECT} WHERE v.barcode = ? AND v.active = 1`).get(String(code || '').trim());
    if (!v) return null;
    return withPromo(db, [v])[0];
  },

  'products.searchVariants': ({ q = '', limit = 40 }, ctx) => {
    requireUser(ctx);
    const db = dbm.get();
    const terms = String(q).trim().split(/\s+/).filter(Boolean);
    const where = ['v.active = 1', 'p.active = 1'];
    const params = [];
    for (const t of terms) {
      where.push(`(p.name LIKE ? OR p.brand LIKE ? OR p.model LIKE ? OR p.category LIKE ? OR v.color LIKE ? OR v.size = ? OR v.barcode = ?)`);
      const like = `%${t}%`;
      params.push(like, like, like, like, like, t, t);
    }
    const rows = db.prepare(`${VARIANT_SELECT} WHERE ${where.join(' AND ')} ORDER BY p.name, v.color, v.id LIMIT ${Number(limit) || 40}`).all(...params);
    return withPromo(db, rows);
  },

  // ---------- Estoque ----------
  'stock.movements': ({ variantId, productId, type, from, to, limit = 300 } = {}, ctx) => {
    requireUser(ctx);
    const where = [];
    const params = {};
    if (variantId) { where.push('m.variant_id = @variantId'); params.variantId = variantId; }
    if (productId) { where.push('v.product_id = @productId'); params.productId = productId; }
    if (type) { where.push('m.type = @type'); params.type = type; }
    if (from) { where.push('date(m.created_at) >= @from'); params.from = from; }
    if (to) { where.push('date(m.created_at) <= @to'); params.to = to; }
    return dbm.get().prepare(`
      SELECT m.*, p.name AS product_name, v.color, v.size, v.barcode, u.name AS user_name
      FROM stock_movements m
      JOIN product_variants v ON v.id = m.variant_id
      JOIN products p ON p.id = v.product_id
      LEFT JOIN users u ON u.id = m.user_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY m.id DESC LIMIT ${Number(limit) || 300}`).all(params);
  },

  // Resumo por variação: confere se o saldo atual bate com a soma das movimentações
  'stock.audit': ({ productId } = {}, ctx) => {
    requireUser(ctx);
    const db = dbm.get();
    const rows = db.prepare(`
      SELECT v.id, p.name AS product_name, v.color, v.size, v.barcode, v.stock,
        COALESCE(v.cost_price, p.cost_price) AS cost,
        COALESCE(SUM(m.quantity), 0) AS movements_sum,
        COALESCE(SUM(CASE WHEN m.quantity > 0 AND m.type IN ('entrada','compra') THEN m.quantity END), 0) AS entradas,
        COALESCE(SUM(CASE WHEN m.type = 'venda' THEN -m.quantity END), 0) AS vendas,
        COALESCE(SUM(CASE WHEN m.type IN ('devolucao','cancelamento') THEN m.quantity END), 0) AS devolucoes,
        COALESCE(SUM(CASE WHEN m.type = 'saida' THEN -m.quantity END), 0) AS saidas,
        COALESCE(SUM(CASE WHEN m.type IN ('ajuste','inventario') THEN m.quantity END), 0) AS ajustes
      FROM product_variants v JOIN products p ON p.id = v.product_id
      LEFT JOIN stock_movements m ON m.variant_id = v.id
      WHERE v.active = 1 ${productId ? 'AND p.id = @productId' : ''}
      GROUP BY v.id ORDER BY ABS(ajustes) DESC, p.name`).all(productId ? { productId } : {});
    return rows.map((r) => ({ ...r, divergence: r.stock - r.movements_sum, adjust_value: r2(r.ajustes * r.cost) }));
  },

  'stock.adjust': ({ variantId, mode, quantity, reason }, ctx) => {
    const user = requireAdmin(ctx);
    const db = dbm.get();
    const qty = Math.trunc(Number(quantity));
    if (!Number.isFinite(qty)) fail('Quantidade inválida.');
    if (!reason) fail('Informe o motivo da movimentação.');
    const tx = db.transaction(() => {
      const v = db.prepare(`${VARIANT_SELECT} WHERE v.id = ?`).get(variantId);
      if (!v) fail('Variação não encontrada.');
      if (mode === 'entrada') {
        if (qty <= 0) fail('Quantidade deve ser maior que zero.');
        return moveStock(db, { variantId, qty, type: 'entrada', unitCost: v.cost, notes: reason, userId: user.id });
      }
      if (mode === 'saida') {
        if (qty <= 0) fail('Quantidade deve ser maior que zero.');
        return moveStock(db, { variantId, qty: -qty, type: 'saida', unitCost: v.cost, notes: reason, userId: user.id });
      }
      // ajuste: define o saldo exato
      if (qty < 0) fail('O saldo não pode ser negativo.');
      const diff = qty - v.stock;
      if (diff === 0) return v.stock;
      return moveStock(db, { variantId, qty: diff, type: 'ajuste', unitCost: v.cost, notes: reason, userId: user.id });
    });
    return tx();
  },

  'stock.low': (_, ctx) => {
    requireUser(ctx);
    return dbm.get().prepare(`${VARIANT_SELECT}
      WHERE v.active = 1 AND p.active = 1 AND v.stock <= COALESCE(v.min_stock, p.min_stock)
      ORDER BY v.stock, p.name`).all().map((v) => ({ ...v, label: variantLabel(v) }));
  },

  // ---------- Inventário ----------
  'inventory.list': (_, ctx) => {
    requireUser(ctx);
    return dbm.get().prepare(`
      SELECT i.*, u.name AS user_name,
        (SELECT COUNT(*) FROM inventory_items WHERE inventory_id = i.id) AS total_items,
        (SELECT COUNT(*) FROM inventory_items WHERE inventory_id = i.id AND counted_qty IS NOT NULL) AS counted_items
      FROM inventories i LEFT JOIN users u ON u.id = i.user_id ORDER BY i.id DESC`).all();
  },

  'inventory.create': ({ description, category }, ctx) => {
    const user = requireAdmin(ctx);
    const db = dbm.get();
    if (db.prepare("SELECT 1 FROM inventories WHERE status = 'aberto'").get()) fail('Já existe um inventário em aberto. Finalize-o antes de iniciar outro.');
    const tx = db.transaction(() => {
      const id = db.prepare('INSERT INTO inventories (description, filter_category, user_id) VALUES (?, ?, ?)')
        .run(description || `Inventário ${localDate()}`, category || null, user.id).lastInsertRowid;
      db.prepare(`INSERT INTO inventory_items (inventory_id, variant_id, system_qty)
        SELECT ?, v.id, v.stock FROM product_variants v JOIN products p ON p.id = v.product_id
        WHERE v.active = 1 AND p.active = 1 ${category ? 'AND p.category = ?' : ''}`)
        .run(...(category ? [id, category] : [id]));
      return id;
    });
    return tx();
  },

  'inventory.get': ({ id }, ctx) => {
    requireUser(ctx);
    const db = dbm.get();
    const inv = db.prepare('SELECT * FROM inventories WHERE id = ?').get(id);
    if (!inv) fail('Inventário não encontrado.');
    inv.items = db.prepare(`
      SELECT it.*, v.stock AS current_qty, v.barcode, v.color, v.size, p.name AS product_name, p.category,
        COALESCE(v.cost_price, p.cost_price) AS cost
      FROM inventory_items it JOIN product_variants v ON v.id = it.variant_id JOIN products p ON p.id = v.product_id
      WHERE it.inventory_id = ? ORDER BY p.name, v.color, v.size`).all(id);
    return inv;
  },

  'inventory.count': ({ inventoryId, barcode, variantId, quantity = 1, mode = 'add' }, ctx) => {
    requireUser(ctx);
    const db = dbm.get();
    const inv = db.prepare('SELECT * FROM inventories WHERE id = ?').get(inventoryId);
    if (!inv || inv.status !== 'aberto') fail('Inventário não está aberto.');
    let vid = variantId;
    if (!vid && barcode) {
      const v = db.prepare('SELECT id FROM product_variants WHERE barcode = ?').get(String(barcode).trim());
      if (!v) fail(`Código ${barcode} não encontrado.`);
      vid = v.id;
    }
    let item = db.prepare('SELECT * FROM inventory_items WHERE inventory_id = ? AND variant_id = ?').get(inventoryId, vid);
    if (!item) {
      const v = db.prepare('SELECT stock FROM product_variants WHERE id = ?').get(vid);
      db.prepare('INSERT INTO inventory_items (inventory_id, variant_id, system_qty) VALUES (?, ?, ?)').run(inventoryId, vid, v.stock);
      item = db.prepare('SELECT * FROM inventory_items WHERE inventory_id = ? AND variant_id = ?').get(inventoryId, vid);
    }
    const q = Math.trunc(Number(quantity));
    const counted = mode === 'set' ? (quantity === '' || quantity == null ? null : Math.max(0, q)) : Math.max(0, (item.counted_qty || 0) + q);
    db.prepare('UPDATE inventory_items SET counted_qty = ? WHERE id = ?').run(counted, item.id);
    return { variant_id: vid, counted_qty: counted };
  },

  'inventory.finish': ({ id, zeroUncounted = false }, ctx) => {
    const user = requireAdmin(ctx);
    const db = dbm.get();
    const tx = db.transaction(() => {
      const inv = db.prepare('SELECT * FROM inventories WHERE id = ?').get(id);
      if (!inv || inv.status !== 'aberto') fail('Inventário não está aberto.');
      const items = db.prepare(`SELECT it.*, v.stock, COALESCE(v.cost_price, p.cost_price) AS cost
        FROM inventory_items it JOIN product_variants v ON v.id = it.variant_id JOIN products p ON p.id = v.product_id
        WHERE it.inventory_id = ?`).all(id);
      let adjusted = 0;
      for (const it of items) {
        let counted = it.counted_qty;
        if (counted == null) {
          if (!zeroUncounted) continue;
          counted = 0;
          db.prepare('UPDATE inventory_items SET counted_qty = 0 WHERE id = ?').run(it.id);
        }
        const diff = counted - it.stock;
        if (diff !== 0) {
          moveStock(db, { variantId: it.variant_id, qty: diff, type: 'inventario', unitCost: it.cost,
            refType: 'inventario', refId: id, notes: `${inv.description} (sistema ${it.stock}, contado ${counted})`, userId: user.id });
          adjusted++;
        }
      }
      db.prepare("UPDATE inventories SET status = 'finalizado', finished_at = datetime('now','localtime') WHERE id = ?").run(id);
      return { adjusted };
    });
    return tx();
  },

  'inventory.cancel': ({ id }, ctx) => {
    requireAdmin(ctx);
    dbm.get().prepare("UPDATE inventories SET status = 'cancelado', finished_at = datetime('now','localtime') WHERE id = ? AND status = 'aberto'").run(id);
    return true;
  },

  // ---------- Promoções ----------
  'promotions.list': (_, ctx) => {
    requireUser(ctx);
    return dbm.get().prepare(`SELECT pr.*, p.name AS product_name FROM promotions pr
      LEFT JOIN products p ON pr.scope = 'product' AND p.id = CAST(pr.scope_value AS INTEGER) ORDER BY pr.active DESC, pr.id DESC`).all();
  },

  'promotions.save': (p, ctx) => {
    requireAdmin(ctx);
    if (!p.name) fail('Informe o nome da promoção.');
    const value = Number(p.value);
    if (!(value > 0)) fail('Informe o valor do desconto.');
    if (p.discount_type === 'percent' && value >= 100) fail('Percentual deve ser menor que 100%.');
    if (p.scope !== 'all' && !p.scope_value) fail('Selecione onde a promoção se aplica.');
    const fields = [p.name, p.discount_type === 'fixed' ? 'fixed' : 'percent', value, p.scope || 'all', p.scope === 'all' ? null : String(p.scope_value),
      p.start_date || null, p.end_date || null, p.active === false ? 0 : 1];
    const db = dbm.get();
    if (p.id) {
      db.prepare('UPDATE promotions SET name=?, discount_type=?, value=?, scope=?, scope_value=?, start_date=?, end_date=?, active=? WHERE id=?').run(...fields, p.id);
      return p.id;
    }
    return db.prepare('INSERT INTO promotions (name, discount_type, value, scope, scope_value, start_date, end_date, active) VALUES (?,?,?,?,?,?,?,?)').run(...fields).lastInsertRowid;
  },

  'promotions.delete': ({ id }, ctx) => {
    requireAdmin(ctx);
    dbm.get().prepare('DELETE FROM promotions WHERE id = ?').run(id);
    return true;
  },

  'stock.defaultMin': () => getSettingNum('default_min_stock'),
};
