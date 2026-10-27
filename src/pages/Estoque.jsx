import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ClipboardList, PackagePlus, TriangleAlert, Scale, History, ClipboardCheck, Minus, Plus } from 'lucide-react';
import { api } from '../api';
import { useApp } from '../App';
import { Field, useLoad, useAction, useConfirm, PageHeader, Empty, Loading, Tabs, Segmented, DateRange, StatusBadge, Modal, useToast } from '../components/ui';
import VariantSearch from '../components/VariantSearch';
import { brl, dateTime, MOVEMENT_LABELS, today, addDays } from '../lib/format';

function Movements() {
  const [range, setRange] = useState({ from: addDays(today(), -30), to: today() });
  const [type, setType] = useState('');
  const { data, loading } = useLoad('stock.movements', { ...range, type, limit: 1000 }, [range, type]);
  return (
    <>
      <div className="row mb wrap">
        <DateRange {...range} onChange={setRange} />
        <select className="select" style={{ width: 200 }} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Todos os tipos</option>{Object.entries(MOVEMENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div className="card">
        {loading && !data ? <Loading /> : !data?.length ? <Empty>Nenhuma movimentação no período.</Empty> : (
          <div className="table-wrap">
            <table className="table table-compact">
              <thead><tr><th>Data</th><th>Produto</th><th>Tipo</th><th className="num">Qtd</th><th className="num">Saldo após</th><th>Observação</th><th>Usuário</th></tr></thead>
              <tbody>{data.map((m) => (
                <tr key={m.id}>
                  <td className="nowrap">{dateTime(m.created_at)}</td><td>{m.product_name} {[m.color, m.size].filter(Boolean).join(' ')}</td>
                  <td><span className="badge">{MOVEMENT_LABELS[m.type] || m.type}</span></td>
                  <td className={`num strong ${m.quantity < 0 ? 'text-danger' : 'text-success'}`}>{m.quantity > 0 ? '+' : ''}{m.quantity}</td>
                  <td className="num">{m.balance_after}</td><td className="small">{m.notes || (m.reference_type ? `${m.reference_type} #${m.reference_id}` : '')}</td><td className="small">{m.user_name}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function Adjust() {
  const { isAdmin } = useApp();
  const [variant, setVariant] = useState(null);
  const [mode, setMode] = useState('entrada');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [run, busy] = useAction();
  const reasons = { entrada: ['Mercadoria recebida sem nota', 'Devolução de consignado', 'Brinde de fornecedor'], saida: ['Avaria / defeito', 'Perda / furto', 'Uso interno', 'Devolução ao fornecedor', 'Brinde para cliente'], ajuste: ['Correção de contagem', 'Erro de cadastro'] };
  if (!isAdmin) return <div className="alert alert-info">Somente administradores podem movimentar o estoque manualmente.</div>;
  async function save() {
    const balance = await run(() => api('stock.adjust', { variantId: variant.id, mode, quantity: Number(qty), reason }), 'Movimentação registrada!');
    setVariant({ ...variant, stock: balance }); setQty(''); setReason('');
  }
  return (
    <div className="grid grid-2">
      <div className="card card-body col">
        <Field label="Produto"><VariantSearch autoFocus onPick={setVariant} /></Field>
        {variant && (
          <div className="alert alert-info"><div><div className="strong">{variant.label}</div><div className="small">Código {variant.barcode} · Saldo atual: <b>{variant.stock}</b></div></div></div>
        )}
        <Segmented value={mode} onChange={setMode} options={[{ value: 'entrada', label: 'Entrada' }, { value: 'saida', label: 'Saída' }, { value: 'ajuste', label: 'Ajustar saldo' }]} />
        <Field label={mode === 'ajuste' ? 'Novo saldo (quantidade contada)' : 'Quantidade'}><input type="number" className="input input-lg" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
        <Field label="Motivo *">
          <input className="input" list="reasons" value={reason} onChange={(e) => setReason(e.target.value)} />
          <datalist id="reasons">{reasons[mode].map((r) => <option key={r} value={r} />)}</datalist>
        </Field>
        <button className="btn btn-primary btn-lg" disabled={!variant || qty === '' || !reason || busy} onClick={save}>Registrar</button>
      </div>
      <div className="card card-body small muted col">
        <div className="strong" style={{ color: 'var(--text)' }}>Quando usar cada opção</div>
        <div><b>Entrada:</b> mercadoria que chegou sem passar pelo módulo de Compras.</div>
        <div><b>Saída:</b> peças com defeito, perdas, furtos, uso interno ou devolução ao fornecedor.</div>
        <div><b>Ajustar saldo:</b> quando a contagem física não bate com o sistema. O sistema calcula a diferença e registra no histórico.</div>
        <div>Toda movimentação fica registrada com data, usuário e motivo — veja em “Auditoria” onde estão as diferenças.</div>
      </div>
    </div>
  );
}

function Low() {
  const { data, loading } = useLoad('stock.low', {}, []);
  return (
    <div className="card">
      {loading && !data ? <Loading /> : !data?.length ? <Empty>Nenhum item com estoque baixo. 👏</Empty> : (
        <table className="table">
          <thead><tr><th>Produto</th><th>Marca</th><th>Código</th><th className="num">Estoque</th><th className="num">Mínimo</th><th className="num">Preço</th></tr></thead>
          <tbody>{data.map((v) => (
            <tr key={v.id}><td className="strong">{v.label}</td><td>{v.brand}</td><td className="mono small">{v.barcode}</td>
              <td className="num"><span className={`badge ${v.stock <= 0 ? 'badge-danger' : 'badge-warning'}`}>{v.stock}</span></td><td className="num">{v.min_qty}</td><td className="num">{brl(v.price)}</td></tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}

function Audit() {
  const { data, loading } = useLoad('stock.audit', {}, []);
  const [hist, setHist] = useState(null);
  const withAdjust = (data || []).filter((r) => r.ajustes !== 0 || r.saidas > 0 || r.divergence !== 0);
  const lossValue = withAdjust.reduce((a, r) => a + Math.min(0, r.adjust_value), 0);
  return (
    <>
      <div className="alert alert-info mb">
        <Scale size={18} />
        <div>Para cada variação, o sistema soma entradas, vendas, devoluções, saídas e ajustes. Itens com muitos <b>ajustes negativos</b> indicam perdas, furtos ou erros de registro.
          {lossValue < 0 && <> Perdas acumuladas por ajustes/inventário: <b>{brl(-lossValue)}</b> (a custo).</>}</div>
      </div>
      <div className="card">
        {loading && !data ? <Loading /> : !withAdjust.length ? <Empty>Nenhuma diferença ou ajuste registrado.</Empty> : (
          <table className="table table-compact">
            <thead><tr><th>Produto</th><th className="num">Entradas</th><th className="num">Vendas</th><th className="num">Devoluções</th><th className="num">Saídas</th><th className="num">Ajustes</th><th className="num">Valor ajustes</th><th className="num">Saldo</th><th /></tr></thead>
            <tbody>{withAdjust.map((r) => (
              <tr key={r.id}>
                <td>{r.product_name} {[r.color, r.size].filter(Boolean).join(' ')}{r.divergence !== 0 && <span className="badge badge-danger" style={{ marginLeft: 6 }}>divergência {r.divergence}</span>}</td>
                <td className="num">{r.entradas}</td><td className="num">{r.vendas}</td><td className="num">{r.devolucoes}</td><td className="num">{r.saidas || '—'}</td>
                <td className={`num strong ${r.ajustes < 0 ? 'text-danger' : r.ajustes > 0 ? 'text-warning' : ''}`}>{r.ajustes > 0 ? '+' : ''}{r.ajustes}</td>
                <td className="num">{r.adjust_value ? brl(r.adjust_value) : '—'}</td><td className="num strong">{r.stock}</td>
                <td className="actions-cell"><button className="btn btn-ghost btn-icon" onClick={() => setHist(r)}><History size={15} /></button></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      {hist && <VariantHistory variant={hist} onClose={() => setHist(null)} />}
    </>
  );
}

function VariantHistory({ variant, onClose }) {
  const { data } = useLoad('stock.movements', { variantId: variant.id, limit: 500 }, [variant.id]);
  return (
    <Modal title={`Histórico — ${variant.product_name} ${[variant.color, variant.size].filter(Boolean).join(' ')}`} onClose={onClose} size="lg">
      {!data ? <Loading /> : (
        <table className="table table-compact">
          <thead><tr><th>Data</th><th>Tipo</th><th className="num">Qtd</th><th className="num">Saldo</th><th>Observação</th><th>Usuário</th></tr></thead>
          <tbody>{data.map((m) => (
            <tr key={m.id}><td>{dateTime(m.created_at)}</td><td>{MOVEMENT_LABELS[m.type]}</td><td className={`num ${m.quantity < 0 ? 'text-danger' : 'text-success'}`}>{m.quantity > 0 ? '+' : ''}{m.quantity}</td><td className="num">{m.balance_after}</td><td className="small">{m.notes}</td><td className="small">{m.user_name}</td></tr>
          ))}</tbody>
        </table>
      )}
    </Modal>
  );
}

function InventoryCount({ id, onBack }) {
  const { isAdmin } = useApp();
  const toast = useToast();
  const confirm = useConfirm();
  const [run, busy] = useAction();
  const [qtyMode, setQtyMode] = useState(1);
  const [filter, setFilter] = useState('');
  const [last, setLast] = useState(null);
  const { data: inv, reload, setData } = useLoad('inventory.get', { id }, [id]);
  if (!inv) return <Loading />;
  const open = inv.status === 'aberto';
  const counted = inv.items.filter((i) => i.counted_qty != null);
  const diffs = counted.filter((i) => i.counted_qty !== i.current_qty);
  const shown = inv.items.filter((i) => (filter === 'pending' ? i.counted_qty == null : filter === 'diff' ? i.counted_qty != null && i.counted_qty !== i.current_qty : true));

  async function count(v) {
    try {
      const r = await api('inventory.count', { inventoryId: id, variantId: v.id, quantity: qtyMode, mode: 'add' });
      setLast({ label: v.label, qty: r.counted_qty });
      reload();
    } catch (e) { toast.error(e.message); }
  }
  async function setQty(item, value) {
    await api('inventory.count', { inventoryId: id, variantId: item.variant_id, quantity: value, mode: 'set' });
    setData({ ...inv, items: inv.items.map((i) => (i.id === item.id ? { ...i, counted_qty: value === '' ? null : Number(value) } : i)) });
  }
  async function finish() {
    const pending = inv.items.length - counted.length;
    let zero = false;
    if (pending > 0) {
      zero = await confirm({ title: 'Itens não contados', message: `${pending} item(ns) não foram contados.\n\nDeseja considerar esses itens com estoque ZERO? (Escolha "Voltar" para mantê-los com o saldo atual.)`, confirmText: 'Zerar não contados', danger: true });
    }
    if (!(await confirm({ message: `Finalizar o inventário e ajustar ${diffs.length + (zero ? pending : 0)} item(ns) no estoque?`, confirmText: 'Finalizar e ajustar' }))) return;
    const r = await run(() => api('inventory.finish', { id, zeroUncounted: zero }));
    toast.success(`Inventário finalizado. ${r.adjusted} item(ns) ajustado(s).`);
    reload();
  }

  const diffValue = diffs.reduce((a, i) => a + (i.counted_qty - i.current_qty) * i.cost, 0);
  return (
    <>
      <div className="row mb">
        <button className="btn btn-ghost btn-sm" onClick={onBack}>← Inventários</button>
        <h3>{inv.description}</h3><StatusBadge status={inv.status} />
        <div className="spacer" />
        {open && isAdmin && <button className="btn btn-ghost" onClick={async () => { if (await confirm({ message: 'Cancelar este inventário? Nada será ajustado.', danger: true })) { await api('inventory.cancel', { id }); reload(); } }}>Cancelar inventário</button>}
        {open && isAdmin && <button className="btn btn-primary" disabled={busy} onClick={finish}><ClipboardCheck size={16} />Finalizar e ajustar estoque</button>}
      </div>
      <div className="grid grid-4 mb">
        <div className="card stat"><div className="stat-label">Itens</div><div className="stat-value">{inv.items.length}</div></div>
        <div className="card stat"><div className="stat-label">Contados</div><div className="stat-value">{counted.length}</div><div className="progress mt-s"><div style={{ width: `${(counted.length / Math.max(1, inv.items.length)) * 100}%` }} /></div></div>
        <div className="card stat"><div className="stat-label">Com diferença</div><div className="stat-value">{diffs.length}</div></div>
        <div className="card stat"><div className="stat-label">Valor da diferença (custo)</div><div className={`stat-value ${diffValue < 0 ? 'text-danger' : ''}`}>{brl(diffValue)}</div></div>
      </div>
      {open && (
        <div className="card card-body mb">
          <div className="row">
            <div style={{ flex: 1 }}><VariantSearch autoFocus onPick={count} placeholder="Passe cada peça no leitor — cada leitura soma na contagem" /></div>
            <div className="qty-control"><button onClick={() => setQtyMode(Math.max(1, qtyMode - 1))}><Minus size={14} /></button><span>{qtyMode}</span><button onClick={() => setQtyMode(qtyMode + 1)}><Plus size={14} /></button></div>
            <span className="small muted">por leitura</span>
          </div>
          {last && <div className="alert alert-success mt-s small">✔ {last.label} — contado: <b>{last.qty}</b></div>}
        </div>
      )}
      <div className="row mb"><Segmented value={filter} onChange={setFilter} options={[{ value: '', label: 'Todos' }, { value: 'pending', label: 'Não contados' }, { value: 'diff', label: 'Com diferença' }]} /></div>
      <div className="card">
        <table className="table table-compact">
          <thead><tr><th>Produto</th><th>Código</th><th className="num">No sistema</th><th className="num" style={{ width: 120 }}>Contado</th><th className="num">Diferença</th></tr></thead>
          <tbody>{shown.map((i) => {
            const d = i.counted_qty == null ? null : i.counted_qty - (open ? i.current_qty : i.system_qty);
            return (
              <tr key={i.id}>
                <td>{i.product_name} {[i.color, i.size].filter(Boolean).join(' ')}</td><td className="mono small">{i.barcode}</td>
                <td className="num">{open ? i.current_qty : i.system_qty}</td>
                <td>{open ? <input type="number" className="input num" style={{ height: 30 }} value={i.counted_qty ?? ''} onChange={(e) => setQty(i, e.target.value)} /> : <div className="num">{i.counted_qty ?? '—'}</div>}</td>
                <td className={`num strong ${d < 0 ? 'text-danger' : d > 0 ? 'text-warning' : ''}`}>{d == null ? '—' : d > 0 ? `+${d}` : d}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </>
  );
}

function Inventory() {
  const { isAdmin } = useApp();
  const [run] = useAction();
  const [current, setCurrent] = useState(null);
  const [category, setCategory] = useState('');
  const { data: options } = useLoad('products.options', {}, []);
  const { data, reload } = useLoad('inventory.list', {}, [current]);
  if (current) return <InventoryCount id={current} onBack={() => setCurrent(null)} />;
  async function create() {
    const id = await run(() => api('inventory.create', { category, description: `Inventário ${category || 'geral'} ${new Date().toLocaleDateString('pt-BR')}` }));
    setCurrent(id);
  }
  return (
    <>
      {isAdmin && (
        <div className="card card-body mb row wrap">
          <ClipboardList size={20} />
          <div style={{ flex: 1 }}><div className="strong">Novo inventário</div><div className="small muted">Conte as peças com o leitor de código de barras. Ao finalizar, o estoque é ajustado e as diferenças ficam registradas.</div></div>
          <select className="select" style={{ width: 200 }} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Loja inteira</option>{options?.categories.map((c) => <option key={c}>{c}</option>)}
          </select>
          <button className="btn btn-primary" onClick={create}>Iniciar inventário</button>
        </div>
      )}
      <div className="card">
        {!data ? <Loading /> : !data.length ? <Empty>Nenhum inventário realizado.</Empty> : (
          <table className="table">
            <thead><tr><th>Descrição</th><th>Início</th><th>Fim</th><th>Responsável</th><th className="num">Contados</th><th>Situação</th></tr></thead>
            <tbody>{data.map((i) => (
              <tr key={i.id} className="clickable" onClick={() => setCurrent(i.id)}>
                <td className="strong">{i.description}</td><td>{dateTime(i.created_at)}</td><td>{i.finished_at ? dateTime(i.finished_at) : '—'}</td><td>{i.user_name}</td>
                <td className="num">{i.counted_items}/{i.total_items}</td><td><StatusBadge status={i.status} /></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </>
  );
}

export default function Estoque() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState(params.get('tab') || 'movimentacoes');
  return (
    <>
      <PageHeader title="Estoque" sub="Movimentações, ajustes, inventário e auditoria de diferenças" />
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'movimentacoes', label: 'Movimentações', icon: <History size={15} /> },
        { id: 'movimentar', label: 'Entrada / saída / ajuste', icon: <PackagePlus size={15} /> },
        { id: 'baixo', label: 'Estoque baixo', icon: <TriangleAlert size={15} /> },
        { id: 'inventario', label: 'Inventário', icon: <ClipboardList size={15} /> },
        { id: 'auditoria', label: 'Auditoria de diferenças', icon: <Scale size={15} /> },
      ]} />
      {tab === 'movimentacoes' && <Movements />}
      {tab === 'movimentar' && <Adjust />}
      {tab === 'baixo' && <Low />}
      {tab === 'inventario' && <Inventory />}
      {tab === 'auditoria' && <Audit />}
    </>
  );
}
