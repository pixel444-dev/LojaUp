import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ScanBarcode, Trash2, Minus, Plus, User, Percent, Banknote, QrCode, CreditCard, Receipt, Gift, X, Printer, Lock, UserPlus, Search, TriangleAlert,
} from 'lucide-react';
import { api } from '../api';
import { useApp } from '../App';
import { Modal, MoneyInput, Field, useToast, useConfirm, AuthorizeModal, Segmented } from '../components/ui';
import { brl, r2, addDays, today, methodLabel, formatCpf } from '../lib/format';
import { printHtml, saleReceipt, carne } from '../lib/print';
import { CustomerForm } from './Clientes';

const METHODS = [
  { id: 'dinheiro', label: 'Dinheiro', icon: Banknote, key: '1' },
  { id: 'pix', label: 'Pix', icon: QrCode, key: '2' },
  { id: 'debito', label: 'Débito', icon: CreditCard, key: '3' },
  { id: 'credito', label: 'Crédito', icon: CreditCard, key: '4' },
  { id: 'crediario', label: 'Crediário', icon: Receipt, key: '5' },
  { id: 'vale', label: 'Vale-troca', icon: Gift, key: '6' },
];

function CustomerPicker({ onClose, onPick }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState([]);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => api('customers.list', { search: q }).then((l) => setList(l.slice(0, 30))), 150);
    return () => clearTimeout(t);
  }, [q]);
  if (creating) return <CustomerForm onClose={() => setCreating(false)} onSaved={async (id) => onPick(await api('customers.get', { id }))} initial={{ name: q }} />;
  return (
    <Modal title="Selecionar cliente" onClose={onClose} size="lg">
      <div className="row mb">
        <div className="input-group" style={{ flex: 1 }}>
          <Search size={16} className="icon" />
          <input className="input" autoFocus placeholder="Nome, CPF ou telefone" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}><UserPlus size={16} />Novo cliente</button>
      </div>
      <div className="table-wrap" style={{ maxHeight: 420 }}>
        <table className="table">
          <thead><tr><th>Nome</th><th>CPF</th><th>Telefone</th><th className="num">Em aberto</th><th className="num">Limite</th></tr></thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.id} className="clickable" onClick={async () => onPick(await api('customers.get', { id: c.id }))}>
                <td className="strong">{c.name}{c.overdue > 0 && <span className="badge badge-danger" style={{ marginLeft: 6 }}>atrasado</span>}</td>
                <td>{formatCpf(c.cpf)}</td><td>{c.phone}</td>
                <td className="num">{brl(c.balance)}</td><td className="num">{brl(c.credit_limit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

function DiscountModal({ subtotal, current, onClose, onApply }) {
  const [mode, setMode] = useState('value');
  const [value, setValue] = useState(current || '');
  const amount = mode === 'percent' ? r2(subtotal * (Number(value) || 0) / 100) : r2(value);
  return (
    <Modal title="Desconto na venda" onClose={onClose} size="sm"
      footer={<><button className="btn" onClick={() => onApply(0)}>Remover desconto</button><button className="btn btn-primary" onClick={() => onApply(amount)}>Aplicar</button></>}>
      <div className="col">
        <Segmented value={mode} onChange={(m) => { setMode(m); setValue(''); }} options={[{ value: 'value', label: 'Valor (R$)' }, { value: 'percent', label: 'Percentual (%)' }]} />
        {mode === 'value'
          ? <MoneyInput autoFocus className="input-lg" value={value} onChange={setValue} onKeyDown={(e) => e.key === 'Enter' && onApply(amount)} />
          : <input autoFocus className="input input-lg num" type="number" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onApply(amount)} />}
        <div className="muted">Desconto: <b>{brl(amount)}</b> de {brl(subtotal)} → total {brl(subtotal - amount)}</div>
      </div>
    </Modal>
  );
}

function PaymentModal({ total, customer, settings, onClose, onConfirm, busy }) {
  const [payments, setPayments] = useState([]);
  const [method, setMethod] = useState(null);
  const [amount, setAmount] = useState('');
  const [installments, setInstallments] = useState(1);
  const [firstDue, setFirstDue] = useState(addDays(today(), 30));
  const [voucherCode, setVoucherCode] = useState('');
  const [voucher, setVoucher] = useState(null);
  const [crediario, setCrediario] = useState({ installments: 1, first_due: addDays(today(), 30) });
  const toast = useToast();

  const paid = r2(payments.reduce((a, p) => a + p.amount, 0));
  const remaining = r2(total - paid);
  const cash = r2(payments.filter((p) => p.method === 'dinheiro').reduce((a, p) => a + p.amount, 0));
  const change = remaining < 0 ? r2(-remaining) : 0;
  const done = remaining <= 0.001;

  function pick(m) {
    setMethod(m);
    setAmount(remaining > 0 ? remaining : '');
    setInstallments(1);
    setVoucher(null); setVoucherCode('');
  }

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' && method) return;
      const m = METHODS.find((x) => x.key === e.key);
      if (m && !method) { e.preventDefault(); pick(m.id); }
      if (e.key === 'F10' && done) { e.preventDefault(); confirm(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  async function lookupVoucher() {
    try {
      const v = await api('vouchers.get', { code: voucherCode });
      if (v.balance <= 0) { toast.error('Este vale não tem saldo.'); return; }
      setVoucher(v);
      setAmount(Math.min(v.balance, remaining));
    } catch (e) { toast.error(e.message); }
  }

  function add() {
    const v = r2(amount);
    if (!(v > 0)) return;
    if (method !== 'dinheiro' && v > remaining + 0.001) { toast.error('Somente pagamento em dinheiro pode ser maior que o restante (troco).'); return; }
    if (method === 'crediario' && !customer) { toast.error('Selecione o cliente antes (F4).'); return; }
    if (method === 'vale') {
      if (!voucher) { toast.error('Consulte o vale primeiro.'); return; }
      if (v > voucher.balance + 0.001) { toast.error('Valor maior que o saldo do vale.'); return; }
    }
    setPayments([...payments, { method, amount: v, installments: method === 'credito' ? installments : 1, voucher_code: voucher?.code }]);
    if (method === 'crediario') setCrediario({ installments, first_due: firstDue });
    setMethod(null);
    setAmount('');
  }

  function confirm() {
    if (!done || busy) return;
    onConfirm(payments, crediario);
  }

  const maxCard = Number(settings.card_max_installments) || 6;
  const maxCred = Number(settings.credit_max_installments) || 6;
  const credit = customer?.credit;

  return (
    <Modal title="Pagamento" onClose={onClose} size="lg">
      <div className="grid grid-2" style={{ gap: 20 }}>
        <div className="col">
          <div className="pay-methods">
            {METHODS.map((m) => (
              <button key={m.id} className="pay-method" style={method === m.id ? { borderColor: 'var(--primary)', background: 'var(--primary-soft)' } : null}
                onClick={() => pick(m.id)} disabled={done && m.id !== 'dinheiro'}>
                <m.icon size={22} />{m.label}<span className="kbd">{m.key}</span>
              </button>
            ))}
          </div>
          {method && (
            <div className="card card-body col" style={{ background: 'var(--surface-2)' }}>
              <div className="strong">{methodLabel(method)}</div>
              {method === 'vale' && (
                <div className="row">
                  <input className="input" autoFocus placeholder="Código do vale (VT...)" value={voucherCode} onChange={(e) => setVoucherCode(e.target.value.toUpperCase())}
                    onKeyDown={(e) => e.key === 'Enter' && lookupVoucher()} />
                  <button className="btn" onClick={lookupVoucher}>Consultar</button>
                </div>
              )}
              {voucher && <div className="small">Saldo do vale: <b>{brl(voucher.balance)}</b>{voucher.customer_name ? ` — ${voucher.customer_name}` : ''}</div>}
              {(method !== 'vale' || voucher) && (
                <Field label={method === 'dinheiro' ? 'Valor recebido' : 'Valor'}>
                  <MoneyInput autoFocus className="input-lg" value={amount} onChange={setAmount} onKeyDown={(e) => e.key === 'Enter' && add()} />
                </Field>
              )}
              {method === 'credito' && (
                <Field label="Parcelas no cartão">
                  <select className="select" value={installments} onChange={(e) => setInstallments(Number(e.target.value))}>
                    {Array.from({ length: maxCard }, (_, i) => <option key={i} value={i + 1}>{i + 1}x {brl(r2(amount) / (i + 1))}</option>)}
                  </select>
                </Field>
              )}
              {method === 'crediario' && (
                <>
                  {!customer && <div className="alert alert-warning"><TriangleAlert size={16} />Selecione o cliente (F4) para vender no crediário.</div>}
                  {credit && (
                    <div className="small">
                      Limite: <b>{brl(credit.limit)}</b> · Em aberto: <b>{brl(credit.balance)}</b> · Disponível: <b className={credit.available < r2(amount) ? 'text-danger' : 'text-success'}>{brl(credit.available)}</b>
                      {credit.overdueCount > 0 && <div className="text-danger strong">Cliente com {credit.overdueCount} parcela(s) em atraso ({credit.maxDaysLate} dias)</div>}
                    </div>
                  )}
                  <div className="grid grid-2" style={{ gap: 10 }}>
                    <Field label="Parcelas">
                      <select className="select" value={installments} onChange={(e) => setInstallments(Number(e.target.value))}>
                        {Array.from({ length: maxCred }, (_, i) => <option key={i} value={i + 1}>{i + 1}x {brl(r2(amount) / (i + 1))}</option>)}
                      </select>
                    </Field>
                    <Field label="1º vencimento"><input type="date" className="input" value={firstDue} onChange={(e) => setFirstDue(e.target.value)} /></Field>
                  </div>
                </>
              )}
              <div className="row end">
                <button className="btn" onClick={() => setMethod(null)}>Cancelar</button>
                <button className="btn btn-primary" onClick={add}>Adicionar <span className="kbd">Enter</span></button>
              </div>
            </div>
          )}
        </div>
        <div className="col">
          <div className="card card-body">
            <dl className="kv" style={{ fontSize: 15 }}>
              <dt>Total da venda</dt><dd className="strong">{brl(total)}</dd>
              {payments.map((p, i) => (
                <FragmentRow key={i} label={<span>{methodLabel(p.method)}{p.installments > 1 ? ` ${p.installments}x` : ''}{p.method === 'crediario' ? ` (${crediario.installments}x)` : ''}{p.voucher_code ? ` ${p.voucher_code}` : ''}
                  <button className="btn btn-ghost btn-sm" style={{ height: 22, marginLeft: 4 }} onClick={() => setPayments(payments.filter((_, k) => k !== i))}><X size={13} /></button></span>}
                  value={brl(p.amount)} />
              ))}
              <dt className="strong">{remaining > 0 ? 'Falta' : 'Restante'}</dt>
              <dd className={remaining > 0 ? 'text-danger strong' : 'strong'} style={{ fontSize: 18 }}>{brl(Math.max(0, remaining))}</dd>
            </dl>
          </div>
          {change > 0 && (
            <div className="card card-body" style={{ background: 'var(--success-soft)', borderColor: '#b5e0c5' }}>
              <div className="muted">Troco</div>
              <div style={{ fontSize: 34, fontWeight: 800, color: 'var(--success)' }}>{brl(change)}</div>
              {change > cash && <div className="text-danger small">Troco maior que o recebido em dinheiro.</div>}
            </div>
          )}
          <div className="spacer" />
          <button className="btn btn-success btn-xl btn-block" disabled={!done || busy || change > cash + 0.001} onClick={confirm}>
            {busy ? 'Registrando…' : 'Concluir venda'} <span className="kbd">F10</span>
          </button>
        </div>
      </div>
    </Modal>
  );
}

const FragmentRow = ({ label, value }) => (<><dt>{label}</dt><dd>{value}</dd></>);

function SaleDone({ sale, settings, onNew }) {
  const toast = useToast();
  const printed = useRef(false);
  const print = useCallback(async () => {
    try { await printHtml(saleReceipt(sale, settings), settings); } catch (e) { toast.error(e.message); }
  }, [sale, settings, toast]);
  useEffect(() => {
    if (settings.print_auto === '1' && !printed.current) { printed.current = true; print(); }
  }, [print, settings]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); print(); }
      if (e.key === 'F2') { e.preventDefault(); onNew(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [print, onNew]);
  return (
    <Modal title={`Venda #${sale.id} concluída`} size="sm" onClose={onNew}
      footer={<>
        {sale.installments.length > 0 && <button className="btn" onClick={() => printHtml(carne(sale, settings), settings, { thermal: false, dialog: true })}>Imprimir carnê</button>}
        <button className="btn" onClick={print}><Printer size={16} />Cupom <span className="kbd">Enter</span></button>
        <button className="btn btn-primary" onClick={onNew}>Nova venda <span className="kbd">Esc</span></button>
      </>}>
      <div className="col" style={{ alignItems: 'center', textAlign: 'center', padding: '10px 0' }}>
        <div className="muted">Total</div>
        <div style={{ fontSize: 32, fontWeight: 800 }}>{brl(sale.total)}</div>
        {sale.change_amount > 0 && <div className="alert alert-success" style={{ fontSize: 18 }}>Troco: <b>{brl(sale.change_amount)}</b></div>}
        {sale.installments.length > 0 && <div className="muted">Crediário em {sale.installments.length}x — 1º vencimento {sale.installments[0].due_date.split('-').reverse().join('/')}</div>}
      </div>
    </Modal>
  );
}

function OpenCashInline({ onOpened }) {
  const [amount, setAmount] = useState('');
  const toast = useToast();
  async function open() {
    try { await api('cash.open', { amount: r2(amount) }); toast.success('Caixa aberto!'); onOpened(); } catch (e) { toast.error(e.message); }
  }
  return (
    <div className="login-page" style={{ background: 'var(--bg)' }}>
      <div className="card login-card">
        <div className="brand-logo" style={{ width: 46, height: 46, borderRadius: 12 }}><Lock size={22} color="#fff" /></div>
        <h1>Caixa fechado</h1>
        <div className="muted mb">Informe o valor do fundo de troco para abrir o caixa e começar a vender.</div>
        <Field label="Fundo de troco (dinheiro na gaveta)"><MoneyInput autoFocus className="input-lg" value={amount} onChange={setAmount} onKeyDown={(e) => e.key === 'Enter' && open()} /></Field>
        <button className="btn btn-primary btn-lg btn-block mt" onClick={open}>Abrir caixa</button>
        <div className="mt small muted" style={{ textAlign: 'center' }}><Link to="/caixa">Ver histórico de caixas</Link></div>
      </div>
    </div>
  );
}

export default function PDV() {
  const { settings, cash, reloadCash, isAdmin } = useApp();
  const toast = useToast();
  const confirm = useConfirm();
  const [cart, setCart] = useState([]);
  const [customer, setCustomer] = useState(null);
  const [discount, setDiscount] = useState(0);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [active, setActive] = useState(0);
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [doneSale, setDoneSale] = useState(null);
  const [auth, setAuth] = useState(null);
  const inputRef = useRef(null);

  const subtotal = r2(cart.reduce((a, i) => a + i.unit_price * i.quantity, 0));
  const itemsDiscount = r2(cart.reduce((a, i) => a + (i.discount || 0), 0));
  const total = r2(subtotal - itemsDiscount - discount);
  const pieces = cart.reduce((a, i) => a + i.quantity, 0);
  const savings = r2(cart.reduce((a, i) => a + (i.list_price - i.unit_price) * i.quantity, 0) + itemsDiscount + discount);

  const focusInput = () => setTimeout(() => inputRef.current?.focus(), 30);

  function addVariant(v, qty = 1) {
    setCart((c) => {
      const idx = c.findIndex((i) => i.variant_id === v.id && !i.custom);
      if (idx >= 0) {
        const copy = [...c];
        copy[idx] = { ...copy[idx], quantity: copy[idx].quantity + qty };
        return copy;
      }
      return [...c, {
        key: Math.random(), variant_id: v.id, label: v.label, barcode: v.barcode, stock: v.stock, quantity: qty,
        list_price: v.price, unit_price: v.promo_price ?? v.price, promotion_name: v.promotion_name, discount: 0,
      }];
    });
    setQuery(''); setResults([]);
    focusInput();
  }

  // Busca enquanto digita (texto); leitor de código de barras envia Enter
  useEffect(() => {
    const q = query.trim().replace(/^\d+\*/, '');
    if (q.length < 2 || /^\d{8,}$/.test(q)) { setResults([]); return; }
    const t = setTimeout(() => api('products.searchVariants', { q, limit: 30 }).then((r) => { setResults(r); setActive(0); }), 200);
    return () => clearTimeout(t);
  }, [query]);

  async function onEnter() {
    const raw = query.trim();
    if (!raw) return;
    let qty = 1;
    let code = raw;
    const m = raw.match(/^(\d+)\*(.+)$/);
    if (m) { qty = Number(m[1]); code = m[2].trim(); }
    if (results.length && !/^\d{6,}$/.test(code)) { addVariant(results[active], qty); return; }
    const v = await api('products.findBarcode', { code });
    if (v) { addVariant(v, qty); return; }
    const r = await api('products.searchVariants', { q: code, limit: 30 });
    if (r.length === 1) addVariant(r[0], qty);
    else if (r.length) { setResults(r); setActive(0); }
    else { toast.error(`Produto "${code}" não encontrado.`); setQuery(''); }
  }

  function updateItem(key, patch) {
    setCart((c) => c.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  }

  function reset() {
    setCart([]); setCustomer(null); setDiscount(0); setQuery(''); setResults([]); setDoneSale(null); setModal(null);
    focusInput();
  }

  async function cancelSale() {
    if (!cart.length) return;
    if (await confirm({ message: 'Cancelar a venda em andamento?', confirmText: 'Cancelar venda', danger: true })) reset();
  }

  async function finish(payments, crediario, authorization) {
    setBusy(true);
    try {
      const id = await api('sales.create', {
        customer_id: customer?.id,
        items: cart.map((i) => ({ variant_id: i.variant_id, quantity: i.quantity, unit_price: i.unit_price, discount: i.discount || 0 })),
        discount, payments, crediario, authorization,
      });
      const sale = await api('sales.get', { id });
      setModal(null);
      setDoneSale(sale);
      reloadCash();
    } catch (e) {
      if (e.authRequired) setAuth({ message: e.message, retry: (a) => finish(payments, crediario, a) });
      else toast.error(e.message);
    } finally { setBusy(false); }
  }

  useEffect(() => {
    const onKey = (e) => {
      if (modal || doneSale || auth) return;
      if (e.key === 'F2') { e.preventDefault(); focusInput(); }
      if (e.key === 'F4') { e.preventDefault(); setModal('customer'); }
      if (e.key === 'F6' && cart.length) { e.preventDefault(); setModal('discount'); }
      if (e.key === 'F10' && cart.length) { e.preventDefault(); setModal('pay'); }
      if (e.key === 'Escape') { e.preventDefault(); if (results.length) setResults([]); else cancelSale(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => { focusInput(); }, []);

  const credit = customer?.credit;
  const lowStock = useMemo(() => cart.filter((i) => i.stock - i.quantity < 0), [cart]);

  if (!cash) return <OpenCashInline onOpened={reloadCash} />;

  return (
    <div className="pdv">
      <div className="pdv-left">
        <div style={{ position: 'relative' }}>
          <div className="input-group lg">
            <ScanBarcode size={22} className="icon" />
            <input ref={inputRef} className="input input-lg" placeholder="Passe o código de barras ou digite o nome do produto  (ex.: 3*7891234 para 3 unidades)"
              value={query} onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); onEnter().catch((err) => toast.error(err.message)); }
                if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
                if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
              }} />
          </div>
          {results.length > 0 && (
            <div className="search-results">
              {results.map((v, i) => (
                <div key={v.id} className={`search-item ${i === active ? 'active' : ''}`} onMouseDown={(e) => { e.preventDefault(); addVariant(v); }}>
                  <div style={{ flex: 1 }}>
                    <div className="strong">{v.label}</div>
                    <div className="small muted">{[v.brand, v.model, v.barcode].filter(Boolean).join(' · ')}</div>
                  </div>
                  <span className={`badge ${v.stock > 0 ? 'badge-success' : 'badge-danger'}`}>{v.stock} em estoque</span>
                  <div className="num" style={{ minWidth: 90 }}>
                    {v.promo_price != null && <div className="small muted" style={{ textDecoration: 'line-through' }}>{brl(v.price)}</div>}
                    <div className="strong">{brl(v.promo_price ?? v.price)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card pdv-items">
          {cart.length === 0 ? (
            <div className="empty" style={{ paddingTop: 80 }}>
              <ScanBarcode size={56} />
              <div style={{ fontSize: 16, marginTop: 6 }}>Passe o primeiro produto no leitor</div>
              <div className="small">ou digite o nome, cor ou tamanho para buscar</div>
            </div>
          ) : (
            <table className="table">
              <thead><tr><th style={{ width: 30 }}>#</th><th>Produto</th><th className="num">Preço</th><th style={{ textAlign: 'center' }}>Qtd</th><th className="num">Desc. item</th><th className="num">Total</th><th /></tr></thead>
              <tbody>
                {cart.map((i, idx) => (
                  <tr key={i.key}>
                    <td className="muted">{idx + 1}</td>
                    <td>
                      <div className="strong">{i.label}</div>
                      <div className="small muted">
                        {i.barcode}
                        {i.promotion_name && <span className="badge badge-primary" style={{ marginLeft: 6 }}>{i.promotion_name}</span>}
                        {i.stock - i.quantity < 0 && <span className="badge badge-warning" style={{ marginLeft: 6 }}>estoque: {i.stock}</span>}
                      </div>
                    </td>
                    <td className="num" style={{ width: 120 }}>
                      <MoneyInput className="btn-sm" style={{ height: 30 }} value={i.unit_price} onChange={(v) => updateItem(i.key, { unit_price: r2(v) })} onBlur={focusInput} />
                      {i.unit_price < i.list_price && <div className="small muted" style={{ textDecoration: 'line-through' }}>{brl(i.list_price)}</div>}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <div className="qty-control">
                        <button onClick={() => i.quantity > 1 && updateItem(i.key, { quantity: i.quantity - 1 })}><Minus size={14} /></button>
                        <span>{i.quantity}</span>
                        <button onClick={() => updateItem(i.key, { quantity: i.quantity + 1 })}><Plus size={14} /></button>
                      </div>
                    </td>
                    <td className="num" style={{ width: 110 }}>
                      <MoneyInput style={{ height: 30 }} value={i.discount || ''} placeholder="0,00" onChange={(v) => updateItem(i.key, { discount: r2(v) })} onBlur={focusInput} />
                    </td>
                    <td className="num strong">{brl(i.unit_price * i.quantity - (i.discount || 0))}</td>
                    <td className="actions-cell"><button className="btn btn-ghost btn-icon" title="Remover" onClick={() => { setCart(cart.filter((x) => x.key !== i.key)); focusInput(); }}><Trash2 size={16} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="pdv-shortcuts">
          <span className="badge"><span className="kbd">F2</span> Buscar produto</span>
          <span className="badge"><span className="kbd">F4</span> Cliente</span>
          <span className="badge"><span className="kbd">F6</span> Desconto</span>
          <span className="badge"><span className="kbd">F10</span> Finalizar</span>
          <span className="badge"><span className="kbd">Esc</span> Cancelar venda</span>
          {!isAdmin && <span className="badge">Desconto máximo sem autorização: {settings.max_discount_percent_seller}%</span>}
        </div>
      </div>

      <div className="pdv-right">
        <div style={{ padding: 18, borderBottom: '1px solid var(--border)' }}>
          <div className="row between mb" style={{ marginBottom: 8 }}>
            <div className="strong">Cliente</div>
            <button className="btn btn-sm" onClick={() => setModal('customer')}><User size={14} />{customer ? 'Trocar' : 'Selecionar'} <span className="kbd">F4</span></button>
          </div>
          {customer ? (
            <div className="card card-body" style={{ padding: 12 }}>
              <div className="row between"><div className="strong">{customer.name}</div><button className="btn btn-ghost btn-icon" onClick={() => setCustomer(null)}><X size={15} /></button></div>
              <div className="small muted">{[formatCpf(customer.cpf), customer.phone].filter(Boolean).join(' · ')}</div>
              {credit && (
                <div className="small mt-s">
                  Crédito disponível: <b className={credit.available > 0 ? 'text-success' : 'text-danger'}>{brl(credit.available)}</b> de {brl(credit.limit)}
                  {credit.overdueCount > 0 && <div className="text-danger strong">⚠ {brl(credit.overdueAmount)} em atraso ({credit.maxDaysLate} dias)</div>}
                </div>
              )}
              {customer.vouchers?.length > 0 && <div className="small mt-s"><Gift size={12} /> Tem vale-troca: {customer.vouchers.map((v) => `${v.code} (${brl(v.balance)})`).join(', ')}</div>}
            </div>
          ) : <div className="muted small">Venda sem cliente identificado (consumidor).</div>}
        </div>
        <div style={{ padding: 18, flex: 1 }}>
          <dl className="kv" style={{ fontSize: 14.5, gap: '10px 16px' }}>
            <dt>Itens / peças</dt><dd>{cart.length} / {pieces}</dd>
            <dt>Subtotal</dt><dd>{brl(subtotal)}</dd>
            {itemsDiscount > 0 && <><dt>Desconto nos itens</dt><dd className="text-danger">-{brl(itemsDiscount)}</dd></>}
            <dt><button className="btn btn-sm" disabled={!cart.length} onClick={() => setModal('discount')}><Percent size={14} />Desconto <span className="kbd">F6</span></button></dt>
            <dd className={discount ? 'text-danger' : 'muted'}>{discount ? '-' + brl(discount) : '—'}</dd>
          </dl>
          {savings > 0.009 && <div className="alert alert-success mt small">O cliente está economizando {brl(savings)} nesta compra.</div>}
          {lowStock.length > 0 && <div className="alert alert-warning mt small"><TriangleAlert size={16} />{lowStock.length} item(ns) sem saldo suficiente no estoque. A venda será registrada e o estoque ficará negativo.</div>}
        </div>
        <div className="pdv-total-box">
          <div className="muted">Total a pagar</div>
          <div className="pdv-total">{brl(total)}</div>
          <div className="row mt">
            <button className="btn btn-lg" disabled={!cart.length} onClick={cancelSale}>Cancelar</button>
            <button className="btn btn-success btn-xl" style={{ flex: 1 }} disabled={!cart.length || total < 0} onClick={() => setModal('pay')}>Finalizar <span className="kbd">F10</span></button>
          </div>
        </div>
      </div>

      {modal === 'customer' && <CustomerPicker onClose={() => { setModal(null); focusInput(); }} onPick={(c) => { setCustomer(c); setModal(null); focusInput(); }} />}
      {modal === 'discount' && <DiscountModal subtotal={r2(subtotal - itemsDiscount)} current={discount} onClose={() => { setModal(null); focusInput(); }} onApply={(v) => { setDiscount(Math.max(0, Math.min(v, subtotal - itemsDiscount))); setModal(null); focusInput(); }} />}
      {modal === 'pay' && <PaymentModal total={total} customer={customer} settings={settings} busy={busy} onClose={() => { setModal(null); focusInput(); }} onConfirm={(p, c) => finish(p, c)} />}
      {doneSale && <SaleDone sale={doneSale} settings={settings} onNew={reset} />}
      {auth && <AuthorizeModal message={auth.message} onClose={() => setAuth(null)} onAuthorized={(a) => { const retry = auth.retry; setAuth(null); retry(a); }} />}
    </div>
  );
}
