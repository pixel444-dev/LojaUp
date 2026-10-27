import { useState } from 'react';
import { Search, Printer, Ban, RotateCcw, Receipt } from 'lucide-react';
import { api } from '../api';
import { useApp } from '../App';
import { Modal, Field, useLoad, useAction, PageHeader, Empty, Loading, Tabs, DateRange, StatusBadge, Segmented, useToast } from '../components/ui';
import { brl, date, dateTime, methodLabel, methodsLabel, today, addDays, r2 } from '../lib/format';
import { printHtml, saleReceipt, carne, voucherReceipt } from '../lib/print';

function ReturnModal({ sale, onClose, onDone }) {
  const { settings, reloadCash } = useApp();
  const toast = useToast();
  const [run, busy] = useAction();
  const [type, setType] = useState('troca');
  const [method, setMethod] = useState('vale');
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState(() => sale.items.map((i) => ({ id: i.id, qty: 0, back: true })));
  const total = r2(sale.items.reduce((a, it, k) => a + (it.total / it.quantity) * lines[k].qty, 0));
  const hasCrediario = sale.installments.some((i) => i.status === 'aberta');
  const daysSince = Math.floor((Date.now() - new Date(sale.created_at.replace(' ', 'T')).getTime()) / 86400000);
  const limitDays = Number(settings.return_days) || 0;

  async function confirm() {
    const r = await run(() => api('returns.create', {
      saleId: sale.id, type, refund_method: method, reason,
      items: lines.filter((l) => l.qty > 0).map((l) => ({ sale_item_id: l.id, quantity: l.qty, back_to_stock: l.back })),
    }), type === 'troca' ? 'Troca registrada!' : 'Devolução registrada!');
    reloadCash();
    if (r.voucher) {
      try { await printHtml(voucherReceipt(r.voucher, settings, { customer: sale.customer_name, saleId: sale.id }), settings); } catch (e) { toast.error(e.message); }
    }
    onDone(r);
  }

  return (
    <Modal title={`Troca / devolução — venda #${sale.id}`} onClose={onClose} size="lg"
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={busy || total <= 0} onClick={confirm}>Confirmar ({brl(total)})</button></>}>
      {limitDays > 0 && daysSince > limitDays && <div className="alert alert-warning mb">Esta venda tem {daysSince} dias — acima do prazo de troca de {limitDays} dias da loja.</div>}
      <div className="row mb wrap">
        <Segmented value={type} onChange={(t) => { setType(t); if (t === 'troca') setMethod('vale'); }} options={[{ value: 'troca', label: 'Troca' }, { value: 'devolucao', label: 'Devolução' }]} />
      </div>
      <table className="table table-compact">
        <thead><tr><th>Item</th><th className="num">Vendido</th><th className="num">Já devolvido</th><th className="num">Valor un.</th><th style={{ width: 110 }}>Devolver</th><th>Volta ao estoque?</th></tr></thead>
        <tbody>
          {sale.items.map((it, k) => {
            const avail = it.quantity - it.returned_qty;
            return (
              <tr key={it.id} className={avail <= 0 ? 'dim' : ''}>
                <td>{it.description}</td><td className="num">{it.quantity}</td><td className="num">{it.returned_qty}</td><td className="num">{brl(it.total / it.quantity)}</td>
                <td><input type="number" className="input" min={0} max={avail} disabled={avail <= 0} value={lines[k].qty}
                  onChange={(e) => setLines(lines.map((l, j) => (j === k ? { ...l, qty: Math.max(0, Math.min(avail, Number(e.target.value) || 0)) } : l)))} /></td>
                <td><label className="checkbox"><input type="checkbox" checked={lines[k].back} onChange={(e) => setLines(lines.map((l, j) => (j === k ? { ...l, back: e.target.checked } : l)))} />{lines[k].back ? 'Sim' : 'Não (defeito)'}</label></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="form-grid mt">
        <Field label="Como devolver o valor" className="c-6">
          <select className="select" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="vale">Gerar vale-troca (crédito na loja)</option>
            {type === 'devolucao' && <option value="dinheiro">Devolver em dinheiro (sai do caixa)</option>}
            {type === 'devolucao' && <option value="estorno">Estorno no cartão / Pix</option>}
            {hasCrediario && <option value="abater_crediario">Abater das parcelas do crediário</option>}
          </select>
        </Field>
        <Field label="Motivo" className="c-6"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: tamanho não serviu" /></Field>
      </div>
      {type === 'troca' && <div className="alert alert-info mt small">Na troca o sistema gera um vale-troca com o valor devolvido. Em seguida faça a nova venda no PDV e use o vale como forma de pagamento.</div>}
    </Modal>
  );
}

export function SaleDetailModal({ id, onClose, onChanged }) {
  const { settings, isAdmin, reloadCash } = useApp();
  const toast = useToast();
  const [run, busy] = useAction();
  const { data: sale, reload } = useLoad('sales.get', { id }, [id]);
  const [returning, setReturning] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [reason, setReason] = useState('');

  if (!sale) return null;
  async function cancel() {
    await run(() => api('sales.cancel', { id, reason }), 'Venda cancelada. Estoque devolvido.');
    setCanceling(false); reload(); onChanged?.(); reloadCash();
  }
  const print = async (html, opts) => { try { await printHtml(html, settings, opts); } catch (e) { toast.error(e.message); } };
  const canReturn = sale.status === 'concluida' && sale.items.some((i) => i.quantity > i.returned_qty);

  return (
    <Modal title={<>Venda #{sale.id} <StatusBadge status={sale.status} /></>} onClose={onClose} size="lg"
      footer={<>
        {isAdmin && sale.status === 'concluida' && !sale.returns.length && <button className="btn btn-ghost text-danger" onClick={() => setCanceling(true)}><Ban size={16} />Cancelar venda</button>}
        <div className="spacer" />
        {sale.installments.length > 0 && <button className="btn" onClick={() => print(carne(sale, settings), { thermal: false, dialog: true })}>Carnê</button>}
        <button className="btn" onClick={() => print(saleReceipt(sale, settings))}><Printer size={16} />Reimprimir cupom</button>
        {canReturn && <button className="btn btn-primary" onClick={() => setReturning(true)}><RotateCcw size={16} />Troca / devolução</button>}
      </>}>
      <div className="row wrap mb" style={{ gap: 24 }}>
        <div><div className="muted small">Data</div><div className="strong">{dateTime(sale.created_at)}</div></div>
        <div><div className="muted small">Cliente</div><div className="strong">{sale.customer_name || 'Consumidor'}</div></div>
        <div><div className="muted small">Vendedor</div><div className="strong">{sale.user_name}</div></div>
        <div><div className="muted small">Caixa</div><div className="strong">#{sale.cash_session_id}</div></div>
      </div>
      {sale.status === 'cancelada' && <div className="alert alert-danger mb">Cancelada em {dateTime(sale.canceled_at)} — {sale.cancel_reason}</div>}
      <table className="table table-compact">
        <thead><tr><th>Produto</th><th className="num">Qtd</th><th className="num">Preço</th><th className="num">Desconto</th><th className="num">Total</th>{isAdmin && <th className="num">Custo</th>}</tr></thead>
        <tbody>{sale.items.map((i) => (
          <tr key={i.id}>
            <td>{i.description}{i.returned_qty > 0 && <span className="badge badge-warning" style={{ marginLeft: 6 }}>{i.returned_qty} devolvido(s)</span>}<div className="small muted">{i.barcode}</div></td>
            <td className="num">{i.quantity}</td><td className="num">{brl(i.unit_price)}</td><td className="num">{i.discount ? brl(i.discount) : '—'}</td>
            <td className="num strong">{brl(i.total)}</td>{isAdmin && <td className="num muted">{brl(i.unit_cost * i.quantity)}</td>}
          </tr>
        ))}</tbody>
        <tfoot><tr><td colSpan={4}>Total {sale.discount > 0 && <span className="muted small">(descontos {brl(sale.discount)})</span>}</td><td className="num">{brl(sale.total)}</td>{isAdmin && <td className="num muted">{brl(sale.cost_total)}</td>}</tr></tfoot>
      </table>
      <div className="grid grid-2 mt">
        <div>
          <div className="strong mb" style={{ marginBottom: 6 }}>Pagamentos</div>
          {sale.payments.map((p) => <div key={p.id} className="row between small"><span>{methodLabel(p.method)}{p.installments > 1 ? ` ${p.installments}x` : ''}{p.voucher_code ? ` (${p.voucher_code})` : ''}</span><b>{brl(p.amount)}</b></div>)}
          {sale.change_amount > 0 && <div className="row between small muted"><span>Troco</span><span>{brl(sale.change_amount)}</span></div>}
        </div>
        {sale.installments.length > 0 && (
          <div>
            <div className="strong" style={{ marginBottom: 6 }}>Parcelas do crediário</div>
            {sale.installments.map((i) => <div key={i.id} className="row between small"><span>{i.number}/{i.total_numbers} — {date(i.due_date)}</span><span>{brl(i.amount)} <StatusBadge status={i.status} /></span></div>)}
          </div>
        )}
      </div>
      {sale.returns.length > 0 && (
        <div className="mt">
          <div className="strong" style={{ marginBottom: 6 }}>Trocas e devoluções</div>
          {sale.returns.map((r) => (
            <div key={r.id} className="alert alert-info small mt-s">
              <div>{dateTime(r.created_at)} — <b>{r.type === 'troca' ? 'Troca' : 'Devolução'}</b> de {brl(r.total)} ({methodLabel(r.refund_method)}){r.voucher_code ? ` — vale ${r.voucher_code}` : ''}. {r.reason}
                <div>{r.items.map((i) => `${i.description} x${i.quantity}`).join(', ')}</div></div>
            </div>
          ))}
        </div>
      )}
      {canceling && (
        <Modal title="Cancelar venda" onClose={() => setCanceling(false)} size="sm"
          footer={<><button className="btn" onClick={() => setCanceling(false)}>Voltar</button><button className="btn btn-danger" disabled={!reason || busy} onClick={cancel}>Cancelar venda</button></>}>
          <div className="col">
            <div>Os produtos voltam ao estoque, parcelas do crediário são canceladas e vales usados recebem o saldo de volta.</div>
            <Field label="Motivo do cancelamento *"><input className="input" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          </div>
        </Modal>
      )}
      {returning && <ReturnModal sale={sale} onClose={() => setReturning(false)} onDone={() => { setReturning(false); reload(); onChanged?.(); }} />}
    </Modal>
  );
}

function SalesList() {
  const [range, setRange] = useState({ from: addDays(today(), -30), to: today() });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState(null);
  const { data, loading, reload } = useLoad('sales.list', { ...range, search, status }, [range, search, status]);
  const valid = (data || []).filter((s) => s.status === 'concluida');
  const total = valid.reduce((a, s) => a + s.total, 0);
  return (
    <>
      <div className="row mb wrap">
        <DateRange {...range} onChange={setRange} />
        <div className="input-group" style={{ width: 280 }}><Search size={16} className="icon" /><input className="input" placeholder="Nº da venda, cliente ou produto" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <Segmented value={status} onChange={setStatus} options={[{ value: '', label: 'Todas' }, { value: 'concluida', label: 'Concluídas' }, { value: 'cancelada', label: 'Canceladas' }]} />
        <div className="spacer" />
        <div className="muted">{valid.length} venda(s) · <b>{brl(total)}</b></div>
      </div>
      <div className="card">
        {loading && !data ? <Loading /> : !data?.length ? <Empty icon={<Receipt size={34} />}>Nenhuma venda no período.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Nº</th><th>Data</th><th>Cliente</th><th>Vendedor</th><th>Pagamento</th><th className="num">Peças</th><th className="num">Desconto</th><th className="num">Total</th><th>Situação</th></tr></thead>
              <tbody>{data.map((s) => (
                <tr key={s.id} className={`clickable ${s.status === 'cancelada' ? 'dim' : ''}`} onClick={() => setOpen(s.id)}>
                  <td className="strong">#{s.id}</td><td>{dateTime(s.created_at)}</td><td>{s.customer_name || <span className="muted">Consumidor</span>}</td><td>{s.user_name}</td>
                  <td className="small">{methodsLabel(s.methods)}</td><td className="num">{s.pieces}</td><td className="num">{s.discount ? brl(s.discount) : '—'}</td>
                  <td className="num strong">{brl(s.total)}</td>
                  <td><StatusBadge status={s.status} />{s.returned_total > 0 && <span className="badge badge-warning" style={{ marginLeft: 4 }}>troca {brl(s.returned_total)}</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
      {open && <SaleDetailModal id={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </>
  );
}

function ReturnsList() {
  const [range, setRange] = useState({ from: addDays(today(), -60), to: today() });
  const { data, loading } = useLoad('returns.list', range, [range]);
  return (
    <>
      <div className="row mb"><DateRange {...range} onChange={setRange} /></div>
      <div className="card">
        {loading && !data ? <Loading /> : !data?.length ? <Empty>Nenhuma troca ou devolução no período.</Empty> : (
          <table className="table">
            <thead><tr><th>Data</th><th>Tipo</th><th>Venda</th><th>Cliente</th><th>Itens</th><th>Reembolso</th><th>Motivo</th><th className="num">Valor</th></tr></thead>
            <tbody>{data.map((r) => (
              <tr key={r.id}>
                <td>{dateTime(r.created_at)}</td><td><span className={`badge ${r.type === 'troca' ? 'badge-info' : 'badge-warning'}`}>{r.type === 'troca' ? 'Troca' : 'Devolução'}</span></td>
                <td>#{r.sale_id}</td><td>{r.customer_name || '—'}</td><td className="small">{r.items_desc}</td>
                <td className="small">{methodLabel(r.refund_method)}{r.voucher_code ? ` ${r.voucher_code}` : ''}</td><td className="small">{r.reason}</td><td className="num strong">{brl(r.total)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </>
  );
}

function VouchersList() {
  const { settings } = useApp();
  const { data, loading } = useLoad('vouchers.list', {}, []);
  return (
    <div className="card">
      {loading && !data ? <Loading /> : !data?.length ? <Empty>Nenhum vale-troca emitido.</Empty> : (
        <table className="table">
          <thead><tr><th>Código</th><th>Cliente</th><th>Emissão</th><th className="num">Valor</th><th className="num">Saldo</th><th /></tr></thead>
          <tbody>{data.map((v) => (
            <tr key={v.id} className={v.balance <= 0 ? 'dim' : ''}>
              <td className="mono strong">{v.code}</td><td>{v.customer_name || 'Ao portador'}</td><td>{date(v.created_at)}</td>
              <td className="num">{brl(v.amount)}</td><td className="num strong">{brl(v.balance)}</td>
              <td className="actions-cell">{v.balance > 0 && <button className="btn btn-ghost btn-sm" onClick={() => printHtml(voucherReceipt({ code: v.code, amount: v.balance }, settings, { customer: v.customer_name }), settings)}><Printer size={14} /></button>}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}

export default function Vendas() {
  const [tab, setTab] = useState('vendas');
  return (
    <>
      <PageHeader title="Vendas e trocas" sub="Histórico de vendas, cancelamentos, trocas, devoluções e vales" />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'vendas', label: 'Vendas' }, { id: 'trocas', label: 'Trocas e devoluções' }, { id: 'vales', label: 'Vales-troca' }]} />
      {tab === 'vendas' && <SalesList />}
      {tab === 'trocas' && <ReturnsList />}
      {tab === 'vales' && <VouchersList />}
    </>
  );
}
