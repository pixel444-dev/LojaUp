const brlFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const numFmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

export const brl = (v) => brlFmt.format(Number(v) || 0);
export const num = (v) => numFmt.format(Number(v) || 0);
export const pct = (v) => `${numFmt.format(Number(v) || 0)}%`;
export const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Converte texto digitado ("1.234,56" ou "12,5") em número
export function parseMoney(s) {
  if (typeof s === 'number') return s;
  if (!s) return 0;
  const clean = String(s).replace(/[^\d,.-]/g, '');
  if (clean.includes(',')) return Number(clean.replace(/\./g, '').replace(',', '.')) || 0;
  return Number(clean) || 0;
}

const pad = (n) => String(n).padStart(2, '0');
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const x = new Date(y, m - 1, d + n);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}
export const monthStart = (d = today()) => d.slice(0, 8) + '01';
export function monthEnd(d = today()) {
  const [y, m] = d.split('-').map(Number);
  return `${y}-${pad(m)}-${pad(new Date(y, m, 0).getDate())}`;
}

export function date(s) {
  if (!s) return '—';
  const [y, m, d] = String(s).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}
export function dateTime(s) {
  if (!s) return '—';
  return `${date(s)} ${String(s).slice(11, 16)}`;
}
export function daysFromToday(s) {
  if (!s) return 0;
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((new Date(y, m - 1, d) - t) / 86400000);
}

export const METHOD_LABELS = {
  dinheiro: 'Dinheiro', pix: 'Pix', debito: 'Cartão de débito', credito: 'Cartão de crédito', crediario: 'Crediário', vale: 'Vale-troca',
  estorno: 'Estorno (cartão/Pix)', abater_crediario: 'Abatido no crediário',
};
export const methodLabel = (m) => METHOD_LABELS[m] || m;
export const methodsLabel = (s) => (s ? s.split(',').map(methodLabel).join(', ') : '—');

export const MOVEMENT_LABELS = {
  entrada: 'Entrada', saida: 'Saída', venda: 'Venda', compra: 'Compra', devolucao: 'Devolução', cancelamento: 'Cancelamento de venda',
  ajuste: 'Ajuste', inventario: 'Inventário',
};

export function formatCpf(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (d.length !== 11) return v || '';
  return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}
export function formatPhone(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
  if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
  return v || '';
}
export const whatsappLink = (phone, text = '') => {
  const d = String(phone || '').replace(/\D/g, '');
  return d ? `https://wa.me/55${d}?text=${encodeURIComponent(text)}` : null;
};
export const bytes = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);
