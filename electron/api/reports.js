const dbm = require('../db');
const { r2, requireAdmin, localDate, addDays, daysBetween, getSetting, getSettingNum } = require('./util');
const { dre } = require('./finance');

const brl = (v) => 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

function groupExpr(groupBy, col) {
  if (groupBy === 'month') return `strftime('%Y-%m', ${col})`;
  if (groupBy === 'week') return `date(${col}, '-' || ((strftime('%w', ${col}) + 6) % 7) || ' days')`; // segunda-feira da semana
  return `date(${col})`;
}

function revenueSeries(db, from, to, groupBy = 'day') {
  const g = groupExpr(groupBy, 's.created_at');
  const rows = db.prepare(`SELECT ${g} k, COUNT(*) qty, SUM(total) revenue, SUM(cost_total) cost, SUM(discount) discount
    FROM sales s WHERE s.status = 'concluida' AND date(s.created_at) BETWEEN ? AND ? GROUP BY k ORDER BY k`).all(from, to);
  const pieces = new Map(db.prepare(`SELECT ${g} k, SUM(si.quantity) q FROM sale_items si JOIN sales s ON s.id = si.sale_id
    WHERE s.status = 'concluida' AND date(s.created_at) BETWEEN ? AND ? GROUP BY k`).all(from, to).map((r) => [r.k, r.q]));
  for (const r of rows) r.pieces = pieces.get(r.k) || 0;
  const rg = groupExpr(groupBy, 'r.created_at');
  const rets = db.prepare(`SELECT ${rg} k, SUM(ri.quantity * ri.unit_price) value, SUM(ri.quantity * si.unit_cost) cost
    FROM return_items ri JOIN returns r ON r.id = ri.return_id JOIN sale_items si ON si.id = ri.sale_item_id
    WHERE date(r.created_at) BETWEEN ? AND ? GROUP BY k`).all(from, to);
  const map = new Map(rows.map((r) => [r.k, { ...r, returns: 0, returns_cost: 0 }]));
  for (const r of rets) {
    if (!map.has(r.k)) map.set(r.k, { k: r.k, qty: 0, revenue: 0, cost: 0, discount: 0, pieces: 0, returns: 0, returns_cost: 0 });
    Object.assign(map.get(r.k), { returns: r.value, returns_cost: r.cost });
  }
  // Preenche dias sem venda (apenas agrupamento diário)
  if (groupBy === 'day') {
    for (let d = from; d <= to; d = addDays(d, 1)) {
      if (!map.has(d)) map.set(d, { k: d, qty: 0, revenue: 0, cost: 0, discount: 0, pieces: 0, returns: 0, returns_cost: 0 });
    }
  }
  return [...map.values()].sort((a, b) => a.k.localeCompare(b.k)).map((r) => {
    const net = r2(r.revenue - r.returns);
    const profit = r2(net - (r.cost - r.returns_cost));
    return { period: r.k, sales: r.qty, pieces: r.pieces, gross: r2(r.revenue), discount: r2(r.discount), returns: r2(r.returns), net, cost: r2(r.cost - r.returns_cost), profit, margin: net ? r2((profit / net) * 100) : 0, ticket: r.qty ? r2(r.revenue / r.qty) : 0 };
  });
}

function productPerformance(db, from, to) {
  return db.prepare(`SELECT p.id, p.name, p.brand, p.model, p.category, p.sale_price, p.cost_price,
      COALESCE(SUM(si.quantity - si.returned_qty), 0) qty,
      COALESCE(SUM(si.total * (si.quantity - si.returned_qty) * 1.0 / si.quantity), 0) revenue,
      COALESCE(SUM(si.unit_cost * (si.quantity - si.returned_qty)), 0) cost,
      (SELECT COALESCE(SUM(stock),0) FROM product_variants WHERE product_id = p.id AND active = 1) stock,
      (SELECT MAX(s2.created_at) FROM sale_items x JOIN sales s2 ON s2.id = x.sale_id WHERE x.product_id = p.id AND s2.status='concluida') last_sale
    FROM products p
    JOIN sale_items si ON si.product_id = p.id
    JOIN sales s ON s.id = si.sale_id AND s.status = 'concluida' AND date(s.created_at) BETWEEN ? AND ?
    GROUP BY p.id ORDER BY qty DESC`).all(from, to).map((r) => {
    const revenue = r2(r.revenue);
    const profit = r2(revenue - r.cost);
    return { ...r, revenue, cost: r2(r.cost), profit, margin: revenue ? r2((profit / revenue) * 100) : 0 };
  });
}

function staleProducts(db, days) {
  const cutoff = addDays(localDate(), -days);
  return db.prepare(`SELECT p.id, p.name, p.brand, p.category, p.sale_price, p.created_at,
      SUM(v.stock) stock, SUM(v.stock * COALESCE(v.cost_price, p.cost_price)) stock_value,
      SUM(v.stock * COALESCE(v.sale_price, p.sale_price)) sale_value,
      (SELECT MAX(s.created_at) FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE si.product_id = p.id AND s.status = 'concluida') last_sale,
      (SELECT MAX(m.created_at) FROM stock_movements m JOIN product_variants x ON x.id = m.variant_id WHERE x.product_id = p.id AND m.type IN ('compra','entrada')) last_entry
    FROM products p JOIN product_variants v ON v.product_id = p.id AND v.active = 1
    WHERE p.active = 1 GROUP BY p.id HAVING stock > 0`).all()
    .filter((r) => (r.last_sale ? r.last_sale.slice(0, 10) < cutoff : (r.last_entry || r.created_at).slice(0, 10) < cutoff))
    .map((r) => {
      const ref = (r.last_sale || r.last_entry || r.created_at).slice(0, 10);
      const idle = daysBetween(ref, localDate());
      const margin = r.sale_value ? (1 - r.stock_value / r.sale_value) * 100 : 0;
      // Sugestão de desconto: mais tempo parado = desconto maior, sem passar da margem
      const suggested = Math.max(0, Math.min(Math.floor(margin * 0.6), idle > 120 ? 40 : idle > 90 ? 30 : 20));
      return { ...r, stock_value: r2(r.stock_value), sale_value: r2(r.sale_value), idle_days: idle, never_sold: !r.last_sale, suggested_discount: suggested };
    })
    .sort((a, b) => b.stock_value - a.stock_value);
}

// Variações vendendo rápido com pouca cobertura de estoque
function purchaseSuggestions(db, windowDays = 30, targetDays = 45) {
  const since = addDays(localDate(), -windowDays);
  return db.prepare(`SELECT v.id, v.color, v.size, v.stock, p.id product_id, p.name product_name, p.brand, s.name supplier_name,
      COALESCE(v.cost_price, p.cost_price) cost, SUM(si.quantity - si.returned_qty) sold
    FROM sale_items si JOIN sales sa ON sa.id = si.sale_id AND sa.status = 'concluida' AND date(sa.created_at) >= ?
    JOIN product_variants v ON v.id = si.variant_id JOIN products p ON p.id = v.product_id LEFT JOIN suppliers s ON s.id = p.supplier_id
    WHERE v.active = 1 AND p.active = 1 GROUP BY v.id HAVING sold > 0`).all(since)
    .map((r) => {
      const perDay = r.sold / windowDays;
      const coverage = perDay > 0 ? Math.floor(Math.max(0, r.stock) / perDay) : 999;
      const suggest = Math.max(0, Math.ceil(perDay * targetDays - Math.max(0, r.stock)));
      return { ...r, per_day: r2(perDay), coverage_days: coverage, suggested_qty: suggest, suggested_cost: r2(suggest * r.cost) };
    })
    .filter((r) => r.coverage_days < 20 && r.suggested_qty > 0)
    .sort((a, b) => a.coverage_days - b.coverage_days || b.sold - a.sold);
}

function breakdown(db, from, to, by) {
  const exprs = {
    category: "COALESCE(NULLIF(p.category,''),'Sem categoria')",
    brand: "COALESCE(NULLIF(p.brand,''),'Sem marca')",
    size: "COALESCE(NULLIF(v.size,''),'Único')",
    color: "COALESCE(NULLIF(v.color,''),'Sem cor')",
    seller: "COALESCE(u.name,'—')",
    hour: "strftime('%H', s.created_at)",
    weekday: "strftime('%w', s.created_at)",
  };
  if (by === 'payment') {
    return db.prepare(`SELECT sp.method label, COUNT(DISTINCT s.id) sales, SUM(sp.amount) revenue FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id
      WHERE s.status = 'concluida' AND date(s.created_at) BETWEEN ? AND ? GROUP BY sp.method ORDER BY revenue DESC`).all(from, to)
      .map((r) => ({ ...r, revenue: r2(r.revenue) }));
  }
  const e = exprs[by] || exprs.category;
  const rows = db.prepare(`SELECT ${e} label, COUNT(DISTINCT s.id) sales, SUM(si.quantity - si.returned_qty) qty,
      SUM(si.total * (si.quantity - si.returned_qty) * 1.0 / si.quantity) revenue, SUM(si.unit_cost * (si.quantity - si.returned_qty)) cost
    FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN product_variants v ON v.id = si.variant_id JOIN products p ON p.id = si.product_id
    LEFT JOIN users u ON u.id = s.user_id
    WHERE s.status = 'concluida' AND date(s.created_at) BETWEEN ? AND ? GROUP BY label ORDER BY ${by === 'hour' || by === 'weekday' ? 'label' : 'revenue DESC'}`).all(from, to)
    .map((r) => ({ ...r, label: by === 'weekday' ? WEEKDAYS[Number(r.label)] : by === 'hour' ? `${r.label}h` : r.label, revenue: r2(r.revenue), cost: r2(r.cost), profit: r2(r.revenue - r.cost), margin: r.revenue ? r2((1 - r.cost / r.revenue) * 100) : 0 }));
  return rows;
}

// Grade de tamanhos: vendas x estoque por tamanho (ajuda a comprar a grade certa)
function sizeGrid(db, from, to, category) {
  const params = [from, to];
  let cat = '';
  if (category) { cat = 'AND p.category = ?'; params.push(category); }
  const sold = db.prepare(`SELECT COALESCE(NULLIF(v.size,''),'Único') size, SUM(si.quantity - si.returned_qty) qty
    FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN product_variants v ON v.id = si.variant_id JOIN products p ON p.id = si.product_id
    WHERE s.status='concluida' AND date(s.created_at) BETWEEN ? AND ? ${cat} GROUP BY size`).all(...params);
  const stock = db.prepare(`SELECT COALESCE(NULLIF(v.size,''),'Único') size, SUM(v.stock) qty FROM product_variants v JOIN products p ON p.id = v.product_id
    WHERE v.active = 1 AND p.active = 1 ${category ? 'AND p.category = ?' : ''} GROUP BY size`).all(...(category ? [category] : []));
  const map = new Map();
  for (const s of sold) map.set(s.size, { size: s.size, sold: s.qty, stock: 0 });
  for (const s of stock) { if (!map.has(s.size)) map.set(s.size, { size: s.size, sold: 0, stock: 0 }); map.get(s.size).stock = s.qty; }
  const rows = [...map.values()];
  const totalSold = rows.reduce((a, r) => a + r.sold, 0) || 1;
  const totalStock = rows.reduce((a, r) => a + Math.max(0, r.stock), 0) || 1;
  const order = ['RN', 'PP', 'P', 'M', 'G', 'GG', 'XG', 'XGG', 'EG', 'EGG', 'G1', 'G2', 'G3', 'G4'];
  return rows.map((r) => ({ ...r, sold_share: r2((r.sold / totalSold) * 100), stock_share: r2((Math.max(0, r.stock) / totalStock) * 100) }))
    .sort((a, b) => {
      const ia = order.indexOf(a.size.toUpperCase()), ib = order.indexOf(b.size.toUpperCase());
      if (ia >= 0 && ib >= 0) return ia - ib;
      if (!isNaN(a.size) && !isNaN(b.size)) return Number(a.size) - Number(b.size);
      return ia >= 0 ? -1 : ib >= 0 ? 1 : a.size.localeCompare(b.size);
    });
}

function periodTotals(db, from, to) {
  const s = db.prepare(`SELECT COUNT(*) qty, COALESCE(SUM(total),0) revenue, COALESCE(SUM(cost_total),0) cost,
    (SELECT COALESCE(SUM(si.quantity),0) FROM sale_items si JOIN sales x ON x.id = si.sale_id WHERE x.status='concluida' AND date(x.created_at) BETWEEN @from AND @to) pieces
    FROM sales WHERE status = 'concluida' AND date(created_at) BETWEEN @from AND @to`).get({ from, to });
  const ret = db.prepare(`SELECT COALESCE(SUM(ri.quantity * ri.unit_price),0) v, COALESCE(SUM(ri.quantity * si.unit_cost),0) c FROM return_items ri
    JOIN returns r ON r.id = ri.return_id JOIN sale_items si ON si.id = ri.sale_item_id WHERE date(r.created_at) BETWEEN ? AND ?`).get(from, to);
  const net = r2(s.revenue - ret.v);
  return { sales: s.qty, pieces: s.pieces, revenue: net, profit: r2(net - (s.cost - ret.c)), ticket: s.qty ? r2(s.revenue / s.qty) : 0, pa: s.qty ? r2(s.pieces / s.qty) : 0 };
}

const pct = (a, b) => (b ? Math.round(((a - b) / b) * 100) : null);

module.exports = {
  'reports.revenue': ({ from, to, groupBy }, ctx) => { requireAdmin(ctx); return revenueSeries(dbm.get(), from, to, groupBy); },
  'reports.products': ({ from, to }, ctx) => { requireAdmin(ctx); return productPerformance(dbm.get(), from, to); },
  'reports.stale': ({ days }, ctx) => { requireAdmin(ctx); return staleProducts(dbm.get(), Number(days) || getSettingNum('stale_days') || 60); },
  'reports.breakdown': ({ from, to, by }, ctx) => { requireAdmin(ctx); return breakdown(dbm.get(), from, to, by); },
  'reports.sizeGrid': ({ from, to, category }, ctx) => { requireAdmin(ctx); return sizeGrid(dbm.get(), from, to, category); },
  'reports.purchaseSuggestions': (_, ctx) => { requireAdmin(ctx); return purchaseSuggestions(dbm.get()); },
  'reports.stockValue': (_, ctx) => {
    requireAdmin(ctx);
    return dbm.get().prepare(`SELECT COALESCE(NULLIF(p.category,''),'Sem categoria') category, SUM(MAX(v.stock,0)) pieces,
      SUM(MAX(v.stock,0) * COALESCE(v.cost_price, p.cost_price)) cost_value, SUM(MAX(v.stock,0) * COALESCE(v.sale_price, p.sale_price)) sale_value
      FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.active = 1 AND p.active = 1 GROUP BY category ORDER BY cost_value DESC`).all()
      .map((r) => ({ ...r, cost_value: r2(r.cost_value), sale_value: r2(r.sale_value) }));
  },

  // ---------- Painel inteligente ----------
  'insights.dashboard': (_, ctx) => {
    requireAdmin(ctx);
    const db = dbm.get();
    const today = localDate();
    const lastWeekDay = addDays(today, -7);
    const monthStart = today.slice(0, 8) + '01';
    const [y, m, d] = today.split('-').map(Number);
    const prevMonthStart = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}-01`;
    const prevMonthLastDay = new Date(m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1, 0).getDate();
    const prevMonthSame = prevMonthStart.slice(0, 8) + String(Math.min(d, prevMonthLastDay)).padStart(2, '0');
    const daysInMonth = new Date(y, m, 0).getDate();

    const todayT = periodTotals(db, today, today);
    const lastWeekT = periodTotals(db, lastWeekDay, lastWeekDay);
    const monthT = periodTotals(db, monthStart, today);
    const prevMonthT = periodTotals(db, prevMonthStart, prevMonthSame);
    const projection = r2((monthT.revenue / d) * daysInMonth);
    const series = revenueSeries(db, addDays(today, -29), today, 'day');
    const top = productPerformance(db, addDays(today, -29), today).slice(0, 6);
    const monthDre = dre(db, monthStart, today);

    const alerts = [];
    const push = (level, title, text, link, group) => alerts.push({ level, title, text, link, group });

    // Caixa
    const cash = db.prepare("SELECT * FROM cash_sessions WHERE status = 'aberto'").get();
    if (cash && cash.opened_at.slice(0, 10) < today) push('warning', 'Caixa aberto desde ' + cash.opened_at.slice(0, 10).split('-').reverse().join('/'), 'O caixa de um dia anterior não foi fechado. Feche-o para conferir o dinheiro.', '/caixa', 'Caixa');
    const diffs = db.prepare("SELECT COUNT(*) qty, COALESCE(SUM(difference),0) total FROM cash_sessions WHERE status='fechado' AND date(closed_at) >= ? AND ABS(difference) >= 1").get(addDays(today, -30));
    if (diffs.qty) push(diffs.total < 0 ? 'danger' : 'warning', `${diffs.qty} fechamento(s) de caixa com diferença`, `Nos últimos 30 dias a diferença acumulada foi de ${brl(diffs.total)}. Vale conferir sangrias e trocos.`, '/caixa', 'Caixa');

    // Contas
    const billsToday = db.prepare("SELECT COUNT(*) qty, COALESCE(SUM(amount),0) v FROM payables WHERE status='aberta' AND due_date = ?").get(today);
    const billsLate = db.prepare("SELECT COUNT(*) qty, COALESCE(SUM(amount),0) v FROM payables WHERE status='aberta' AND due_date < ?").get(today);
    const bills7 = db.prepare("SELECT COUNT(*) qty, COALESCE(SUM(amount),0) v FROM payables WHERE status='aberta' AND due_date > ? AND due_date <= ?").get(today, addDays(today, 7));
    if (billsLate.qty) push('danger', `${billsLate.qty} conta(s) atrasada(s)`, `${brl(billsLate.v)} em contas vencidas e não pagas. Evite juros e protestos.`, '/financeiro', 'Financeiro');
    if (billsToday.qty) push('warning', `${billsToday.qty} conta(s) vencem hoje`, `Total de ${brl(billsToday.v)}.`, '/financeiro', 'Financeiro');
    if (bills7.qty) push('info', `${brl(bills7.v)} a pagar nos próximos 7 dias`, `${bills7.qty} conta(s). Confira se o caixa previsto cobre os pagamentos.`, '/financeiro', 'Financeiro');

    // Crediário
    const overdue = db.prepare("SELECT COUNT(DISTINCT customer_id) customers, COALESCE(SUM(amount - paid_amount),0) v FROM installments WHERE status='aberta' AND due_date < ?").get(today);
    if (overdue.customers) push('danger', `${brl(overdue.v)} em parcelas atrasadas`, `${overdue.customers} cliente(s) com crediário vencido. Uma ligação ou mensagem hoje aumenta muito a chance de receber.`, '/crediario', 'Crediário');
    const dueToday = db.prepare("SELECT COUNT(*) qty, COALESCE(SUM(amount - paid_amount),0) v FROM installments WHERE status='aberta' AND due_date = ?").get(today);
    if (dueToday.qty) push('info', `${dueToday.qty} parcela(s) de crediário vencem hoje`, `${brl(dueToday.v)} a receber. Lembre os clientes.`, '/crediario', 'Crediário');

    // Estoque
    const suggestions = purchaseSuggestions(db);
    const urgent = suggestions.filter((s) => s.coverage_days <= 7);
    if (urgent.length) push('warning', `${urgent.length} item(ns) vão acabar em até 7 dias`, `No ritmo atual de vendas: ${urgent.slice(0, 3).map((s) => `${s.product_name} ${s.color || ''} ${s.size || ''}`.trim()).join(', ')}${urgent.length > 3 ? '…' : ''}.`, '/relatorios?tab=reposicao', 'Estoque');
    const zeroSelling = db.prepare(`SELECT COUNT(DISTINCT v.id) c FROM product_variants v JOIN sale_items si ON si.variant_id = v.id JOIN sales s ON s.id = si.sale_id
      WHERE v.stock <= 0 AND v.active = 1 AND s.status='concluida' AND date(s.created_at) >= ?`).get(addDays(today, -30)).c;
    if (zeroSelling) push('danger', `${zeroSelling} variação(ões) esgotada(s) que estavam vendendo`, 'Você pode estar perdendo vendas. Veja a sugestão de reposição.', '/relatorios?tab=reposicao', 'Estoque');

    const staleDays = getSettingNum('stale_days') || 60;
    const stale = staleProducts(db, staleDays);
    const staleValue = r2(stale.reduce((a, s) => a + s.stock_value, 0));
    if (stale.length) push('warning', `${brl(staleValue)} parados em produtos encalhados`, `${stale.length} produto(s) sem vender há mais de ${staleDays} dias. Uma promoção pode transformar estoque parado em dinheiro.`, '/relatorios?tab=encalhados', 'Estoque');

    // Grade de tamanhos desequilibrada
    // Por produto e cor: tamanhos esgotados que vendiam x tamanhos sobrando
    const imbalance = db.prepare(`SELECT p.id, p.name, COALESCE(v.color, '') color,
        GROUP_CONCAT(CASE WHEN v.stock <= 0 AND EXISTS (SELECT 1 FROM sale_items si JOIN sales s ON s.id = si.sale_id
          WHERE si.variant_id = v.id AND s.status='concluida' AND date(s.created_at) >= @since) THEN v.size END, ', ') out_sizes,
        GROUP_CONCAT(CASE WHEN v.stock >= 5 THEN v.size END, ', ') full_sizes
      FROM products p JOIN product_variants v ON v.product_id = p.id AND v.active = 1
      WHERE p.active = 1 GROUP BY p.id, v.color HAVING out_sizes IS NOT NULL AND full_sizes IS NOT NULL LIMIT 5`).all({ since: addDays(today, -45) });
    for (const im of imbalance.slice(0, 2)) {
      push('info', `Grade desequilibrada: ${im.name}${im.color ? ' ' + im.color : ''}`, `Tamanho ${im.out_sizes} esgotou vendendo, enquanto ${im.full_sizes} está sobrando. Na próxima compra, ajuste a grade.`, '/relatorios?tab=grade', 'Estoque');
    }

    const losses = db.prepare(`SELECT COALESCE(SUM(-m.quantity * COALESCE(m.unit_cost,0)),0) v, COALESCE(SUM(-m.quantity),0) q FROM stock_movements m
      WHERE m.type IN ('inventario','ajuste','saida') AND m.quantity < 0 AND m.reference_type IS NOT 'compra' AND date(m.created_at) >= ?`).get(addDays(today, -30));
    if (losses.q > 0) push(losses.v > 200 ? 'danger' : 'warning', `${losses.q} peça(s) perdidas/ajustadas em 30 dias`, `Equivalente a ${brl(losses.v)} em custo. Veja o histórico de movimentação para identificar onde está a diferença.`, '/estoque?tab=auditoria', 'Estoque');

    // Vendas
    if (prevMonthT.revenue > 0) {
      const var_ = pct(monthT.revenue, prevMonthT.revenue);
      if (var_ <= -15) push('warning', `Faturamento do mês ${Math.abs(var_)}% abaixo do mês passado`, `Até hoje: ${brl(monthT.revenue)} contra ${brl(prevMonthT.revenue)} no mesmo período do mês anterior.`, '/relatorios', 'Vendas');
      else if (var_ >= 10) push('success', `Faturamento ${var_}% acima do mês passado`, `Até hoje: ${brl(monthT.revenue)}. Projeção para o mês: ${brl(projection)}.`, '/relatorios', 'Vendas');
    }
    const disc = db.prepare(`SELECT COALESCE(SUM(discount),0) d, COALESCE(SUM(subtotal),0) s FROM sales WHERE status='concluida' AND date(created_at) >= ?`).get(monthStart);
    if (disc.s > 0 && disc.d / disc.s > 0.08) push('warning', `Descontos consumindo ${Math.round((disc.d / disc.s) * 100)}% das vendas`, `${brl(disc.d)} concedidos este mês. Confira se os descontos estão gerando mais vendas.`, '/relatorios', 'Vendas');
    if (monthDre.net_revenue > 0 && monthDre.gross_margin < 40) push('warning', `Margem bruta do mês em ${monthDre.gross_margin}%`, 'Lojas de roupa costumam trabalhar com margem bruta entre 50% e 65%. Revise preços e custos de compra.', '/relatorios?tab=produtos', 'Vendas');

    const bestDay = breakdown(db, addDays(today, -90), today, 'weekday').sort((a, b) => b.revenue - a.revenue)[0];
    const hours = breakdown(db, addDays(today, -90), today, 'hour').sort((a, b) => b.revenue - a.revenue);
    if (bestDay && hours.length) push('info', `Seu melhor dia é ${bestDay.label}, pico às ${hours[0].label}`, 'Baseado nos últimos 90 dias. Garanta equipe completa e vitrine arrumada nesses horários.', '/relatorios?tab=analises', 'Vendas');

    // Clientes
    const md = today.slice(5);
    const birthdays = db.prepare("SELECT id, name, phone, birth_date FROM customers WHERE active = 1 AND birth_date IS NOT NULL AND birth_date <> ''").all()
      .filter((c) => { const bd = c.birth_date.slice(5); for (let k = 0; k < 7; k++) if (addDays(today, k).slice(5) === bd) return true; return false; });
    if (birthdays.length) push('success', `${birthdays.length} cliente(s) fazem aniversário nesta semana`, `${birthdays.slice(0, 4).map((b) => b.name.split(' ')[0] + (b.birth_date.slice(5) === md ? ' (hoje!)' : '')).join(', ')}. Mande uma mensagem com um cupom.`, '/clientes?filter=aniversariantes', 'Clientes');
    const sleeping = db.prepare(`SELECT c.id, c.name, MAX(s.created_at) last, COUNT(s.id) qty, SUM(s.total) total FROM customers c JOIN sales s ON s.customer_id = c.id AND s.status='concluida'
      WHERE c.active = 1 GROUP BY c.id HAVING qty >= 3 AND date(last) < ? ORDER BY total DESC LIMIT 20`).all(addDays(today, -90));
    if (sleeping.length) push('info', `${sleeping.length} cliente(s) fiéis sumiram há mais de 90 dias`, `Ex.: ${sleeping.slice(0, 3).map((s) => s.name.split(' ')[0]).join(', ')}. Avise sobre a coleção nova.`, '/clientes', 'Clientes');

    // Backup
    const lastBackup = getSetting('last_backup_at');
    const folders = JSON.parse(getSetting('backup_folders') || '[]');
    if (!folders.length) push('danger', 'Backup não configurado', 'Configure uma pasta do OneDrive e/ou um pendrive para proteger seus dados.', '/configuracoes?tab=backup', 'Sistema');
    else if (!lastBackup || daysBetween(lastBackup.slice(0, 10), today) > 3) push('danger', 'Backup atrasado', lastBackup ? `Último backup em ${lastBackup.slice(0, 10).split('-').reverse().join('/')}.` : 'Nenhum backup foi feito ainda.', '/configuracoes?tab=backup', 'Sistema');

    const order = { danger: 0, warning: 1, success: 2, info: 3 };
    alerts.sort((a, b) => order[a.level] - order[b.level]);

    return {
      today: { ...todayT, vs_last_week: pct(todayT.revenue, lastWeekT.revenue), last_week: lastWeekT },
      month: { ...monthT, vs_prev: pct(monthT.revenue, prevMonthT.revenue), prev: prevMonthT, projection, gross_margin: monthDre.gross_margin, net_profit: monthDre.net_profit },
      series, top, alerts,
      suggestions: suggestions.slice(0, 8),
      stale: { count: stale.length, value: staleValue, items: stale.slice(0, 6) },
      birthdays,
    };
  },
};
