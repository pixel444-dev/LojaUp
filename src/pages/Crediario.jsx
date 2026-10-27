import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, MessageCircle, Printer, CreditCard } from 'lucide-react';
import { api } from '../api';
import { useApp } from '../App';
import { Modal, Field, MoneyInput, useLoad, useAction, PageHeader, Empty, Loading, Segmented, Stat, Tabs, useToast } from '../components/ui';
import { brl, date, r2, daysFromToday, whatsappLink, formatPhone } from '../lib/format';
import { printHtml, installmentReceipt } from '../lib/print';

// Recebimento de parcelas (uma ou várias) com juros/multa sugeridos
export function ReceiveModal({ customerId, customerName, installments, onClose, onDone }) {
  const { settings, reloadCash } = useApp();
  const toast = useToast();
  const [run, busy] = useAction();
  const [method, setMethod] = useState('dinheiro');
  const [chargeLate, setChargeLate] = useState(true);
  const [rows, setRows] = useState(() => installments.map((i) => ({
    id: i.id, label: `${i.number}/${i.total_numbers} — venc. ${date(i.due_date)}`, remaining: i.charges.remaining,
    late: r2(i.charges.fee + i.charges.interest), days: i.charges.days, amount: i.charges.remaining,
  })));
  const total = r2(rows.reduce((a, r) => a + r2(r.amount) + (chargeLate ? r.late : 0), 0));

  async function confirm() {
    const group = await run(() => api('installments.pay', {
      customerId, method,
      items: rows.filter((r) => r2(r.amount) > 0).map((r) => ({ installment_id: r.id, amount: r2(r.amount), interest: chargeLate ? r.late : 0 })),
    }), 'Pagamento registrado!');
    reloadCash();
    try {
      const rc = await api('installments.receipt', { group });
      await printHtml(installmentReceipt(rc, settings), settings);
    } catch (e) { toast.error('Recibo: ' + e.message); }
    onDone();
  }

  return (
    <Modal title={`Receber crediário — ${customerName}`} onClose={onClose} size="lg"
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-success" disabled={busy || total <= 0} onClick={confirm}>Receber {brl(total)} e imprimir recibo</button></>}>
      <table className="table table-compact">
        <thead><tr><th>Parcela</th><th className="num">Saldo</th><th className="num">Atraso</th><th className="num">Juros + multa</th><th className="num" style={{ width: 150 }}>Valor a pagar</th></tr></thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr key={r.id}>
              <td>{r.label}</td>
              <td className="num">{brl(r.remaining)}</td>
              <td className="num">{r.days > 0 ? <span className="badge badge-danger">{r.days} dias</span> : '—'}</td>
              <td className="num">{r.late > 0 ? brl(r.late) : '—'}</td>
              <td><MoneyInput value={r.amount} onChange={(v) => setRows(rows.map((x, k) => (k === idx ? { ...x, amount: Math.min(r2(v), x.remaining) } : x)))} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row mt wrap">
        <Field label="Forma de pagamento">
          <Segmented value={method} onChange={setMethod} options={[{ value: 'dinheiro', label: 'Dinheiro' }, { value: 'pix', label: 'Pix' }, { value: 'debito', label: 'Débito' }, { value: 'credito', label: 'Crédito' }]} />
        </Field>
        <div className="spacer" />
        {rows.some((r) => r.late > 0) && (
          <label className="checkbox"><input type="checkbox" checked={chargeLate} onChange={(e) => setChargeLate(e.target.checked)} />Cobrar juros e multa por atraso</label>
        )}
      </div>
      <div className="small muted mt-s">Valor menor que o saldo registra pagamento parcial. Juros: {settings.credit_interest_month_percent}% ao mês · Multa: {settings.credit_late_fee_percent}%.</div>
    </Modal>
  );
}

function Parcelas() {
  const [status, setStatus] = useState('vencida');
  const [search, setSearch] = useState('');
  const [receiving, setReceiving] = useState(null);
  const nav = useNavigate();
  const { data, loading, reload } = useLoad('installments.list', { status, search }, [status, search]);
  const { settings } = useApp();

  const grouped = useMemo(() => {
    const m = new Map();
    for (const i of data || []) {
      if (!m.has(i.customer_id)) m.set(i.customer_id, { id: i.customer_id, name: i.customer_name, phone: i.customer_phone, items: [] });
      m.get(i.customer_id).items.push(i);
    }
    return [...m.values()];
  }, [data]);

  return (
    <>
      <div className="row mb wrap">
        <Segmented value={status} onChange={setStatus} options={[{ value: 'vencida', label: 'Vencidas' }, { value: 'aberta', label: 'Todas em aberto' }, { value: 'paga', label: 'Pagas' }]} />
        <div className="input-group" style={{ width: 300 }}><Search size={16} className="icon" /><input className="input" placeholder="Cliente ou CPF" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      </div>
      {loading && !data ? <Loading /> : !grouped.length ? <div className="card"><Empty>Nenhuma parcela {status === 'vencida' ? 'vencida 🎉' : 'encontrada'}.</Empty></div> : (
        <div className="col" style={{ gap: 12 }}>
          {grouped.map((g) => {
            const open = g.items.filter((i) => i.status === 'aberta');
            const due = r2(open.reduce((a, i) => a + i.charges.total, 0));
            const overdue = open.filter((i) => i.charges.days > 0);
            const msg = `Olá ${g.name.split(' ')[0]}, tudo bem? Aqui é da ${settings.store_name}. Consta em aberto ${overdue.length || open.length} parcela(s) do seu crediário, total de ${brl(due)}. Podemos combinar o pagamento?`;
            return (
              <div key={g.id} className="card">
                <div className="card-header">
                  <h3 className="clickable" style={{ cursor: 'pointer' }} onClick={() => nav(`/clientes/${g.id}`)}>{g.name}</h3>
                  <span className="muted small">{formatPhone(g.phone)}</span>
                  <div className="actions">
                    {g.phone && open.length > 0 && <a className="btn btn-sm" href={whatsappLink(g.phone, msg)} target="_blank" rel="noreferrer"><MessageCircle size={14} />Cobrar no WhatsApp</a>}
                    {open.length > 0 && <button className="btn btn-sm btn-success" onClick={() => setReceiving(g)}><CreditCard size={14} />Receber {brl(due)}</button>}
                  </div>
                </div>
                <table className="table table-compact">
                  <thead><tr><th>Parcela</th><th>Venda</th><th>Vencimento</th><th className="num">Valor</th><th className="num">Pago</th><th className="num">Com juros</th><th>Situação</th></tr></thead>
                  <tbody>
                    {g.items.map((i) => (
                      <tr key={i.id}>
                        <td>{i.number}/{i.total_numbers}</td><td>#{i.sale_id}</td><td>{date(i.due_date)}</td>
                        <td className="num">{brl(i.amount)}</td><td className="num">{brl(i.paid_amount)}</td>
                        <td className="num">{i.status === 'aberta' ? brl(i.charges.total) : '—'}</td>
                        <td>{i.status === 'paga' ? <span className="badge badge-success">Paga {date(i.paid_at)}</span>
                          : i.charges.days > 0 ? <span className="badge badge-danger">{i.charges.days} dias de atraso</span>
                            : <span className="badge badge-warning">vence {daysFromToday(i.due_date) === 0 ? 'hoje' : `em ${daysFromToday(i.due_date)} dias`}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}
      {receiving && <ReceiveModal customerId={receiving.id} customerName={receiving.name} installments={receiving.items.filter((i) => i.status === 'aberta')}
        onClose={() => setReceiving(null)} onDone={() => { setReceiving(null); reload(); }} />}
    </>
  );
}

function Analise() {
  const { data } = useLoad('credit.analysis', {}, []);
  const nav = useNavigate();
  if (!data) return <Loading />;
  const b = data.buckets;
  const max = Math.max(...Object.values(b), 1);
  const labels = { a_vencer: 'A vencer', ate_30: 'Até 30 dias', de_31_60: '31 a 60 dias', de_61_90: '61 a 90 dias', acima_90: 'Mais de 90 dias' };
  return (
    <>
      <div className="grid grid-4 mb">
        <Stat label="Total a receber" value={brl(data.totalOpen)} />
        <Stat label="Em atraso" value={brl(data.overdue)} foot={`${data.overdueRate}% da carteira`} />
        <Stat label="Vence em 30 dias" value={brl(data.next30)} />
        <Stat label="Recebido no mês" value={brl(data.receivedMonth)} />
      </div>
      <div className="grid grid-2">
        <div className="card">
          <div className="card-header"><h3>Idade da carteira (aging)</h3></div>
          <div className="card-body col">
            {Object.entries(b).map(([k, v]) => (
              <div key={k}>
                <div className="row between small"><span>{labels[k]}</span><b>{brl(v)}</b></div>
                <div className="progress mt-s"><div style={{ width: `${(v / max) * 100}%`, background: k === 'a_vencer' ? 'var(--success)' : k === 'ate_30' ? 'var(--warning)' : 'var(--danger)' }} /></div>
              </div>
            ))}
            <div className="small muted">Quanto mais tempo em atraso, menor a chance de receber. Priorize a cobrança das faixas até 60 dias.</div>
          </div>
        </div>
        <div className="card">
          <div className="card-header"><h3>Maiores devedores</h3></div>
          {!data.debtors.length ? <Empty>Nenhum cliente em atraso.</Empty> : (
            <table className="table table-compact">
              <thead><tr><th>Cliente</th><th className="num">Parcelas</th><th className="num">Dias</th><th className="num">Atrasado</th></tr></thead>
              <tbody>{data.debtors.slice(0, 15).map((d) => (
                <tr key={d.id} className="clickable" onClick={() => nav(`/clientes/${d.id}`)}>
                  <td className="strong">{d.name}</td><td className="num">{d.qty}</td>
                  <td className="num"><span className={`badge ${d.days > 60 ? 'badge-danger' : 'badge-warning'}`}>{d.days}</span></td><td className="num">{brl(d.overdue)}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}

export default function Crediario() {
  const [tab, setTab] = useState('parcelas');
  return (
    <>
      <PageHeader title="Crediário" sub="Parcelas, recebimentos e análise de inadimplência" />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'parcelas', label: 'Parcelas' }, { id: 'analise', label: 'Análise de inadimplência' }]} />
      {tab === 'parcelas' ? <Parcelas /> : <Analise />}
    </>
  );
}

export function ReprintReceipt({ group }) {
  const { settings } = useApp();
  const toast = useToast();
  return (
    <button className="btn btn-ghost btn-sm" title="Reimprimir recibo" onClick={async () => {
      try { await printHtml(installmentReceipt(await api('installments.receipt', { group }), settings), settings); } catch (e) { toast.error(e.message); }
    }}><Printer size={14} /></button>
  );
}
