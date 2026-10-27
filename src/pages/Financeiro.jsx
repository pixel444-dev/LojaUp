import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Check, Trash2, Undo2 } from 'lucide-react';
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { api } from '../api';
import { Modal, Field, MoneyInput, useLoad, useAction, useConfirm, PageHeader, Empty, Loading, Tabs, Segmented, Stat, DateRange, StatusBadge } from '../components/ui';
import { brl, date, today, addDays, monthStart, monthEnd, r2, methodLabel, pct, daysFromToday } from '../lib/format';

function PayableForm({ onClose, onSaved }) {
  const { data: categories } = useLoad('payables.categories', {}, []);
  const { data: suppliers } = useLoad('suppliers.list', {}, []);
  const [p, setP] = useState({ description: '', category: '', expense_type: 'fixa', amount: '', due_date: today(), repeat: 1, supplier_id: '', notes: '' });
  const [run, busy] = useAction();
  const set = (k) => (e) => setP({ ...p, [k]: e && e.target ? e.target.value : e });
  return (
    <Modal title="Nova conta a pagar / despesa" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={busy} onClick={async () => { await run(() => api('payables.save', { ...p, amount: r2(p.amount) }), 'Conta registrada!'); onSaved(); }}>Salvar</button></>}>
      <div className="form-grid">
        <Field label="Descrição *" className="c-12"><input className="input" autoFocus value={p.description} onChange={set('description')} placeholder="Ex.: Aluguel da loja" /></Field>
        <Field label="Categoria" className="c-6">
          <input className="input" list="cats" value={p.category} onChange={set('category')} />
          <datalist id="cats">{(categories || []).map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <Field label="Tipo de despesa" className="c-6">
          <Segmented value={p.expense_type} onChange={set('expense_type')} options={[{ value: 'fixa', label: 'Fixa' }, { value: 'variavel', label: 'Variável' }]} />
        </Field>
        <Field label="Valor *" className="c-4"><MoneyInput value={p.amount} onChange={set('amount')} /></Field>
        <Field label="Vencimento *" className="c-4"><input type="date" className="input" value={p.due_date} onChange={set('due_date')} /></Field>
        <Field label="Repetir por (meses)" className="c-4" hint="Ex.: 12 para aluguel do ano"><input type="number" className="input" min={1} max={36} value={p.repeat} onChange={set('repeat')} /></Field>
        <Field label="Fornecedor (opcional)" className="c-6">
          <select className="select" value={p.supplier_id} onChange={set('supplier_id')}><option value="">—</option>{(suppliers || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        </Field>
        <Field label="Observações" className="c-6"><input className="input" value={p.notes} onChange={set('notes')} /></Field>
      </div>
      <div className="small muted mt">Despesas <b>fixas</b> acontecem todo mês (aluguel, salários, internet). <b>Variáveis</b> mudam conforme as vendas (comissões, embalagens, taxas).</div>
    </Modal>
  );
}

function PayModal({ item, kind, onClose, onDone }) {
  const [amount, setAmount] = useState(item.amount);
  const [method, setMethod] = useState('pix');
  const [day, setDay] = useState(today());
  const [run, busy] = useAction();
  return (
    <Modal title={kind === 'pagar' ? 'Registrar pagamento' : 'Registrar recebimento'} onClose={onClose} size="sm"
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-success" disabled={busy} onClick={async () => {
        await run(() => api(kind === 'pagar' ? 'payables.pay' : 'receivables.receive', { id: item.id, amount: r2(amount), method, date: day }), 'Registrado!');
        onDone();
      }}>Confirmar</button></>}>
      <div className="col">
        <div className="strong">{item.description} {item.installment_label}</div>
        <Field label="Valor pago (com juros/desconto)"><MoneyInput value={amount} onChange={setAmount} /></Field>
        <Field label="Forma"><select className="select" value={method} onChange={(e) => setMethod(e.target.value)}>{['pix', 'dinheiro', 'debito', 'credito'].map((m) => <option key={m} value={m}>{methodLabel(m)}</option>)}<option value="boleto">Boleto</option><option value="transferencia">Transferência</option></select></Field>
        {kind === 'pagar' && <Field label="Data do pagamento"><input type="date" className="input" value={day} onChange={(e) => setDay(e.target.value)} /></Field>}
      </div>
    </Modal>
  );
}

function Payables() {
  const [status, setStatus] = useState('aberta');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [paying, setPaying] = useState(null);
  const confirm = useConfirm();
  const [run] = useAction();
  const { data, loading, reload } = useLoad('payables.list', { status, search }, [status, search]);
  const total = (data || []).filter((p) => p.status === 'aberta').reduce((a, p) => a + p.amount, 0);
  return (
    <>
      <div className="row mb wrap">
        <Segmented value={status} onChange={setStatus} options={[{ value: 'aberta', label: 'Em aberto' }, { value: 'vencida', label: 'Vencidas' }, { value: 'paga', label: 'Pagas' }, { value: '', label: 'Todas' }]} />
        <input className="input" style={{ width: 240 }} placeholder="Buscar descrição ou categoria" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="spacer" />
        {status !== 'paga' && <span className="muted">Em aberto: <b>{brl(total)}</b></span>}
        <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={16} />Nova despesa</button>
      </div>
      <div className="card">
        {loading && !data ? <Loading /> : !data?.length ? <Empty>Nenhuma conta encontrada.</Empty> : (
          <table className="table">
            <thead><tr><th>Vencimento</th><th>Descrição</th><th>Categoria</th><th>Tipo</th><th>Fornecedor</th><th className="num">Valor</th><th>Situação</th><th /></tr></thead>
            <tbody>{data.map((p) => {
              const d = daysFromToday(p.due_date);
              return (
                <tr key={p.id} className={p.status === 'paga' ? 'dim' : ''}>
                  <td className="nowrap">{date(p.due_date)}</td>
                  <td className="strong">{p.description} {p.installment_label && <span className="muted small">({p.installment_label})</span>}</td>
                  <td>{p.category}</td><td><span className="badge">{p.expense_type === 'fixa' ? 'Fixa' : 'Variável'}</span></td><td className="small">{p.supplier_name}</td>
                  <td className="num strong">{brl(p.status === 'paga' ? p.paid_amount : p.amount)}</td>
                  <td>{p.status === 'paga' ? <span className="badge badge-success">Paga {date(p.paid_at)}</span> : d < 0 ? <span className="badge badge-danger">Vencida há {-d} dias</span> : d === 0 ? <span className="badge badge-warning">Vence hoje</span> : <span className="badge">em {d} dias</span>}</td>
                  <td className="actions-cell">
                    {p.status === 'aberta' ? <button className="btn btn-sm btn-success" onClick={() => setPaying(p)}><Check size={14} />Pagar</button>
                      : <button className="btn btn-ghost btn-icon" title="Estornar pagamento" onClick={async () => { if (await confirm('Desfazer o pagamento desta conta?')) { await run(() => api('payables.reopen', { id: p.id })); reload(); } }}><Undo2 size={15} /></button>}
                    {!p.purchase_id && <button className="btn btn-ghost btn-icon" onClick={async () => { if (await confirm({ message: 'Excluir esta conta?', danger: true })) { await run(() => api('payables.delete', { id: p.id })); reload(); } }}><Trash2 size={15} /></button>}
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </div>
      {creating && <PayableForm onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reload(); }} />}
      {paying && <PayModal item={paying} kind="pagar" onClose={() => setPaying(null)} onDone={() => { setPaying(null); reload(); }} />}
    </>
  );
}

function Receivables() {
  const [status, setStatus] = useState('aberta');
  const [creating, setCreating] = useState(false);
  const [paying, setPaying] = useState(null);
  const [form, setForm] = useState({ description: '', amount: '', due_date: today(), category: '' });
  const [run, busy] = useAction();
  const confirm = useConfirm();
  const { data, loading, reload } = useLoad('receivables.list', { status }, [status]);
  const { data: credit } = useLoad('credit.analysis', {}, []);
  return (
    <>
      {credit && (
        <div className="alert alert-info mb">
          <div>Crediário: <b>{brl(credit.totalOpen)}</b> a receber ({brl(credit.overdue)} em atraso). As parcelas de crediário são gerenciadas em <Link to="/crediario">Crediário</Link>. Aqui ficam outros valores a receber (ex.: aluguel de espaço, acordos, repasses).</div>
        </div>
      )}
      <div className="row mb">
        <Segmented value={status} onChange={setStatus} options={[{ value: 'aberta', label: 'Em aberto' }, { value: 'paga', label: 'Recebidas' }, { value: '', label: 'Todas' }]} />
        <div className="spacer" /><button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={16} />Nova conta a receber</button>
      </div>
      <div className="card">
        {loading && !data ? <Loading /> : !data?.length ? <Empty>Nenhuma conta a receber.</Empty> : (
          <table className="table">
            <thead><tr><th>Vencimento</th><th>Descrição</th><th>Categoria</th><th className="num">Valor</th><th>Situação</th><th /></tr></thead>
            <tbody>{data.map((r) => (
              <tr key={r.id} className={r.status === 'paga' ? 'dim' : ''}>
                <td>{date(r.due_date)}</td><td className="strong">{r.description}</td><td>{r.category}</td><td className="num strong">{brl(r.status === 'paga' ? r.received_amount : r.amount)}</td>
                <td><StatusBadge status={r.status === 'aberta' && r.due_date < today() ? 'vencida' : r.status} /></td>
                <td className="actions-cell">
                  {r.status === 'aberta' && <button className="btn btn-sm btn-success" onClick={() => setPaying(r)}>Receber</button>}
                  <button className="btn btn-ghost btn-icon" onClick={async () => { if (await confirm({ message: 'Excluir?', danger: true })) { await api('receivables.delete', { id: r.id }); reload(); } }}><Trash2 size={15} /></button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      {creating && (
        <Modal title="Nova conta a receber" onClose={() => setCreating(false)} size="sm"
          footer={<><button className="btn" onClick={() => setCreating(false)}>Cancelar</button><button className="btn btn-primary" disabled={busy} onClick={async () => { await run(() => api('receivables.save', { ...form, amount: r2(form.amount) }), 'Registrado!'); setCreating(false); reload(); }}>Salvar</button></>}>
          <div className="col">
            <Field label="Descrição"><input className="input" autoFocus value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <Field label="Categoria"><input className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></Field>
            <Field label="Valor"><MoneyInput value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} /></Field>
            <Field label="Vencimento"><input type="date" className="input" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
      {paying && <PayModal item={paying} kind="receber" onClose={() => setPaying(null)} onDone={() => { setPaying(null); reload(); }} />}
    </>
  );
}

function Cashflow() {
  const [range, setRange] = useState({ from: addDays(today(), -15), to: addDays(today(), 30) });
  const { data } = useLoad('finance.cashflow', range, [range]);
  const [open, setOpen] = useState(null);
  if (!data) return <Loading />;
  const t = data.totals;
  const chart = data.rows.map((r) => ({ dia: date(r.date).slice(0, 5), Entradas: r2(r.in + r.in_forecast), Saídas: -r2(r.out + r.out_forecast), Saldo: r.balance, previsto: r.date >= today() }));
  return (
    <>
      <div className="row mb"><DateRange {...range} onChange={setRange} /><span className="small muted">Realizado até hoje + previsto (parcelas de crediário e contas a pagar) a partir de hoje.</span></div>
      <div className="grid grid-5 mb">
        <Stat label="Entradas realizadas" value={brl(t.in)} />
        <Stat label="Saídas realizadas" value={brl(t.out)} />
        <Stat label="Entradas previstas" value={brl(t.in_forecast)} />
        <Stat label="Saídas previstas" value={brl(t.out_forecast)} />
        <Stat label="Saldo do período" value={<span className={t.projected < 0 ? 'text-danger' : 'text-success'}>{brl(t.projected)}</span>} foot="realizado + previsto" />
      </div>
      {t.projected < 0 && <div className="alert alert-danger mb">Atenção: as saídas previstas superam as entradas no período. Planeje vendas, cobre o crediário ou renegocie vencimentos.</div>}
      <div className="card mb">
        <div className="card-body" style={{ height: 290 }}>
          <ResponsiveContainer>
            <ComposedChart data={chart}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eceef2" />
              <XAxis dataKey="dia" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}k` : v)} />
              <Tooltip formatter={(v) => brl(Math.abs(v))} />
              <Legend />
              <Bar dataKey="Entradas" fill="#16a34a" radius={[3, 3, 0, 0]} />
              <Bar dataKey="Saídas" fill="#dc2626" radius={[0, 0, 3, 3]} />
              <Line dataKey="Saldo" stroke="#4f46e5" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="card">
        <table className="table table-compact">
          <thead><tr><th>Data</th><th className="num">Entradas</th><th className="num">Saídas</th><th className="num">Entradas previstas</th><th className="num">Saídas previstas</th><th className="num">Saldo acumulado</th></tr></thead>
          <tbody>{data.rows.map((r) => (
            <tr key={r.date} className="clickable" onClick={() => setOpen(r)}>
              <td className={r.date === today() ? 'strong' : ''}>{date(r.date)}{r.date === today() && ' (hoje)'}</td>
              <td className="num text-success">{r.in ? brl(r.in) : '—'}</td><td className="num text-danger">{r.out ? brl(r.out) : '—'}</td>
              <td className="num muted">{r.in_forecast ? brl(r.in_forecast) : '—'}</td><td className="num muted">{r.out_forecast ? brl(r.out_forecast) : '—'}</td>
              <td className={`num strong ${r.balance < 0 ? 'text-danger' : ''}`}>{brl(r.balance)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {open && (
        <Modal title={`Movimentos de ${date(open.date)}`} onClose={() => setOpen(null)} size="sm">
          {open.details.map((d, i) => <div key={i} className="row between" style={{ padding: '4px 0' }}><span>{d.label}{d.field.includes('forecast') ? ' (previsto)' : ''}</span><b className={d.field.startsWith('in') ? 'text-success' : 'text-danger'}>{brl(d.value)}</b></div>)}
        </Modal>
      )}
    </>
  );
}

function Resumo() {
  const [range, setRange] = useState({ from: monthStart(), to: monthEnd() });
  const { data: d } = useLoad('finance.dre', range, [range]);
  const { data: s } = useLoad('finance.summary', {}, []);
  return (
    <>
      {s && (
        <div className="grid grid-4 mb">
          <Stat label="Contas vencidas" value={<span className={s.payables_overdue ? 'text-danger' : ''}>{brl(s.payables_overdue)}</span>} foot={`Hoje: ${brl(s.payables_today)}`} />
          <Stat label="A pagar em 7 dias" value={brl(s.payables_7d)} foot={`Total em aberto ${brl(s.payables_open)}`} />
          <Stat label="A receber em 7 dias" value={brl(s.receivables_7d)} foot={`Total a receber ${brl(s.receivables_open)}`} />
          <Stat label="Recebíveis atrasados" value={<span className={s.receivables_overdue ? 'text-danger' : ''}>{brl(s.receivables_overdue)}</span>} />
        </div>
      )}
      <div className="row mb"><DateRange {...range} onChange={setRange} /></div>
      {!d ? <Loading /> : (
        <div className="grid grid-2">
          <div className="card">
            <div className="card-header"><h3>Resultado do período (DRE simplificado)</h3></div>
            <div className="card-body">
              <dl className="kv" style={{ fontSize: 14.5, gap: '9px 16px' }}>
                <dt>Vendas brutas ({d.sales_count})</dt><dd>{brl(d.gross_revenue)}</dd>
                <dt>(−) Descontos concedidos</dt><dd className="text-danger">{brl(d.discounts)}</dd>
                <dt>(−) Devoluções</dt><dd className="text-danger">{brl(d.returns)}</dd>
                <dt className="strong">= Receita líquida</dt><dd className="strong">{brl(d.net_revenue)}</dd>
                <dt>(−) Custo das mercadorias vendidas</dt><dd className="text-danger">{brl(d.cmv)}</dd>
                <dt className="strong">= Lucro bruto <span className="badge">{pct(d.gross_margin)}</span></dt><dd className="strong">{brl(d.gross_profit)}</dd>
                <dt>(+) Juros recebidos do crediário</dt><dd className="text-success">{brl(d.interest_income)}</dd>
                <dt>(−) Despesas fixas</dt><dd className="text-danger">{brl(d.fixed_expenses)}</dd>
                <dt>(−) Despesas variáveis</dt><dd className="text-danger">{brl(d.variable_expenses)}</dd>
                <dt className="strong" style={{ fontSize: 16 }}>= Lucro líquido <span className="badge">{pct(d.net_margin)}</span></dt>
                <dd className={`strong ${d.net_profit < 0 ? 'text-danger' : 'text-success'}`} style={{ fontSize: 18 }}>{brl(d.net_profit)}</dd>
              </dl>
              <div className="small muted mt">Despesas consideradas pela data de vencimento. Compras de mercadoria entram como custo quando a peça é vendida (CMV).</div>
            </div>
          </div>
          <div className="card">
            <div className="card-header"><h3>Despesas por categoria</h3></div>
            {!d.expenses.length ? <Empty>Nenhuma despesa lançada no período. Cadastre aluguel, salários e demais custos em “Contas a pagar”.</Empty> : (
              <table className="table table-compact">
                <thead><tr><th>Categoria</th><th>Tipo</th><th className="num">Valor</th><th className="num">% da receita</th></tr></thead>
                <tbody>{d.expenses.map((e, i) => (
                  <tr key={i}><td>{e.category}</td><td><span className="badge">{e.expense_type === 'fixa' ? 'Fixa' : 'Variável'}</span></td><td className="num">{brl(e.v)}</td><td className="num">{d.net_revenue ? pct(((e.v / d.net_revenue) * 100).toFixed(1)) : '—'}</td></tr>
                ))}</tbody>
              </table>
            )}
            {d.fixed_expenses > 0 && d.gross_margin > 0 && (
              <div className="card-body small" style={{ borderTop: '1px solid var(--border)' }}>
                <b>Ponto de equilíbrio:</b> com margem bruta de {pct(d.gross_margin)}, a loja precisa vender <b>{brl(d.fixed_expenses / (d.gross_margin / 100))}</b> no período para cobrir as despesas fixas.
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export default function Financeiro() {
  const [tab, setTab] = useState('resumo');
  return (
    <>
      <PageHeader title="Financeiro" sub="Resultado, contas a pagar e a receber e fluxo de caixa" />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'resumo', label: 'Resumo e resultado' }, { id: 'pagar', label: 'Contas a pagar' }, { id: 'receber', label: 'Contas a receber' }, { id: 'fluxo', label: 'Fluxo de caixa' }]} />
      {tab === 'resumo' && <Resumo />}
      {tab === 'pagar' && <Payables />}
      {tab === 'receber' && <Receivables />}
      {tab === 'fluxo' && <Cashflow />}
    </>
  );
}
