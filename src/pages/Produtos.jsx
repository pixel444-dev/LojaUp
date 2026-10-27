import { useState } from 'react';
import { Plus, Search, Shirt, Tag, Trash2, Printer, X, Wand2, History } from 'lucide-react';
import { api } from '../api';
import { useApp } from '../App';
import { Modal, Field, MoneyInput, useLoad, useAction, useConfirm, PageHeader, Empty, Loading, Segmented } from '../components/ui';
import { brl, date, r2, pct, MOVEMENT_LABELS, dateTime } from '../lib/format';
import { printHtml, labelsDoc } from '../lib/print';

const SIZE_PRESETS = {
  'Letras': ['PP', 'P', 'M', 'G', 'GG', 'XG'],
  'Números (jeans)': ['34', '36', '38', '40', '42', '44', '46', '48'],
  'Infantil': ['2', '4', '6', '8', '10', '12', '14', '16'],
  'Calçados': ['33', '34', '35', '36', '37', '38', '39', '40', '41', '42', '43', '44'],
  'Plus size': ['G1', 'G2', 'G3', 'G4'],
  'Único': ['Único'],
};

function ChipInput({ values, onChange, placeholder, suggestions = [] }) {
  const [text, setText] = useState('');
  const add = (v) => { const t = v.trim(); if (t && !values.includes(t)) onChange([...values, t]); setText(''); };
  return (
    <div className="col" style={{ gap: 6 }}>
      <div className="chip-list">
        {values.map((v) => <span key={v} className="chip active">{v}<button onClick={() => onChange(values.filter((x) => x !== v))}><X size={12} /></button></span>)}
        <input className="input" style={{ width: 170, height: 30 }} placeholder={placeholder} value={text} list={placeholder}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(text); } }} onBlur={() => text && add(text)} />
        <datalist id={placeholder}>{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
      </div>
    </div>
  );
}

export function ProductForm({ id, onClose, onSaved }) {
  const { data: options } = useLoad('products.options', {}, []);
  const { data: suppliers } = useLoad('suppliers.list', {}, []);
  const { data: loaded } = useLoad(id ? 'products.get' : 'stock.defaultMin', id ? { id } : {}, [id]);
  const [p, setP] = useState(null);
  const [colors, setColors] = useState([]);
  const [sizes, setSizes] = useState([]);
  const [run, busy] = useAction();

  if (!p && loaded != null) {
    if (id) setP({ ...loaded, variants: loaded.variants.map((v) => ({ ...v })) });
    else setP({ name: '', brand: '', model: '', category: '', supplier_id: '', cost_price: '', sale_price: '', min_stock: loaded || 2, notes: '', variants: [] });
  }
  if (!p) return null;

  const set = (k) => (e) => setP({ ...p, [k]: e && e.target ? e.target.value : e });
  const margin = p.sale_price > 0 ? (1 - (p.cost_price || 0) / p.sale_price) * 100 : 0;
  const markup = p.cost_price > 0 ? p.sale_price / p.cost_price : 0;

  function generate() {
    const cs = colors.length ? colors : [''];
    const ss = sizes.length ? sizes : [''];
    const existing = new Set(p.variants.map((v) => `${(v.color || '').toLowerCase()}|${(v.size || '').toLowerCase()}`));
    const add = [];
    for (const c of cs) for (const s of ss) {
      if (!existing.has(`${c.toLowerCase()}|${s.toLowerCase()}`)) add.push({ key: Math.random(), color: c, size: s, barcode: '', stock: 0, min_stock: '', sale_price: '', active: true });
    }
    setP({ ...p, variants: [...p.variants, ...add] });
  }
  const updV = (idx, patch) => setP({ ...p, variants: p.variants.map((v, i) => (i === idx ? { ...v, ...patch } : v)) });

  async function save() {
    const savedId = await run(() => api('products.save', {
      ...p, cost_price: r2(p.cost_price), sale_price: r2(p.sale_price),
      variants: p.variants.map((v) => ({ ...v, active: v.active !== false && v.active !== 0 })),
    }), 'Produto salvo!');
    onSaved(savedId);
  }

  return (
    <Modal title={id ? `Editar: ${p.name}` : 'Novo produto'} onClose={onClose} size="xl"
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={busy} onClick={save}>Salvar produto</button></>}>
      <div className="form-grid">
        <Field label="Nome do produto *" className="c-6"><input className="input" autoFocus value={p.name} onChange={set('name')} placeholder="Ex.: Calça Jeans Skinny" /></Field>
        <Field label="Marca" className="c-3"><input className="input" list="brands" value={p.brand || ''} onChange={set('brand')} /></Field>
        <Field label="Modelo / referência" className="c-3"><input className="input" value={p.model || ''} onChange={set('model')} /></Field>
        <Field label="Categoria" className="c-3"><input className="input" list="categories" value={p.category || ''} onChange={set('category')} placeholder="Ex.: Calças" /></Field>
        <Field label="Fornecedor principal" className="c-3">
          <select className="select" value={p.supplier_id || ''} onChange={set('supplier_id')}>
            <option value="">—</option>{(suppliers || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Custo (R$)" className="c-2"><MoneyInput value={p.cost_price} onChange={set('cost_price')} /></Field>
        <Field label="Preço de venda (R$)" className="c-2"><MoneyInput value={p.sale_price} onChange={set('sale_price')} /></Field>
        <Field label="Estoque mínimo" className="c-2" hint="Alerta de estoque baixo"><input type="number" className="input" value={p.min_stock} onChange={set('min_stock')} /></Field>
        <div className="c-12 small muted">
          {p.sale_price > 0 && <>Margem: <b className={margin < 40 ? 'text-warning' : 'text-success'}>{pct(margin.toFixed(1))}</b> · Markup: <b>{markup.toFixed(2)}x</b> · Lucro por peça: <b>{brl(p.sale_price - (p.cost_price || 0))}</b></>}
          {p.cost_price > 0 && <> · Sugestões: markup 2x = {brl(p.cost_price * 2)}, 2,5x = {brl(p.cost_price * 2.5)}</>}
        </div>
        <datalist id="brands">{options?.brands.map((b) => <option key={b} value={b} />)}</datalist>
        <datalist id="categories">{options?.categories.map((b) => <option key={b} value={b} />)}</datalist>
      </div>

      <div className="divider" />
      <div className="strong mb" style={{ marginBottom: 8 }}>Grade de variações (cor × tamanho)</div>
      <div className="card card-body mb" style={{ background: 'var(--surface-2)' }}>
        <div className="form-grid">
          <Field label="Cores" className="c-5"><ChipInput values={colors} onChange={setColors} placeholder="Digite a cor + Enter" suggestions={options?.colors} /></Field>
          <Field label="Tamanhos" className="c-5">
            <ChipInput values={sizes} onChange={setSizes} placeholder="Tamanho + Enter" suggestions={options?.sizes} />
            <div className="chip-list mt-s">{Object.entries(SIZE_PRESETS).map(([k, v]) => <button key={k} className="chip" onClick={() => setSizes(v)}>{k}</button>)}</div>
          </Field>
          <div className="c-2" style={{ display: 'flex', alignItems: 'flex-end' }}><button className="btn btn-primary btn-block" onClick={generate}><Wand2 size={16} />Gerar grade</button></div>
        </div>
      </div>
      {p.variants.length === 0 ? <Empty>Escolha as cores e os tamanhos e clique em “Gerar grade”. Produto sem variação? Clique em “Gerar grade” sem escolher nada.</Empty> : (
        <div className="table-wrap" style={{ maxHeight: 360 }}>
          <table className="table table-compact variant-grid">
            <thead><tr><th>Cor</th><th>Tamanho</th><th>Código de barras</th><th className="num">{id ? 'Estoque atual' : 'Estoque inicial'}</th><th className="num">Est. mínimo</th><th className="num">Preço próprio</th><th>Ativo</th><th /></tr></thead>
            <tbody>{p.variants.map((v, idx) => (
              <tr key={v.id || v.key} className={v.active === false || v.active === 0 ? 'dim' : ''}>
                <td><input className="input" value={v.color || ''} onChange={(e) => updV(idx, { color: e.target.value })} /></td>
                <td style={{ width: 100 }}><input className="input" value={v.size || ''} onChange={(e) => updV(idx, { size: e.target.value })} /></td>
                <td><input className="input mono" placeholder="Automático" value={v.barcode || ''} onChange={(e) => updV(idx, { barcode: e.target.value })} /></td>
                <td style={{ width: 110 }}>{v.id ? <div className="num strong">{v.stock}</div> : <input type="number" className="input num" value={v.stock} onChange={(e) => updV(idx, { stock: e.target.value })} />}</td>
                <td style={{ width: 100 }}><input type="number" className="input num" placeholder={String(p.min_stock)} value={v.min_stock ?? ''} onChange={(e) => updV(idx, { min_stock: e.target.value })} /></td>
                <td style={{ width: 120 }}><MoneyInput placeholder="Padrão" value={v.sale_price ?? ''} onChange={(val) => updV(idx, { sale_price: val })} /></td>
                <td><input type="checkbox" checked={v.active !== false && v.active !== 0} onChange={(e) => updV(idx, { active: e.target.checked })} /></td>
                <td>{!v.id && <button className="btn btn-ghost btn-icon" onClick={() => setP({ ...p, variants: p.variants.filter((_, i) => i !== idx) })}><Trash2 size={15} /></button>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {id && <div className="small muted mt-s">Para alterar o estoque de uma variação existente use Estoque → Entrada/Saída/Ajuste (fica registrado no histórico).</div>}
      <Field label="Observações" className="mt"><input className="input" value={p.notes || ''} onChange={set('notes')} /></Field>
    </Modal>
  );
}

export function LabelsModal({ products, onClose }) {
  const { settings } = useApp();
  const [items, setItems] = useState(() => products.flatMap((p) => p.variants.filter((v) => v.active).map((v) => ({
    id: v.id, name: p.name, color: v.color, size: v.size, barcode: v.barcode, price: v.promo_price ?? v.price, copies: Math.max(1, v.stock || 1),
  }))));
  const [mode, setMode] = useState('a4');
  const [size, setSize] = useState({ width: 50, height: 30 });
  const total = items.reduce((a, i) => a + (Number(i.copies) || 0), 0);
  return (
    <Modal title="Imprimir etiquetas" onClose={onClose} size="lg"
      footer={<><button className="btn" onClick={onClose}>Fechar</button><button className="btn btn-primary" disabled={!total} onClick={() => printHtml(labelsDoc(items.filter((i) => i.copies > 0), settings, { mode, ...size }), settings, { thermal: false, dialog: true })}><Printer size={16} />Imprimir {total} etiqueta(s)</button></>}>
      <div className="row mb wrap">
        <Segmented value={mode} onChange={setMode} options={[{ value: 'a4', label: 'Folha A4 adesiva' }, { value: 'label', label: 'Impressora de etiquetas' }]} />
        <Field label="Largura (mm)"><input type="number" className="input" style={{ width: 90 }} value={size.width} onChange={(e) => setSize({ ...size, width: Number(e.target.value) })} /></Field>
        <Field label="Altura (mm)"><input type="number" className="input" style={{ width: 90 }} value={size.height} onChange={(e) => setSize({ ...size, height: Number(e.target.value) })} /></Field>
      </div>
      <div className="table-wrap" style={{ maxHeight: 380 }}>
        <table className="table table-compact">
          <thead><tr><th>Produto</th><th>Código</th><th className="num">Preço</th><th style={{ width: 100 }}>Cópias</th></tr></thead>
          <tbody>{items.map((it, k) => (
            <tr key={it.id}>
              <td>{it.name} {[it.color, it.size].filter(Boolean).join(' ')}</td><td className="mono small">{it.barcode}</td><td className="num">{brl(it.price)}</td>
              <td><input type="number" className="input" min={0} value={it.copies} onChange={(e) => setItems(items.map((x, j) => (j === k ? { ...x, copies: Math.max(0, Number(e.target.value) || 0) } : x)))} /></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </Modal>
  );
}

function HistoryModal({ product, onClose }) {
  const { data } = useLoad('stock.movements', { productId: product.id, limit: 300 }, [product.id]);
  return (
    <Modal title={`Movimentação — ${product.name}`} onClose={onClose} size="xl">
      {!data ? <Loading /> : !data.length ? <Empty>Sem movimentações.</Empty> : (
        <table className="table table-compact">
          <thead><tr><th>Data</th><th>Variação</th><th>Tipo</th><th className="num">Qtd</th><th className="num">Saldo</th><th>Observação</th><th>Usuário</th></tr></thead>
          <tbody>{data.map((m) => (
            <tr key={m.id}><td>{dateTime(m.created_at)}</td><td>{[m.color, m.size].filter(Boolean).join(' ')}</td><td>{MOVEMENT_LABELS[m.type] || m.type}</td>
              <td className={`num strong ${m.quantity < 0 ? 'text-danger' : 'text-success'}`}>{m.quantity > 0 ? '+' : ''}{m.quantity}</td><td className="num">{m.balance_after}</td>
              <td className="small">{m.notes || (m.reference_type ? `${m.reference_type} #${m.reference_id}` : '')}</td><td className="small">{m.user_name}</td></tr>
          ))}</tbody>
        </table>
      )}
    </Modal>
  );
}

export default function Produtos() {
  const { isAdmin } = useApp();
  const confirm = useConfirm();
  const [run] = useAction();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [category, setCategory] = useState('');
  const [editing, setEditing] = useState(null);
  const [labels, setLabels] = useState(null);
  const [history, setHistory] = useState(null);
  const { data: options } = useLoad('products.options', {}, []);
  const { data, loading, reload } = useLoad('products.list', { search, filter, category }, [search, filter, category]);

  async function remove(p) {
    if (!(await confirm({ message: `Excluir "${p.name}"? Se já tiver vendas ou compras, ele será apenas inativado.`, danger: true, confirmText: 'Excluir' }))) return;
    const r = await run(() => api('products.delete', { id: p.id }));
    reload();
    return r;
  }
  async function openLabels(p) { setLabels([await api('products.get', { id: p.id })]); }

  const totalPieces = (data || []).reduce((a, p) => a + Math.max(0, p.total_stock), 0);
  return (
    <>
      <PageHeader title="Produtos" sub={data ? `${data.length} produto(s) · ${totalPieces} peça(s) em estoque` : ''}>
        {isAdmin && <button className="btn btn-primary" onClick={() => setEditing({})}><Plus size={16} />Novo produto</button>}
      </PageHeader>
      <div className="row mb wrap">
        <div className="input-group" style={{ width: 320 }}><Search size={16} className="icon" /><input className="input" placeholder="Nome, marca, modelo ou código" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <select className="select" style={{ width: 180 }} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Todas as categorias</option>{options?.categories.map((c) => <option key={c}>{c}</option>)}
        </select>
        <Segmented value={filter} onChange={setFilter} options={[{ value: '', label: 'Todos' }, { value: 'low', label: 'Estoque baixo' }, { value: 'zero', label: 'Sem estoque' }]} />
      </div>
      <div className="card">
        {loading && !data ? <Loading /> : !data?.length ? <Empty icon={<Shirt size={34} />}>Nenhum produto encontrado.{isAdmin && ' Cadastre o primeiro em “Novo produto”.'}</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Produto</th><th>Marca / modelo</th><th>Categoria</th><th className="num">Variações</th><th className="num">Estoque</th>{isAdmin && <th className="num">Custo</th>}<th className="num">Preço</th>{isAdmin && <th className="num">Margem</th>}<th>Última venda</th><th /></tr></thead>
              <tbody>{data.map((p) => {
                const m = p.sale_price ? (1 - p.cost_price / p.sale_price) * 100 : 0;
                return (
                  <tr key={p.id} className={p.active ? '' : 'dim'}>
                    <td className="strong">{p.name}</td>
                    <td className="small">{[p.brand, p.model].filter(Boolean).join(' · ') || '—'}</td>
                    <td>{p.category || '—'}</td>
                    <td className="num">{p.variant_count}</td>
                    <td className="num">
                      <span className="strong">{p.total_stock}</span>
                      {p.low_count > 0 && <span className="badge badge-warning" style={{ marginLeft: 6 }}>{p.low_count} baixo</span>}
                    </td>
                    {isAdmin && <td className="num">{brl(p.cost_price)}</td>}
                    <td className="num strong">{brl(p.sale_price)}</td>
                    {isAdmin && <td className="num"><span className={m < 40 ? 'text-warning' : ''}>{pct(m.toFixed(0))}</span></td>}
                    <td className="small">{p.last_sale ? date(p.last_sale) : <span className="muted">nunca</span>}</td>
                    <td className="actions-cell">
                      <button className="btn btn-ghost btn-icon" title="Histórico" onClick={() => setHistory(p)}><History size={15} /></button>
                      <button className="btn btn-ghost btn-icon" title="Etiquetas" onClick={() => openLabels(p)}><Tag size={15} /></button>
                      {isAdmin && <button className="btn btn-sm" onClick={() => setEditing({ id: p.id })}>Editar</button>}
                      {isAdmin && <button className="btn btn-ghost btn-icon" title="Excluir" onClick={() => remove(p)}><Trash2 size={15} /></button>}
                    </td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
      </div>
      {editing && <ProductForm id={editing.id} onClose={() => setEditing(null)} onSaved={async (id) => {
        const wasNew = !editing.id;
        setEditing(null); reload();
        if (wasNew && (await confirm({ message: 'Produto cadastrado! Deseja imprimir as etiquetas com código de barras agora?', confirmText: 'Imprimir etiquetas' }))) {
          setLabels([await api('products.get', { id })]);
        }
      }} />}
      {labels && <LabelsModal products={labels} onClose={() => setLabels(null)} />}
      {history && <HistoryModal product={history} onClose={() => setHistory(null)} />}
    </>
  );
}
