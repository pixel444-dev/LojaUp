import { useState } from 'react';
import { Plus, Search, Building2, Trash2 } from 'lucide-react';
import { api } from '../api';
import { Modal, Field, useLoad, useAction, useConfirm, PageHeader, Empty, Loading, Tabs, StatusBadge } from '../components/ui';
import { brl, date, formatPhone } from '../lib/format';

function SupplierForm({ initial, onClose, onSaved }) {
  const [s, setS] = useState({ name: '', document: '', phone: '', email: '', contact: '', address: '', notes: '', ...initial });
  const [run, busy] = useAction();
  const set = (k) => (e) => setS({ ...s, [k]: e.target.value });
  return (
    <Modal title={s.id ? 'Editar fornecedor' : 'Novo fornecedor'} onClose={onClose} size="lg"
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={busy} onClick={async () => onSaved(await run(() => api('suppliers.save', s), 'Fornecedor salvo!'))}>Salvar</button></>}>
      <div className="form-grid">
        <Field label="Razão social / nome *" className="c-8"><input className="input" autoFocus value={s.name} onChange={set('name')} /></Field>
        <Field label="CNPJ / CPF" className="c-4"><input className="input" value={s.document || ''} onChange={set('document')} /></Field>
        <Field label="Contato (vendedor/representante)" className="c-4"><input className="input" value={s.contact || ''} onChange={set('contact')} /></Field>
        <Field label="Telefone / WhatsApp" className="c-4"><input className="input" value={formatPhone(s.phone)} onChange={set('phone')} /></Field>
        <Field label="E-mail" className="c-4"><input className="input" value={s.email || ''} onChange={set('email')} /></Field>
        <Field label="Endereço" className="c-12"><input className="input" value={s.address || ''} onChange={set('address')} /></Field>
        <Field label="Observações (prazos, pedido mínimo, condições)" className="c-12"><textarea className="textarea" value={s.notes || ''} onChange={set('notes')} /></Field>
      </div>
    </Modal>
  );
}

function SupplierDetail({ id, onClose, onEdit }) {
  const { data: s } = useLoad('suppliers.get', { id }, [id]);
  if (!s) return null;
  return (
    <Modal title={s.name} onClose={onClose} size="xl" footer={<button className="btn" onClick={() => onEdit(s)}>Editar</button>}>
      <div className="row wrap mb small" style={{ gap: 20 }}>
        {s.document && <span>CNPJ/CPF: <b>{s.document}</b></span>}{s.contact && <span>Contato: <b>{s.contact}</b></span>}
        {s.phone && <span>Tel: <b>{formatPhone(s.phone)}</b></span>}{s.email && <span>{s.email}</span>}
      </div>
      {s.notes && <div className="alert alert-info mb small">{s.notes}</div>}
      <div className="grid grid-2">
        <div className="card">
          <div className="card-header"><h3>Produtos comprados</h3></div>
          {!s.products.length ? <Empty>Nenhuma compra registrada.</Empty> : (
            <table className="table table-compact"><thead><tr><th>Produto</th><th className="num">Peças</th><th className="num">Custo médio</th><th>Última</th></tr></thead>
              <tbody>{s.products.map((p) => <tr key={p.id}><td>{p.name}</td><td className="num">{p.qty}</td><td className="num">{brl(p.avg_cost)}</td><td>{date(p.last_date)}</td></tr>)}</tbody></table>
          )}
        </div>
        <div className="card">
          <div className="card-header"><h3>Contas em aberto</h3></div>
          {!s.payables.length ? <Empty>Nada a pagar.</Empty> : (
            <table className="table table-compact"><tbody>{s.payables.map((p) => <tr key={p.id}><td>{p.description} {p.installment_label}</td><td>{date(p.due_date)}</td><td className="num strong">{brl(p.amount)}</td></tr>)}</tbody></table>
          )}
          <div className="card-header" style={{ borderTop: '1px solid var(--border)' }}><h3>Compras</h3></div>
          <table className="table table-compact"><tbody>{s.purchases.slice(0, 15).map((p) => <tr key={p.id}><td>#{p.id}</td><td>{date(p.purchase_date)}</td><td>{p.invoice_number}</td><td className="num">{brl(p.total)}</td><td><StatusBadge status={p.status} /></td></tr>)}</tbody></table>
        </div>
      </div>
    </Modal>
  );
}

function PriceComparison() {
  const [search, setSearch] = useState('');
  const { data, loading } = useLoad('suppliers.priceComparison', { search }, [search]);
  return (
    <>
      <div className="row mb">
        <div className="input-group" style={{ width: 320 }}><Search size={16} className="icon" /><input className="input" placeholder="Filtrar produto" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <span className="small muted">Comparação baseada no custo final (com frete) das compras registradas.</span>
      </div>
      {loading && !data ? <Loading /> : !data?.length ? <div className="card"><Empty>Registre compras para comparar preços entre fornecedores.</Empty></div> : (
        <div className="col" style={{ gap: 12 }}>
          {data.map((p) => (
            <div key={p.product_id} className="card">
              <div className="card-header">
                <h3>{p.product_name}</h3><span className="muted small">{[p.brand, p.model].filter(Boolean).join(' · ')}</span>
                <div className="actions">
                  {p.suppliers.length > 1 && p.saving_percent > 0 && <span className="badge badge-success">{p.best_supplier} é {p.saving_percent}% mais barato</span>}
                  <span className="badge">Venda {brl(p.sale_price)}</span>
                </div>
              </div>
              <table className="table table-compact">
                <thead><tr><th>Fornecedor</th><th className="num">Compras</th><th className="num">Peças</th><th className="num">Último custo</th><th className="num">Médio</th><th className="num">Menor</th><th className="num">Maior</th><th className="num">Margem (último)</th><th>Última compra</th></tr></thead>
                <tbody>{p.suppliers.map((s) => (
                  <tr key={s.supplier_id} style={s.supplier_name === p.best_supplier && p.suppliers.length > 1 ? { background: 'var(--success-soft)' } : null}>
                    <td className="strong">{s.supplier_name}</td><td className="num">{s.times}</td><td className="num">{s.qty}</td>
                    <td className="num strong">{brl(s.last_cost)}</td><td className="num">{brl(s.avg_cost)}</td><td className="num">{brl(s.min_cost)}</td><td className="num">{brl(s.max_cost)}</td>
                    <td className="num">{p.sale_price ? `${Math.round((1 - s.last_cost / p.sale_price) * 100)}%` : '—'}</td><td>{date(s.last_date)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export default function Fornecedores() {
  const [tab, setTab] = useState('lista');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [open, setOpen] = useState(null);
  const confirm = useConfirm();
  const { data, loading, reload } = useLoad('suppliers.list', { search }, [search]);
  return (
    <>
      <PageHeader title="Fornecedores" sub="Cadastro, histórico de compras e comparação de preços">
        <button className="btn btn-primary" onClick={() => setEditing({})}><Plus size={16} />Novo fornecedor</button>
      </PageHeader>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'lista', label: 'Fornecedores' }, { id: 'comparar', label: 'Comparar preços' }]} />
      {tab === 'comparar' ? <PriceComparison /> : (
        <>
          <div className="row mb"><div className="input-group" style={{ width: 320 }}><Search size={16} className="icon" /><input className="input" placeholder="Buscar fornecedor" value={search} onChange={(e) => setSearch(e.target.value)} /></div></div>
          <div className="card">
            {loading && !data ? <Loading /> : !data?.length ? <Empty icon={<Building2 size={34} />}>Nenhum fornecedor cadastrado.</Empty> : (
              <table className="table">
                <thead><tr><th>Nome</th><th>Contato</th><th>Telefone</th><th className="num">Compras</th><th className="num">Total comprado</th><th>Última compra</th><th className="num">A pagar</th><th /></tr></thead>
                <tbody>{data.map((s) => (
                  <tr key={s.id} className="clickable" onClick={() => setOpen(s.id)}>
                    <td className="strong">{s.name}<div className="small muted">{s.document}</div></td><td>{s.contact}</td><td>{formatPhone(s.phone)}</td>
                    <td className="num">{s.purchase_count}</td><td className="num">{brl(s.purchase_total)}</td><td>{s.last_purchase ? date(s.last_purchase) : '—'}</td>
                    <td className="num">{s.open_payables ? <span className="badge badge-warning">{brl(s.open_payables)}</span> : '—'}</td>
                    <td className="actions-cell" onClick={(e) => e.stopPropagation()}>
                      <button className="btn btn-ghost btn-icon" onClick={async () => { if (await confirm({ message: `Remover ${s.name}?`, danger: true })) { await api('suppliers.delete', { id: s.id }); reload(); } }}><Trash2 size={15} /></button>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        </>
      )}
      {editing && <SupplierForm initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {open && <SupplierDetail id={open} onClose={() => setOpen(null)} onEdit={(s) => { setOpen(null); setEditing(s); }} />}
    </>
  );
}
