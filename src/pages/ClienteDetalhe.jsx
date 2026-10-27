import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, MessageCircle, CreditCard, Trash2, Gift } from 'lucide-react';
import { api } from '../api';
import { useApp } from '../App';
import { useLoad, useAction, useConfirm, PageHeader, Loading, Tabs, Empty, Stat, StatusBadge } from '../components/ui';
import { brl, date, dateTime, formatCpf, formatPhone, methodLabel, methodsLabel, whatsappLink } from '../lib/format';
import { CustomerForm } from './Clientes';
import { ReceiveModal, ReprintReceipt } from './Crediario';
import { SaleDetailModal } from './Vendas';

const RATING = {
  otimo: ['badge-success', 'Ótimo pagador'], bom: ['badge-success', 'Bom pagador'], novo: ['badge-info', 'Sem histórico'],
  atencao: ['badge-warning', 'Atenção'], inadimplente: ['badge-danger', 'Inadimplente'],
};

export default function ClienteDetalhe() {
  const { id } = useParams();
  const nav = useNavigate();
  const { isAdmin } = useApp();
  const confirm = useConfirm();
  const [run] = useAction();
  const [tab, setTab] = useState('parcelas');
  const [editing, setEditing] = useState(false);
  const [receiving, setReceiving] = useState(null);
  const [saleId, setSaleId] = useState(null);
  const { data: c, reload } = useLoad('customers.get', { id: Number(id) }, [id]);
  if (!c) return <Loading />;
  const cr = c.credit;
  const open = c.installments.filter((i) => i.status === 'aberta');
  const [ratingClass, ratingLabel] = RATING[cr.rating];
  const usage = cr.limit ? Math.min(100, (cr.balance / cr.limit) * 100) : 0;

  async function remove() {
    if (!(await confirm({ message: `Excluir o cliente ${c.name}? O histórico de vendas será mantido.`, danger: true, confirmText: 'Excluir' }))) return;
    await run(() => api('customers.delete', { id: c.id }), 'Cliente removido.');
    nav('/clientes');
  }

  return (
    <>
      <button className="btn btn-ghost btn-sm mb" onClick={() => nav(-1)}><ArrowLeft size={15} />Voltar</button>
      <PageHeader title={c.name} sub={[formatCpf(c.cpf), formatPhone(c.phone), c.email, c.city].filter(Boolean).join(' · ') || 'Sem contato cadastrado'}>
        {c.phone && <a className="btn" href={whatsappLink(c.phone, `Olá ${c.name.split(' ')[0]}!`)} target="_blank" rel="noreferrer"><MessageCircle size={16} />WhatsApp</a>}
        {open.length > 0 && <button className="btn btn-success" onClick={() => setReceiving(open)}><CreditCard size={16} />Receber parcelas</button>}
        <button className="btn" onClick={() => setEditing(true)}><Pencil size={16} />Editar</button>
        {isAdmin && <button className="btn btn-ghost" onClick={remove}><Trash2 size={16} /></button>}
      </PageHeader>

      <div className="grid grid-4 mb">
        <Stat label="Total comprado" value={brl(c.stats.total)} foot={`${c.stats.qty} compra(s)`} />
        <Stat label="Ticket médio" value={brl(c.stats.ticket)} foot={c.stats.last ? `Última compra ${date(c.stats.last)}` : 'Nunca comprou'} />
        <div className="card stat">
          <div className="stat-label">Crediário <span className={`badge ${ratingClass}`}>{ratingLabel}</span></div>
          <div className="stat-value">{brl(cr.balance)}</div>
          <div className="progress mt-s"><div style={{ width: `${usage}%`, background: usage > 90 ? 'var(--danger)' : 'var(--primary)' }} /></div>
          <div className="stat-foot">Disponível {brl(cr.available)} de {brl(cr.limit)}</div>
        </div>
        <div className="card stat">
          <div className="stat-label">Pontualidade</div>
          <div className="stat-value">{cr.onTimeRate == null ? '—' : `${cr.onTimeRate}%`}</div>
          <div className="stat-foot">{cr.paidCount} parcela(s) pagas · {cr.lateCount} com atraso{cr.avgDelay ? ` (média ${cr.avgDelay} dias)` : ''}</div>
          {cr.overdueCount > 0 && <div className="stat-foot text-danger strong">{brl(cr.overdueAmount)} vencido há {cr.maxDaysLate} dias</div>}
        </div>
      </div>

      {(c.favorites.length > 0 || c.notes || c.vouchers.length > 0) && (
        <div className="card card-body mb row wrap" style={{ gap: 18 }}>
          {c.favorites.length > 0 && <div><span className="muted small">Costuma comprar: </span>{c.favorites.map((f, i) => <span key={i} className="badge" style={{ marginRight: 4 }}>{f.category || 'Outros'} {f.size ? `tam. ${f.size}` : ''} ({f.qty})</span>)}</div>}
          {c.notes && <div><span className="muted small">Obs.: </span>{c.notes}</div>}
          {c.vouchers.length > 0 && <div><Gift size={14} /> Vales: {c.vouchers.map((v) => <span key={v.id} className="badge badge-primary" style={{ marginRight: 4 }}>{v.code} — {brl(v.balance)}</span>)}</div>}
        </div>
      )}

      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'parcelas', label: `Parcelas (${open.length} em aberto)` }, { id: 'compras', label: `Compras (${c.sales.length})` }, { id: 'pagamentos', label: 'Pagamentos e recibos' },
      ]} />

      <div className="card">
        {tab === 'parcelas' && (!c.installments.length ? <Empty>Nenhuma compra no crediário.</Empty> : (
          <table className="table">
            <thead><tr><th>Venda</th><th>Parcela</th><th>Vencimento</th><th className="num">Valor</th><th className="num">Pago</th><th className="num">Saldo c/ juros</th><th>Situação</th><th /></tr></thead>
            <tbody>{c.installments.map((i) => (
              <tr key={i.id} className={i.status === 'paga' ? 'dim' : ''}>
                <td><a onClick={() => setSaleId(i.sale_id)} style={{ cursor: 'pointer' }}>#{i.sale_id}</a></td>
                <td>{i.number}/{i.total_numbers}</td><td>{date(i.due_date)}</td>
                <td className="num">{brl(i.amount)}</td><td className="num">{brl(i.paid_amount)}</td>
                <td className="num">{i.charges ? brl(i.charges.total) : '—'}</td>
                <td>{i.status === 'paga' ? <span className="badge badge-success">Paga em {date(i.paid_at)}</span> : i.charges.days > 0 ? <span className="badge badge-danger">{i.charges.days} dias de atraso</span> : <span className="badge badge-warning">Em aberto</span>}</td>
                <td className="actions-cell">{i.status === 'aberta' && <button className="btn btn-sm" onClick={() => setReceiving([i])}>Receber</button>}</td>
              </tr>
            ))}</tbody>
          </table>
        ))}
        {tab === 'compras' && (!c.sales.length ? <Empty>Nenhuma compra registrada.</Empty> : (
          <table className="table">
            <thead><tr><th>Venda</th><th>Data</th><th>Itens</th><th>Pagamento</th><th className="num">Total</th><th>Situação</th></tr></thead>
            <tbody>{c.sales.map((s) => (
              <tr key={s.id} className="clickable" onClick={() => setSaleId(s.id)}>
                <td>#{s.id}</td><td>{dateTime(s.created_at)}</td><td className="small" style={{ maxWidth: 420 }}>{s.items_desc}</td>
                <td className="small">{methodsLabel(s.methods)}</td><td className="num strong">{brl(s.total)}</td><td><StatusBadge status={s.status} /></td>
              </tr>
            ))}</tbody>
          </table>
        ))}
        {tab === 'pagamentos' && (!c.payments.length ? <Empty>Nenhum pagamento de crediário.</Empty> : (
          <table className="table">
            <thead><tr><th>Data</th><th>Parcela</th><th>Venda</th><th>Forma</th><th className="num">Valor</th><th className="num">Juros/multa</th><th>Recebido por</th><th /></tr></thead>
            <tbody>{c.payments.map((p) => (
              <tr key={p.id}>
                <td>{dateTime(p.created_at)}</td><td>{p.number}/{p.total_numbers}</td><td>#{p.sale_id}</td><td>{methodLabel(p.method)}</td>
                <td className="num">{brl(p.amount)}</td><td className="num">{p.interest ? brl(p.interest) : '—'}</td><td>{p.user_name}</td>
                <td className="actions-cell">{p.receipt_group && <ReprintReceipt group={p.receipt_group} />}</td>
              </tr>
            ))}</tbody>
          </table>
        ))}
      </div>

      {editing && <CustomerForm initial={c} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
      {receiving && <ReceiveModal customerId={c.id} customerName={c.name} installments={receiving} onClose={() => setReceiving(null)} onDone={() => { setReceiving(null); reload(); }} />}
      {saleId && <SaleDetailModal id={saleId} onClose={() => setSaleId(null)} onChanged={reload} />}
    </>
  );
}
