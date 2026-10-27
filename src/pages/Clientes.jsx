import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { UserPlus, Search, Users } from 'lucide-react';
import { api } from '../api';
import { useApp } from '../App';
import { Modal, Field, MoneyInput, useLoad, useAction, PageHeader, Empty, Loading, Segmented } from '../components/ui';
import { brl, date, formatCpf, formatPhone } from '../lib/format';

export function CustomerForm({ initial = {}, onClose, onSaved }) {
  const { isAdmin } = useApp();
  const [c, setC] = useState({ name: '', cpf: '', phone: '', email: '', birth_date: '', address: '', city: '', credit_limit: 0, notes: '', ...initial });
  const [run, busy] = useAction();
  const set = (k) => (e) => setC({ ...c, [k]: e.target ? e.target.value : e });
  async function save(e) {
    e?.preventDefault();
    const id = await run(() => api('customers.save', c), 'Cliente salvo!');
    onSaved(id);
  }
  return (
    <Modal title={c.id ? 'Editar cliente' : 'Novo cliente'} onClose={onClose} size="lg"
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={busy} onClick={save}>Salvar</button></>}>
      <form className="form-grid" onSubmit={save}>
        <Field label="Nome completo *" className="c-8"><input className="input" autoFocus value={c.name} onChange={set('name')} /></Field>
        <Field label="CPF" className="c-4"><input className="input" value={formatCpf(c.cpf)} onChange={set('cpf')} /></Field>
        <Field label="Telefone / WhatsApp" className="c-4"><input className="input" value={formatPhone(c.phone)} onChange={set('phone')} /></Field>
        <Field label="E-mail" className="c-5"><input className="input" value={c.email || ''} onChange={set('email')} /></Field>
        <Field label="Nascimento" className="c-3"><input type="date" className="input" value={c.birth_date || ''} onChange={set('birth_date')} /></Field>
        <Field label="Endereço" className="c-8"><input className="input" value={c.address || ''} onChange={set('address')} /></Field>
        <Field label="Cidade" className="c-4"><input className="input" value={c.city || ''} onChange={set('city')} /></Field>
        <Field label="Limite de crédito (crediário)" className="c-4" hint={isAdmin ? 'R$ 0 = não pode comprar no crediário' : 'Somente o administrador altera'}>
          <MoneyInput value={c.credit_limit} onChange={set('credit_limit')} disabled={!isAdmin} />
        </Field>
        <Field label="Observações" className="c-8"><input className="input" value={c.notes || ''} onChange={set('notes')} placeholder="Ex.: prefere tamanho M, gosta de jeans" /></Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

export default function Clientes() {
  const [params] = useSearchParams();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState(params.get('filter') || '');
  const [editing, setEditing] = useState(null);
  const nav = useNavigate();
  const { data, loading, reload } = useLoad('customers.list', { search, filter }, [search, filter]);

  return (
    <>
      <PageHeader title="Clientes" sub="Cadastro, histórico de compras e crediário">
        <button className="btn btn-primary" onClick={() => setEditing({})}><UserPlus size={16} />Novo cliente</button>
      </PageHeader>
      <div className="row mb wrap">
        <div className="input-group" style={{ width: 340 }}>
          <Search size={16} className="icon" />
          <input className="input" placeholder="Buscar por nome, CPF ou telefone" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Segmented value={filter} onChange={setFilter} options={[
          { value: '', label: 'Todos' }, { value: 'devedores', label: 'Com saldo devedor' }, { value: 'atrasados', label: 'Em atraso' }, { value: 'aniversariantes', label: 'Aniversariantes do mês' },
        ]} />
      </div>
      <div className="card">
        {loading && !data ? <Loading /> : !data?.length ? <Empty icon={<Users size={34} />}>Nenhum cliente encontrado.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Nome</th><th>CPF</th><th>Telefone</th><th>Aniversário</th><th>Última compra</th><th className="num">Total comprado</th><th className="num">Em aberto</th><th className="num">Atrasado</th><th className="num">Limite</th></tr></thead>
              <tbody>
                {data.map((c) => (
                  <tr key={c.id} className="clickable" onClick={() => nav(`/clientes/${c.id}`)}>
                    <td className="strong">{c.name}</td>
                    <td>{formatCpf(c.cpf)}</td>
                    <td>{formatPhone(c.phone)}</td>
                    <td>{c.birth_date ? date(c.birth_date).slice(0, 5) : '—'}</td>
                    <td>{c.last_purchase ? date(c.last_purchase) : '—'}</td>
                    <td className="num">{brl(c.total_spent)}</td>
                    <td className="num">{c.balance > 0 ? brl(c.balance) : '—'}</td>
                    <td className="num">{c.overdue > 0 ? <span className="badge badge-danger">{brl(c.overdue)}</span> : '—'}</td>
                    <td className="num">{brl(c.credit_limit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {editing && <CustomerForm initial={editing} onClose={() => setEditing(null)} onSaved={(id) => { setEditing(null); reload(); nav(`/clientes/${id}`); }} />}
    </>
  );
}
