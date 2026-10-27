import JsBarcode from 'jsbarcode';
import { api, isElectron } from '../api';
import { brl, date, dateTime, methodLabel, formatCpf } from './format';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function thermalDoc(settings, body) {
  const w = Number(settings.printer_width) || 80;
  const font = w <= 58 ? 10.5 : 12;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { margin: 0; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 3mm 3mm 6mm; width: ${w}mm; font-family: 'Courier New', Consolas, monospace; font-size: ${font}px; color: #000; line-height: 1.3; }
    .c { text-align: center; } .r { text-align: right; } .b { font-weight: bold; }
    .big { font-size: ${font + 4}px; font-weight: bold; }
    .hr { border-top: 1px dashed #000; margin: 5px 0; }
    table { width: 100%; border-collapse: collapse; } td { vertical-align: top; padding: 1px 0; }
    .row { display: flex; justify-content: space-between; gap: 6px; }
    .item-desc { word-break: break-word; }
  </style></head><body>${storeHeader(settings)}${body}</body></html>`;
}

function storeHeader(s) {
  return `<div class="c b big">${esc(s.store_name)}</div>
    ${s.store_document ? `<div class="c">CNPJ/CPF: ${esc(s.store_document)}</div>` : ''}
    ${s.store_address ? `<div class="c">${esc(s.store_address)}</div>` : ''}
    ${s.store_phone ? `<div class="c">Tel: ${esc(s.store_phone)}</div>` : ''}
    <div class="hr"></div>`;
}

const line = (l, r, cls = '') => `<div class="row ${cls}"><span>${l}</span><span>${r}</span></div>`;

export function saleReceipt(sale, settings) {
  const items = sale.items.map((i) => `
    <div class="item-desc">${esc(i.description)}</div>
    ${line(`&nbsp;&nbsp;${i.quantity} x ${brl(i.unit_price)}`, brl(i.unit_price * i.quantity))}
    ${i.discount > 0 ? line('&nbsp;&nbsp;desconto', '-' + brl(i.discount)) : ''}`).join('');
  const pays = sale.payments.map((p) => line(methodLabel(p.method) + (p.installments > 1 ? ` ${p.installments}x` : '') + (p.voucher_code ? ` ${p.voucher_code}` : ''), brl(p.amount))).join('');
  const cashGiven = sale.payments.filter((p) => p.method === 'dinheiro').reduce((a, p) => a + p.amount, 0) + (sale.change_amount || 0);
  const inst = sale.installments?.length ? `<div class="hr"></div><div class="b">CREDIÁRIO</div>
    ${sale.installments.map((i) => line(`${i.number}/${i.total_numbers} venc. ${date(i.due_date)}`, brl(i.amount))).join('')}
    <br><div class="c">_______________________________</div><div class="c">Assinatura do cliente</div>` : '';
  return thermalDoc(settings, `
    <div class="c b">CUPOM NÃO FISCAL</div>
    ${line('Venda #' + sale.id, dateTime(sale.created_at))}
    ${sale.customer_name ? `<div>Cliente: ${esc(sale.customer_name)}${sale.customer_cpf ? ' — ' + formatCpf(sale.customer_cpf) : ''}</div>` : ''}
    <div>Vendedor: ${esc(sale.user_name || '')}</div>
    ${sale.status === 'cancelada' ? '<div class="c b big">*** CANCELADA ***</div>' : ''}
    <div class="hr"></div>${items}<div class="hr"></div>
    ${line('Subtotal', brl(sale.subtotal))}
    ${sale.discount > 0 ? line('Descontos', '-' + brl(sale.discount)) : ''}
    ${line('TOTAL', brl(sale.total), 'big')}
    <div class="hr"></div>${pays}
    ${sale.change_amount > 0 ? line('Valor recebido', brl(cashGiven)) + line('TROCO', brl(sale.change_amount), 'b') : ''}
    ${inst}
    <div class="hr"></div>
    <div class="c">Peças: ${sale.items.reduce((a, i) => a + i.quantity, 0)}</div>
    ${settings.receipt_footer ? `<div class="c">${esc(settings.receipt_footer)}</div>` : ''}
    <div class="c small">Este documento não tem valor fiscal</div>`);
}

export function installmentReceipt(rc, settings) {
  const r0 = rc.rows[0];
  return thermalDoc(settings, `
    <div class="c b">RECIBO DE PAGAMENTO</div>
    ${line('Data', dateTime(rc.created_at))}
    <div>Cliente: ${esc(r0.customer_name)}${r0.customer_cpf ? ' — ' + formatCpf(r0.customer_cpf) : ''}</div>
    <div class="hr"></div>
    ${rc.rows.map((r) => `${line(`Parcela ${r.number}/${r.total_numbers} (venda #${r.sale_id})`, brl(r.amount))}
      <div>&nbsp;&nbsp;venc. ${date(r.due_date)}${r.installment_paid + 0.001 < r.installment_amount ? ' — pagamento parcial' : ''}</div>
      ${r.interest > 0 ? line('&nbsp;&nbsp;juros/multa', brl(r.interest)) : ''}`).join('')}
    <div class="hr"></div>
    ${line('TOTAL PAGO', brl(rc.total), 'big')}
    ${line('Forma', methodLabel(r0.method))}
    ${line('Saldo devedor restante', brl(rc.balance), 'b')}
    <div class="hr"></div>
    <div>Recebido por: ${esc(r0.user_name || '')}</div>
    <br><div class="c">_______________________________</div><div class="c">${esc(settings.store_name)}</div>`);
}

export function voucherReceipt(v, settings, info = {}) {
  return thermalDoc(settings, `
    <div class="c b big">VALE-TROCA</div>
    <div class="c big">${esc(v.code)}</div>
    <div class="hr"></div>
    ${line('Valor', brl(v.amount), 'big')}
    ${info.customer ? `<div>Cliente: ${esc(info.customer)}</div>` : ''}
    ${info.saleId ? `<div>Ref. venda #${info.saleId}</div>` : ''}
    <div>Emitido em ${dateTime(new Date().toISOString().replace('T', ' '))}</div>
    <div class="hr"></div>
    <div class="c">Apresente este código no caixa para usar o crédito.</div>`);
}

export function cashReport(sum, settings) {
  const s = sum.session;
  const methods = Object.entries(sum.byMethod).filter(([, v]) => v.sales || v.receipts);
  return thermalDoc(settings, `
    <div class="c b">${s.status === 'fechado' ? 'FECHAMENTO DE CAIXA' : 'RESUMO DO CAIXA (PARCIAL)'}</div>
    ${line('Caixa #' + s.id, '')}
    ${line('Abertura', dateTime(s.opened_at))}
    ${s.closed_at ? line('Fechamento', dateTime(s.closed_at)) : ''}
    ${line('Operador', esc(s.user_name || ''))}
    <div class="hr"></div>
    <div class="b">VENDAS</div>
    ${line('Quantidade', sum.salesInfo.qty)}
    ${line('Total vendido', brl(sum.salesInfo.total))}
    ${line('Descontos', brl(sum.salesInfo.discount))}
    ${line('Ticket médio', brl(sum.ticket))}
    ${sum.canceled.qty ? line('Canceladas', `${sum.canceled.qty} (${brl(sum.canceled.total)})`) : ''}
    <div class="hr"></div>
    <div class="b">POR FORMA DE PAGAMENTO</div>
    ${methods.map(([m, v]) => line(methodLabel(m), brl(v.sales + v.receipts))).join('') || '<div>—</div>'}
    <div class="hr"></div>
    <div class="b">DINHEIRO NA GAVETA</div>
    ${line('Fundo de troco', brl(s.opening_amount))}
    ${line('(+) Vendas em dinheiro', brl(sum.byMethod.dinheiro.sales))}
    ${line('(+) Receb. crediário', brl(sum.byMethod.dinheiro.receipts))}
    ${line('(+) Suprimentos', brl(sum.suprimentos))}
    ${line('(-) Sangrias', brl(sum.sangrias))}
    ${sum.cashRefunds ? line('(-) Devoluções', brl(sum.cashRefunds)) : ''}
    ${sum.estornos ? line('(-) Estornos', brl(sum.estornos)) : ''}
    ${line('= Esperado', brl(sum.expectedCash), 'b')}
    ${s.status === 'fechado' ? line('Contado', brl(s.counted_amount), 'b') + line('Diferença', brl(s.difference), 'big') : ''}
    ${sum.moves.length ? `<div class="hr"></div><div class="b">SANGRIAS / SUPRIMENTOS</div>${sum.moves.map((m) => line(`${m.type} ${esc(m.description || '')}`, brl(m.amount))).join('')}` : ''}
    <br><div class="c">_______________________________</div><div class="c">Conferido por</div>`);
}

export function carne(sale, settings) {
  const pages = sale.installments.map((i) => `
    <div class="slip">
      <div class="stub">
        <b>${esc(settings.store_name)}</b><br>Parcela ${i.number}/${i.total_numbers}<br>Venc.: <b>${date(i.due_date)}</b><br>Valor: <b>${brl(i.amount)}</b><br>Venda #${sale.id}
      </div>
      <div class="main">
        <div class="top"><b>${esc(settings.store_name)}</b><span>CARNÊ DE PAGAMENTO</span></div>
        <table><tr><td>Cliente</td><td><b>${esc(sale.customer_name || '')}</b></td></tr>
        <tr><td>Parcela</td><td>${i.number} de ${i.total_numbers}</td></tr>
        <tr><td>Vencimento</td><td><b>${date(i.due_date)}</b></td></tr>
        <tr><td>Valor</td><td><b>${brl(i.amount)}</b></td></tr>
        <tr><td>Referência</td><td>Venda #${sale.id} de ${date(sale.created_at)}</td></tr></table>
        <div class="obs">Após o vencimento: multa de ${settings.credit_late_fee_percent}% + juros de ${settings.credit_interest_month_percent}% ao mês.</div>
      </div>
    </div>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 10mm; }
    body { font-family: Arial, sans-serif; font-size: 11.5px; color: #000; margin: 0; }
    .slip { display: flex; border: 1px solid #000; margin-bottom: 6mm; page-break-inside: avoid; height: 52mm; }
    .stub { width: 45mm; border-right: 1px dashed #000; padding: 4mm; line-height: 1.6; }
    .main { flex: 1; padding: 4mm 5mm; }
    .top { display: flex; justify-content: space-between; border-bottom: 1px solid #000; padding-bottom: 2mm; margin-bottom: 2mm; font-size: 13px; }
    table td { padding: 1px 10px 1px 0; } .obs { margin-top: 3mm; font-size: 10px; color: #333; }
  </style></head><body>${pages}</body></html>`;
}

function barcodeSvg(code) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const isEan = /^\d{13}$/.test(code);
  try {
    JsBarcode(svg, code, { format: isEan ? 'EAN13' : 'CODE128', width: 1.6, height: 34, fontSize: 12, margin: 0, displayValue: true, flat: true });
  } catch (e) {
    JsBarcode(svg, code, { format: 'CODE128', width: 1.6, height: 34, fontSize: 12, margin: 0 });
  }
  return svg.outerHTML;
}

// mode: 'a4' (folha de etiquetas adesivas) ou 'label' (impressora de etiquetas, uma por página)
export function labelsDoc(items, settings, { mode = 'a4', width = 50, height = 30 } = {}) {
  const all = [];
  for (const it of items) for (let k = 0; k < it.copies; k++) all.push(it);
  const label = (it) => `<div class="label">
      <div class="store">${esc(settings.store_name)}</div>
      <div class="name">${esc(it.name)}</div>
      <div class="var">${esc([it.color, it.size].filter(Boolean).join(' • '))}</div>
      <div class="bc">${barcodeSvg(it.barcode)}</div>
      <div class="price">${brl(it.price)}</div>
    </div>`;
  const common = `.label { overflow: hidden; text-align: center; font-family: Arial, sans-serif; color: #000; display: flex; flex-direction: column; justify-content: center; padding: 1.5mm; }
    .store { font-size: 7px; text-transform: uppercase; } .name { font-size: 9px; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .var { font-size: 8.5px; } .bc svg { max-width: 100%; height: auto; max-height: ${Math.max(10, height * 0.42)}mm; } .price { font-size: 13px; font-weight: bold; }`;
  if (mode === 'label') {
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      @page { size: ${width}mm ${height}mm; margin: 0; } body { margin: 0; }
      .label { width: ${width}mm; height: ${height}mm; page-break-after: always; } ${common}
    </style></head><body>${all.map(label).join('')}</body></html>`;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 8mm; } body { margin: 0; }
    .sheet { display: grid; grid-template-columns: repeat(auto-fill, ${width}mm); gap: 2mm; }
    .label { width: ${width}mm; height: ${height}mm; border: 0.2mm dashed #bbb; page-break-inside: avoid; } ${common}
  </style></head><body><div class="sheet">${all.map(label).join('')}</div></body></html>`;
}

// Envia para impressão. thermal=true usa a largura da bobina e impressora configuradas.
export async function printHtml(html, settings, { thermal = true, dialog = false } = {}) {
  if (!isElectron()) {
    const w = window.open('', '_blank', 'width=420,height=700');
    if (!w) return;
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 300);
    return;
  }
  const silent = !dialog && settings.print_silent === '1' && !!settings.printer_name;
  await api('print.html', {
    html,
    silent,
    deviceName: thermal ? settings.printer_name || undefined : undefined,
    widthMm: thermal ? Number(settings.printer_width) || 80 : undefined,
  });
}
