import { useState } from 'react';
import { Plus, Trash2, Truck, PackagePlus } from 'lucide-react';
import { api } from '../api';
import { Modal, Field, MoneyInput, useLoad, useAction, useConfirm, PageHeader, Empty, Loading, DateRange, StatusBadge, Segmented } from '../components/ui';
import VariantSearch from '../components/VariantSearch';
import { brl, date, today, addDays, r2, methodLabel } from '../lib/format';
import { ProductForm } from './Produtos';

function PurchaseForm({ onClose, onSaved }) {
  const { data: suppliers } = useLoad('suppliers.list', {}, []);
  const [run, busy] = useAction();
  const [newProduct, setNewProduct] = useState(false);
  const [f, setF] = useState({ supplier_id: '', invoice_number: '', purchase_date: today(), freight: 0, other_costs: 0, discount: 0, notes: '' });
  const [items, setItems] = useState([]);
  const [pay, setPay] = useState({ mode: 'prazo', method: 'pix', installments: 1, first_due: addDays(today(), 30), interval_days: 30 });
  const [prices, setPrices] = useState({});
  const set = (k) => (e) => setF({ ...f, [k]: e && e.target ? e.target.value : e });

  async function add(v) {
    const last = await api('purchases.lastCost', { variantId: v.id });
    setItems((prev) => {
      if (prev.some((i) => i.variant_id === v.id)) return prev.map((i) => (i.variant_id === v.id ? { ...i, quantity: i.quantity + 1 } : i));
      return [...prev, { variant_id: v.id, product_id: v.product_id, label: v.label, quantity: 1, unit_cost: last?.unit_cost ?? v.cost ?? 0, last, sale_price: v.price, stock: v.stock }];
    });
  }
  const upd = (k, patch) => setItems(items.map((i, j) => (j === k ? { ...i, ...patch } : i)));

  const productsTotal = r2(items.reduce((a, i) => a + r2(i.unit_cost) * (Number(i.quantity) || 0), 0));
  const extra = r2(r2(f.freight) + r2(f.other_costs) - r2(f.discount));
  const total = r2(productsTotal + extra);
  const landed = (i) => (productsTotal > 0 ? r2(i.unit_cost + ((i.unit_cost * i.quantity) / productsTotal) * extra / i.quantity) : i.unit_cost);
  const productIds = [...new Set(items.map((i) => i.product_id))];

  async function save() {
    const id = await run(() => api('purchases.create', {
      ...f, supplier_id: f.supplier_id || null, freight: r2(f.freight), other_costs: r2(f.other_costs), discount: r2(f.discount),
      items: items.map((i) => ({ variant_id: i.variant_id, quantity: Number(i.quantity), unit_cost: r2(i.unit_cost) })),
      payment: pay,
      price_updates: Object.entries(prices).filter(([, v]) => v > 0).map(([product_id, sale_price]) => ({ product_id: Number(product_id), sale_price })),
    }), 'Compra registrada! Estoque atualizado.');
    onSaved(id);
  }

  return (
    <Modal title="Registrar compra de mercadorias" onClose={onClose} size="xl"
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={busy || !items.length} onClick={save}>Salvar compra ({brl(total)})</button></>}>
      <div className="form-grid mb">
        <Field label="Fornecedor" className="c-5">
          <select className="select" value={f.supplier_id} onChange={set('supplier_id')}>
            <option value="">— selecione —</option>{(suppliers || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Nº da nota fiscal" className="c-3"><input className="input" value={f.invoice_number} onChange={set('invoice_number')} /></Field>
        <Field label="Data da compra" className="c-4"><input type="date" className="input" value={f.purchase_date} onChange={set('purchase_date')} /></Field>
      </div>
      <div className="row mb">
        <div style={{ flex: 1 }}><VariantSearch showCost onPick={add} placeholder="Adicionar produto: código de barras ou nome" /></div>
        <button className="btn" onClick={() => setNewProduct(true)}><PackagePlus size={16} />Cadastrar produto novo</button>
      </div>
      {!items.length ? <Empty>Adicione os produtos recebidos. Produto novo? Cadastre com estoque inicial zero e depois adicione aqui.</Empty> : (
        <table className="table table-compact">
          <thead><tr><th>Produto</th><th className="num">Estoque</th><th style={{ width: 90 }}>Qtd</th><th style={{ width: 130 }}>Custo unit.</th><th className="num">Custo final*</th><th className="num">Total</th><th className="num">Preço venda</th><th className="num">Markup</th><th /></tr></thead>
          <tbody>{items.map((i, k) => (
            <tr key={i.variant_id}>
              <td>{i.label}{i.last && <div className="small muted">última compra {brl(i.last.unit_cost)} em {date(i.last.purchase_date)}{i.last.supplier_name ? ` (${i.last.supplier_name})` : ''}</div>}</td>
              <td className="num">{i.stock}</td>
              <td><input type="number" className="input num" min={1} value={i.quantity} onChange={(e) => upd(k, { quantity: Math.max(0, Number(e.target.value) || 0) })} /></td>
              <td><MoneyInput value={i.unit_cost} onChange={(v) => upd(k, { unit_cost: r2(v) })} /></td>
              <td className="num">{brl(landed(i))}</td>
              <td className="num strong">{brl(i.unit_cost * i.quantity)}</td>
              <td className="num">{brl(prices[i.product_id] || i.sale_price)}</td>
              <td className="num">{landed(i) > 0 ? `${((prices[i.product_id] || i.sale_price) / landed(i)).toFixed(2)}x` : '—'}</td>
              <td><button className="btn btn-ghost btn-icon" onClick={() => setItems(items.filter((_, j) => j !== k))}><Trash2 size={15} /></button></td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <div className="small muted mt-s">* Custo final = custo unitário + rateio do frete e despesas, proporcional ao valor de cada item. O custo médio do produto é atualizado automaticamente.</div>

      <div className="grid grid-3 mt">
        <div className="card card-body col">
          <div className="strong">Custos adicionais</div>
          <Field label="Frete"><MoneyInput value={f.freight} onChange={set('freight')} /></Field>
          <Field label="Outras despesas (impostos, embalagem…)"><MoneyInput value={f.other_costs} onChange={set('other_costs')} /></Field>
          <Field label="Desconto obtido"><MoneyInput value={f.discount} onChange={set('discount')} /></Field>
        </div>
        <div className="card card-body col">
          <div className="strong">Pagamento</div>
          <Segmented value={pay.mode} onChange={(m) => setPay({ ...pay, mode: m })} options={[{ value: 'prazo', label: 'A prazo (boleto)' }, { value: 'avista', label: 'À vista (pago)' }]} />
          {pay.mode === 'avista' ? (
            <Field label="Forma"><select className="select" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>
              {['pix', 'dinheiro', 'debito', 'credito'].map((m) => <option key={m} value={m}>{methodLabel(m)}</option>)}
            </select></Field>
          ) : (
            <div className="grid grid-2" style={{ gap: 10 }}>
              <Field label="Parcelas"><input type="number" className="input" min={1} max={24} value={pay.installments} onChange={(e) => setPay({ ...pay, installments: Number(e.target.value) })} /></Field>
              <Field label="Intervalo (dias)"><input type="number" className="input" value={pay.interval_days} onChange={(e) => setPay({ ...pay, interval_days: Number(e.target.value) })} /></Field>
              <Field label="1º vencimento" className="span-2"><input type="date" className="input" value={pay.first_due} onChange={(e) => setPay({ ...pay, first_due: e.target.value })} /></Field>
            </div>
          )}
          <div className="small muted">{pay.mode === 'prazo' ? `Gera ${pay.installments} conta(s) a pagar de ~${brl(total / (pay.installments || 1))}` : 'Registrada como conta já paga.'}</div>
        </div>
        <div className="card card-body col">
          <div className="strong">Resumo</div>
          <dl className="kv">
            <dt>Produtos</dt><dd>{brl(productsTotal)}</dd>
            <dt>Frete + despesas</dt><dd>{brl(r2(f.freight) + r2(f.other_costs))}</dd>
            <dt>Desconto</dt><dd>-{brl(f.discount)}</dd>
            <dt className="strong">Total</dt><dd className="strong" style={{ fontSize: 17 }}>{brl(total)}</dd>
            <dt>Peças</dt><dd>{items.reduce((a, i) => a + Number(i.quantity), 0)}</dd>
          </dl>
          {productIds.length > 0 && (
            <details>
              <summary className="small" style={{ cursor: 'pointer' }}>Atualizar preços de venda</summary>
              {productIds.map((pid) => {
                const it = items.find((i) => i.product_id === pid);
                return <div key={pid} className="row mt-s small"><span style={{ flex: 1 }}>{it.label.split(' ').slice(0, 3).join(' ')}</span><MoneyInput style={{ width: 110 }} value={prices[pid] ?? it.sale_price} onChange={(v) => setPrices({ ...prices, [pid]: r2(v) })} /></div>;
              })}
            </details>
          )}
        </div>
      </div>
      <Field label="Observações" className="mt"><input className="input" value={f.notes} onChange={set('notes')} /></Field>
      {newProduct && <ProductForm onClose={() => setNewProduct(false)} onSaved={async (id) => {
        setNewProduct(false);
        const p = await api('products.get', { id });
        for (const v of p.variants) await add({ ...v, label: v.label });
      }} />}
    </Modal>
  );
}

function PurchaseDetail({ id, onClose, onChanged }) {
  const { data: p, reload } = useLoad('purchases.get', { id }, [id]);
  const confirm = useConfirm();
  const [run] = useAction();
  if (!p) return null;
  async function cancel() {
    if (!(await confirm({ message: 'Cancelar esta compra? As peças serão retiradas do estoque e as contas a pagar removidas.', danger: true, confirmText: 'Cancelar compra' }))) return;
    await run(() => api('purchases.cancel', { id }), 'Compra cancelada.');
    reload(); onChanged();
  }
  return (
    <Modal title={<>Compra #{p.id} <StatusBadge status={p.status} /></>} onClose={onClose} size="lg"
      footer={p.status === 'recebida' && <button className="btn btn-ghost text-danger" onClick={cancel}>Cancelar compra</button>}>
      <div className="row wrap mb" style={{ gap: 24 }}>
        <div><div className="muted small">Fornecedor</div><div className="strong">{p.supplier_name || '—'}</div></div>
        <div><div className="muted small">Nota fiscal</div><div className="strong">{p.invoice_number || '—'}</div></div>
        <div><div className="muted small">Data</div><div className="strong">{date(p.purchase_date)}</div></div>
      </div>
      <table className="table table-compact">
        <thead><tr><th>Produto</th><th className="num">Qtd</th><th className="num">Custo unit.</th><th className="num">Custo final</th><th className="num">Total</th></tr></thead>
        <tbody>{p.items.map((i) => <tr key={i.id}><td>{i.product_name} {[i.color, i.size].filter(Boolean).join(' ')}</td><td className="num">{i.quantity}</td><td className="num">{brl(i.unit_cost)}</td><td className="num">{brl(i.landed_unit_cost)}</td><td className="num">{brl(i.total)}</td></tr>)}</tbody>
        <tfoot>
          <tr><td colSpan={4}>Produtos {brl(p.products_total)} + frete {brl(p.freight)} + outras {brl(p.other_costs)} − desconto {brl(p.discount)}</td><td className="num">{brl(p.total)}</td></tr>
        </tfoot>
      </table>
      {p.payables.length > 0 && (
        <div className="mt">
          <div className="strong" style={{ marginBottom: 6 }}>Pagamentos</div>
          {p.payables.map((b) => <div key={b.id} className="row between small"><span>{b.installment_label || 'Único'} — venc. {date(b.due_date)}</span><span>{brl(b.amount)} <StatusBadge status={b.status} /></span></div>)}
        </div>
      )}
    </Modal>
  );
}

export default function Compras() {
  const [range, setRange] = useState({ from: addDays(today(), -90), to: today() });
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(null);
  const { data, loading, reload } = useLoad('purchases.list', range, [range]);
  const valid = (data || []).filter((p) => p.status === 'recebida');
  return (
    <>
      <PageHeader title="Compras" sub="Entrada de mercadorias com custo, frete e contas a pagar">
        <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={16} />Nova compra</button>
      </PageHeader>
      <div className="row mb"><DateRange {...range} onChange={setRange} /><div className="spacer" /><span className="muted">{valid.length} compra(s) · <b>{brl(valid.reduce((a, p) => a + p.total, 0))}</b> · {valid.reduce((a, p) => a + p.pieces, 0)} peças</span></div>
      <div className="card">
        {loading && !data ? <Loading /> : !data?.length ? <Empty icon={<Truck size={34} />}>Nenhuma compra no período.</Empty> : (
          <table className="table">
            <thead><tr><th>Nº</th><th>Data</th><th>Fornecedor</th><th>Nota</th><th className="num">Peças</th><th className="num">Frete</th><th className="num">Total</th><th>Pagamento</th><th>Situação</th></tr></thead>
            <tbody>{data.map((p) => (
              <tr key={p.id} className={`clickable ${p.status !== 'recebida' ? 'dim' : ''}`} onClick={() => setOpen(p.id)}>
                <td className="strong">#{p.id}</td><td>{date(p.purchase_date)}</td><td>{p.supplier_name || '—'}</td><td>{p.invoice_number || '—'}</td>
                <td className="num">{p.pieces}</td><td className="num">{p.freight ? brl(p.freight) : '—'}</td><td className="num strong">{brl(p.total)}</td>
                <td>{p.open_payables > 0 ? <span className="badge badge-warning">{p.open_payables} parcela(s) em aberto</span> : <span className="badge badge-success">Quitada</span>}</td>
                <td><StatusBadge status={p.status} /></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      {creating && <PurchaseForm onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reload(); }} />}
      {open && <PurchaseDetail id={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </>
  );
}
