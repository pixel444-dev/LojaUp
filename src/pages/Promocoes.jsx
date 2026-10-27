import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Tag, Trash2 } from 'lucide-react';
import { api } from '../api';
import { useApp } from '../App';
import { Modal, Field, MoneyInput, useLoad, useAction, useConfirm, PageHeader, Empty, Loading, Segmented } from '../components/ui';
import { brl, date, today, addDays } from '../lib/format';

function PromoForm({ initial, onClose, onSaved }) {
  const { data: options } = useLoad('products.options', {}, []);
  const { data: products } = useLoad('products.list', {}, []);
  const [p, setP] = useState({ name: '', discount_type: 'percent', value: '', scope: 'all', scope_value: '', start_date: today(), end_date: addDays(today(), 7), active: true, ...initial });
  const [run, busy] = useAction();
  const set = (k) => (e) => setP({ ...p, [k]: e && e.target ? e.target.value : e });
  return (
    <Modal title={p.id ? 'Editar promoção' : 'Nova promoção'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={busy} onClick={async () => { await run(() => api('promotions.save', { ...p, value: Number(p.value) }), 'Promoção salva!'); onSaved(); }}>Salvar</button></>}>
      <div className="form-grid">
        <Field label="Nome da promoção" className="c-12"><input className="input" autoFocus value={p.name} onChange={set('name')} placeholder="Ex.: Queima de verão" /></Field>
        <Field label="Tipo de desconto" className="c-6"><Segmented value={p.discount_type} onChange={set('discount_type')} options={[{ value: 'percent', label: 'Percentual (%)' }, { value: 'fixed', label: 'Valor (R$)' }]} /></Field>
        <Field label={p.discount_type === 'percent' ? 'Desconto (%)' : 'Desconto por peça (R$)'} className="c-6">
          {p.discount_type === 'percent' ? <input type="number" className="input" value={p.value} onChange={set('value')} /> : <MoneyInput value={p.value} onChange={set('value')} />}
        </Field>
        <Field label="Aplicar em" className="c-12">
          <Segmented value={p.scope} onChange={(s) => setP({ ...p, scope: s, scope_value: '' })} options={[{ value: 'all', label: 'Loja toda' }, { value: 'category', label: 'Categoria' }, { value: 'brand', label: 'Marca' }, { value: 'product', label: 'Produto' }]} />
        </Field>
        {p.scope !== 'all' && (
          <Field label="Selecione" className="c-12">
            <select className="select" value={p.scope_value} onChange={set('scope_value')}>
              <option value="">—</option>
              {p.scope === 'category' && options?.categories.map((c) => <option key={c}>{c}</option>)}
              {p.scope === 'brand' && options?.brands.map((c) => <option key={c}>{c}</option>)}
              {p.scope === 'product' && products?.map((c) => <option key={c.id} value={c.id}>{c.name} — {brl(c.sale_price)}</option>)}
            </select>
          </Field>
        )}
        <Field label="Início" className="c-6"><input type="date" className="input" value={p.start_date || ''} onChange={set('start_date')} /></Field>
        <Field label="Fim" className="c-6"><input type="date" className="input" value={p.end_date || ''} onChange={set('end_date')} /></Field>
        <label className="checkbox c-12"><input type="checkbox" checked={!!p.active} onChange={(e) => setP({ ...p, active: e.target.checked })} />Promoção ativa</label>
      </div>
      <div className="small muted mt">O preço promocional aparece automaticamente no PDV. Se houver mais de uma promoção para o mesmo produto, vale a de maior desconto.</div>
    </Modal>
  );
}

export default function Promocoes() {
  const { isAdmin } = useApp();
  const [params, setParams] = useSearchParams();
  const fromStale = params.get('product');
  const [editing, setEditing] = useState(fromStale ? { name: `Liquidação ${params.get('name') || ''}`.trim(), scope: 'product', scope_value: fromStale, value: params.get('discount') || 20 } : null);
  const confirm = useConfirm();
  const { data, loading, reload } = useLoad('promotions.list', {}, []);
  const now = today();
  const status = (p) => (!p.active ? ['', 'Inativa'] : p.end_date && p.end_date < now ? ['', 'Encerrada'] : p.start_date && p.start_date > now ? ['badge-info', 'Agendada'] : ['badge-success', 'Ativa agora']);
  const scopeLabel = (p) => (p.scope === 'all' ? 'Loja toda' : p.scope === 'category' ? `Categoria: ${p.scope_value}` : p.scope === 'brand' ? `Marca: ${p.scope_value}` : `Produto: ${p.product_name || p.scope_value}`);
  return (
    <>
      <PageHeader title="Promoções" sub="Descontos automáticos aplicados no PDV">
        {isAdmin && <button className="btn btn-primary" onClick={() => setEditing({})}><Plus size={16} />Nova promoção</button>}
      </PageHeader>
      <div className="card">
        {loading && !data ? <Loading /> : !data?.length ? <Empty icon={<Tag size={34} />}>Nenhuma promoção cadastrada.</Empty> : (
          <table className="table">
            <thead><tr><th>Promoção</th><th>Desconto</th><th>Aplica em</th><th>Período</th><th>Situação</th><th /></tr></thead>
            <tbody>{data.map((p) => {
              const [cls, label] = status(p);
              return (
                <tr key={p.id} className={isAdmin ? 'clickable' : ''} onClick={() => isAdmin && setEditing({ ...p, active: !!p.active })}>
                  <td className="strong">{p.name}</td><td>{p.discount_type === 'percent' ? `${p.value}%` : brl(p.value)}</td><td>{scopeLabel(p)}</td>
                  <td>{p.start_date ? date(p.start_date) : '—'} a {p.end_date ? date(p.end_date) : 'sem fim'}</td>
                  <td><span className={`badge ${cls}`}>{label}</span></td>
                  <td className="actions-cell" onClick={(e) => e.stopPropagation()}>{isAdmin && <button className="btn btn-ghost btn-icon" onClick={async () => { if (await confirm({ message: 'Excluir promoção?', danger: true })) { await api('promotions.delete', { id: p.id }); reload(); } }}><Trash2 size={15} /></button>}</td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </div>
      {editing && <PromoForm initial={editing} onClose={() => { setEditing(null); setParams({}); }} onSaved={() => { setEditing(null); setParams({}); reload(); }} />}
    </>
  );
}
