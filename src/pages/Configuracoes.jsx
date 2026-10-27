import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Save, Printer, Cloud, Usb, FolderOpen, Trash2, HardDrive, Upload, Plus, CircleCheck, TriangleAlert, RefreshCw } from 'lucide-react';
import { api, isElectron } from '../api';
import { useApp } from '../App';
import { Modal, Field, useLoad, useAction, useConfirm, PageHeader, Loading, Tabs, Empty, useToast } from '../components/ui';
import { dateTime, bytes } from '../lib/format';
import { printHtml, saleReceipt } from '../lib/print';

function useSettingsForm() {
  const { settings, reloadSettings } = useApp();
  const [s, setS] = useState(settings);
  const [run, busy] = useAction();
  const set = (k) => (e) => setS({ ...s, [k]: e && e.target ? (e.target.type === 'checkbox' ? (e.target.checked ? '1' : '0') : e.target.value) : e });
  const save = async (keys) => {
    const values = Object.fromEntries(keys.map((k) => [k, s[k]]));
    await run(() => api('settings.save', values), 'Configurações salvas!');
    await reloadSettings();
  };
  return { s, set, save, busy, setS };
}

function Loja() {
  const { s, set, save, busy } = useSettingsForm();
  return (
    <div className="card card-body" style={{ maxWidth: 760 }}>
      <div className="form-grid">
        <Field label="Nome da loja (aparece no cupom)" className="c-8"><input className="input" value={s.store_name} onChange={set('store_name')} /></Field>
        <Field label="CNPJ / CPF" className="c-4"><input className="input" value={s.store_document} onChange={set('store_document')} /></Field>
        <Field label="Endereço" className="c-8"><input className="input" value={s.store_address} onChange={set('store_address')} /></Field>
        <Field label="Telefone / WhatsApp" className="c-4"><input className="input" value={s.store_phone} onChange={set('store_phone')} /></Field>
        <Field label="Mensagem no rodapé do cupom" className="c-12"><textarea className="textarea" value={s.receipt_footer} onChange={set('receipt_footer')} /></Field>
        <Field label="Prazo para trocas (dias)" className="c-4"><input type="number" className="input" value={s.return_days} onChange={set('return_days')} /></Field>
      </div>
      <div className="row end mt"><button className="btn btn-primary" disabled={busy} onClick={() => save(['store_name', 'store_document', 'store_address', 'store_phone', 'receipt_footer', 'return_days'])}><Save size={16} />Salvar</button></div>
    </div>
  );
}

function Impressora() {
  const { s, set, save, busy } = useSettingsForm();
  const { data: printers, reload } = useLoad('print.printers', {}, []);
  const toast = useToast();
  async function test() {
    await save(['printer_name', 'printer_width', 'print_auto', 'print_silent']);
    const fake = {
      id: 123, created_at: new Date().toISOString().replace('T', ' ').slice(0, 19), user_name: 'Teste', customer_name: 'Cliente Teste', status: 'concluida',
      items: [{ description: 'Camiseta Básica Preta M', quantity: 2, unit_price: 49.9, discount: 0 }, { description: 'Calça Jeans Skinny Azul 40', quantity: 1, unit_price: 129.9, discount: 10 }],
      subtotal: 229.7, discount: 10, total: 219.7, payments: [{ method: 'dinheiro', amount: 219.7 }], change_amount: 30.3, installments: [],
    };
    try { await printHtml(saleReceipt(fake, s), s); toast.success('Enviado para a impressora.'); } catch (e) { toast.error(e.message); }
  }
  return (
    <div className="card card-body" style={{ maxWidth: 760 }}>
      <div className="alert alert-info mb small">
        <Printer size={18} />
        <div>Instale o driver Windows da impressora térmica (Elgin, Bematech, Epson, Daruma, Tanca, Knup…) e selecione-a abaixo. Com “imprimir sem perguntar” ativado o cupom sai direto, sem janela de impressão.</div>
      </div>
      <div className="form-grid">
        <Field label="Impressora de cupom" className="c-8">
          <div className="row">
            <select className="select" value={s.printer_name} onChange={set('printer_name')}>
              <option value="">Perguntar sempre (janela de impressão)</option>
              {(printers || []).map((p) => <option key={p.name} value={p.name}>{p.displayName}{p.isDefault ? ' (padrão)' : ''}</option>)}
            </select>
            <button className="btn btn-icon" title="Atualizar lista" onClick={reload}><RefreshCw size={15} /></button>
          </div>
        </Field>
        <Field label="Largura da bobina" className="c-4">
          <select className="select" value={s.printer_width} onChange={set('printer_width')}><option value="80">80 mm</option><option value="58">58 mm</option></select>
        </Field>
        <label className="checkbox c-12"><input type="checkbox" checked={s.print_silent === '1'} onChange={set('print_silent')} />Imprimir sem perguntar (direto na impressora selecionada)</label>
        <label className="checkbox c-12"><input type="checkbox" checked={s.print_auto === '1'} onChange={set('print_auto')} />Imprimir o cupom automaticamente ao concluir cada venda</label>
      </div>
      <div className="row end mt">
        <button className="btn" onClick={test}><Printer size={16} />Imprimir teste</button>
        <button className="btn btn-primary" disabled={busy} onClick={() => save(['printer_name', 'printer_width', 'print_auto', 'print_silent'])}><Save size={16} />Salvar</button>
      </div>
    </div>
  );
}

function Backup() {
  const { s, set, save, setS } = useSettingsForm();
  const { data: info, reload } = useLoad('backup.info', {}, []);
  const { data: files, reload: reloadFiles } = useLoad('backup.list', {}, []);
  const [results, setResults] = useState(null);
  const [run, busy] = useAction();
  const confirm = useConfirm();
  const toast = useToast();
  if (!info) return <Loading />;
  const dests = JSON.parse(s.backup_folders || '[]');

  async function saveDests(list) {
    const next = { ...s, backup_folders: JSON.stringify(list) };
    setS(next);
    await api('settings.save', { backup_folders: list });
    reload();
  }
  const addFolder = (d) => { if (!dests.some((x) => x.type === d.type && x.path === d.path)) saveDests([...dests, d]); };

  async function chooseFolder() {
    const folder = await api('system.chooseFolder', { title: 'Escolha a pasta para os backups' });
    if (folder) addFolder({ type: 'folder', path: folder, label: folder });
  }
  async function runNow() {
    const r = await run(() => api('backup.run'));
    setResults(r);
    reload(); reloadFiles();
    if (r.every((x) => x.ok)) toast.success('Backup concluído!');
  }
  async function toDrive(drive) {
    const file = await run(() => api('backup.runTo', { folder: `${drive.drive}\\Backup LojaUp` }), `Backup salvo no pendrive ${drive.label}`);
    setResults([{ destination: `Pendrive ${drive.label}`, ok: true, file }]);
    reload();
  }
  async function restore(file) {
    if (!file) return;
    const ok = await confirm({
      title: 'Restaurar backup', danger: true, confirmText: 'Restaurar',
      message: `Os dados atuais serão SUBSTITUÍDOS pelo backup:\n${file}\n\nUma cópia de segurança dos dados atuais será guardada antes. Depois será preciso entrar novamente. Continuar?`,
    });
    if (!ok) return;
    await run(() => api('backup.restore', { file }), 'Backup restaurado!');
    setTimeout(() => window.location.reload(), 600);
  }

  return (
    <div className="grid grid-2">
      <div className="col" style={{ gap: 16 }}>
        <div className="card">
          <div className="card-header"><HardDrive size={17} /><h3>Destinos do backup</h3></div>
          <div className="card-body col">
            {!dests.length && <div className="alert alert-danger"><TriangleAlert size={18} />Nenhum destino configurado. Se o computador estragar, os dados podem ser perdidos.</div>}
            {dests.map((d, i) => (
              <div key={i} className="row card card-body" style={{ padding: 10 }}>
                {d.type === 'pendrive' ? <Usb size={18} /> : d.label === 'OneDrive' ? <Cloud size={18} /> : <FolderOpen size={18} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="strong">{d.type === 'pendrive' ? 'Pendrive (qualquer um conectado)' : d.label}</div>
                  <div className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.type === 'pendrive' ? 'Salva na pasta "Backup LojaUp" de cada pendrive conectado no momento do backup' : d.path}</div>
                </div>
                <button className="btn btn-ghost btn-icon" onClick={() => saveDests(dests.filter((_, j) => j !== i))}><Trash2 size={15} /></button>
              </div>
            ))}
            <div className="row wrap">
              {info.oneDrive.map((p) => (
                <button key={p} className="btn" onClick={() => addFolder({ type: 'folder', path: `${p}\\Backup LojaUp`, label: 'OneDrive' })}><Cloud size={16} />Usar OneDrive{info.oneDrive.length > 1 ? ` (${p.split('\\').pop()})` : ''}</button>
              ))}
              {!dests.some((d) => d.type === 'pendrive') && <button className="btn" onClick={() => addFolder({ type: 'pendrive' })}><Usb size={16} />Pendrive</button>}
              {isElectron() && <button className="btn" onClick={chooseFolder}><Plus size={16} />Outra pasta…</button>}
            </div>
            {!info.oneDrive.length && <div className="small muted">OneDrive não encontrado neste computador. Instale e entre com a conta Microsoft para ter backup na nuvem.</div>}
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h3>Backup automático</h3></div>
          <div className="card-body form-grid">
            <label className="checkbox c-12"><input type="checkbox" checked={s.backup_auto_on_close === '1'} onChange={set('backup_auto_on_close')} />Fazer backup sempre que o sistema for fechado</label>
            <Field label="Também a cada (horas)" className="c-6" hint="0 = desativado"><input type="number" className="input" value={s.backup_interval_hours} onChange={set('backup_interval_hours')} /></Field>
            <Field label="Manter os últimos" className="c-6" hint="backups em cada destino"><input type="number" className="input" value={s.backup_keep} onChange={set('backup_keep')} /></Field>
            <div className="c-12 row end"><button className="btn btn-primary" onClick={() => save(['backup_auto_on_close', 'backup_interval_hours', 'backup_keep'])}><Save size={16} />Salvar</button></div>
          </div>
        </div>
      </div>

      <div className="col" style={{ gap: 16 }}>
        <div className="card">
          <div className="card-header"><h3>Fazer backup agora</h3></div>
          <div className="card-body col">
            <div className="small muted">Último backup: <b>{info.lastBackup ? dateTime(info.lastBackup) : 'nunca'}</b> · Banco de dados: {bytes(info.dbSize)}</div>
            <button className="btn btn-primary btn-lg" disabled={busy} onClick={runNow}><Save size={18} />{busy ? 'Copiando…' : 'Fazer backup em todos os destinos'}</button>
            {info.drives.length > 0 && (
              <div className="row wrap">{info.drives.map((d) => <button key={d.drive} className="btn" disabled={busy} onClick={() => toDrive(d)}><Usb size={16} />Só no pendrive {d.label} ({d.drive})</button>)}</div>
            )}
            {results && results.map((r, i) => (
              <div key={i} className={`alert ${r.ok ? 'alert-success' : 'alert-danger'} small`}>
                {r.ok ? <CircleCheck size={16} /> : <TriangleAlert size={16} />}
                <div><b>{r.destination}</b>: {r.ok ? r.file : r.error}</div>
              </div>
            ))}
            <div className="small muted">Local do banco: <span className="mono">{info.dbPath}</span></div>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><Upload size={17} /><h3>Restaurar backup</h3>
            <div className="actions">{isElectron() && <button className="btn btn-sm" onClick={async () => restore(await api('system.chooseFile', { title: 'Escolha o arquivo de backup' }))}>Escolher arquivo…</button>}</div>
          </div>
          {!files?.length ? <Empty>Nenhum backup encontrado nas pastas configuradas.</Empty> : (
            <div className="table-wrap" style={{ maxHeight: 260 }}>
              <table className="table table-compact">
                <tbody>{files.map((f) => (
                  <tr key={f.file}><td className="small">{dateTime(f.date.replace('T', ' '))}<div className="muted" style={{ fontSize: 11 }}>{f.folder}</div></td><td className="num small">{bytes(f.size)}</td>
                    <td className="actions-cell"><button className="btn btn-sm" onClick={() => restore(f.file)}>Restaurar</button></td></tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-header"><h3>Histórico</h3></div>
          {!info.log.length ? <Empty>Nenhum backup registrado.</Empty> : (
            <div className="table-wrap" style={{ maxHeight: 220 }}>
              <table className="table table-compact"><tbody>{info.log.map((l) => (
                <tr key={l.id}><td className="small nowrap">{dateTime(l.created_at)}</td><td className="small">{l.destination}</td><td>{l.status === 'ok' ? <span className="badge badge-success">ok</span> : <span className="badge badge-danger" title={l.message}>erro</span>}</td><td className="small muted">{l.message}</td></tr>
              ))}</tbody></table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Usuarios() {
  const { user } = useApp();
  const { data, reload } = useLoad('users.list', {}, []);
  const [editing, setEditing] = useState(null);
  const [run, busy] = useAction();
  return (
    <>
      <div className="row mb"><div className="small muted">Vendedores acessam PDV, caixa, vendas, produtos, estoque e clientes. Administradores acessam tudo (financeiro, relatórios, custos e configurações).</div><div className="spacer" /><button className="btn btn-primary" onClick={() => setEditing({ role: 'vendedor', active: true })}><Plus size={16} />Novo usuário</button></div>
      <div className="card" style={{ maxWidth: 900 }}>
        {!data ? <Loading /> : (
          <table className="table">
            <thead><tr><th>Nome</th><th>Usuário</th><th>Perfil</th><th>Situação</th><th>Criado em</th></tr></thead>
            <tbody>{data.map((u) => (
              <tr key={u.id} className={`clickable ${u.active ? '' : 'dim'}`} onClick={() => setEditing({ ...u, active: !!u.active, password: '' })}>
                <td className="strong">{u.name}{u.id === user.id && <span className="badge" style={{ marginLeft: 6 }}>você</span>}</td><td>{u.username}</td>
                <td><span className={`badge ${u.role === 'admin' ? 'badge-primary' : ''}`}>{u.role === 'admin' ? 'Administrador' : 'Vendedor'}</span></td>
                <td>{u.active ? <span className="badge badge-success">Ativo</span> : <span className="badge">Inativo</span>}</td><td>{dateTime(u.created_at)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      {editing && (
        <Modal title={editing.id ? 'Editar usuário' : 'Novo usuário'} onClose={() => setEditing(null)} size="sm"
          footer={<><button className="btn" onClick={() => setEditing(null)}>Cancelar</button><button className="btn btn-primary" disabled={busy} onClick={async () => { await run(() => api('users.save', editing), 'Usuário salvo!'); setEditing(null); reload(); }}>Salvar</button></>}>
          <div className="col">
            <Field label="Nome"><input className="input" autoFocus value={editing.name || ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
            <Field label="Usuário (login)"><input className="input" value={editing.username || ''} onChange={(e) => setEditing({ ...editing, username: e.target.value })} /></Field>
            <Field label={editing.id ? 'Nova senha (deixe em branco para manter)' : 'Senha'}><input type="password" className="input" value={editing.password || ''} onChange={(e) => setEditing({ ...editing, password: e.target.value })} /></Field>
            <Field label="Perfil"><select className="select" value={editing.role} onChange={(e) => setEditing({ ...editing, role: e.target.value })}><option value="vendedor">Vendedor</option><option value="admin">Administrador</option></select></Field>
            {editing.id && <label className="checkbox"><input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} />Usuário ativo</label>}
          </div>
        </Modal>
      )}
    </>
  );
}

function Regras() {
  const { s, set, save, busy } = useSettingsForm();
  const keys = ['max_discount_percent_seller', 'card_max_installments', 'credit_max_installments', 'credit_late_fee_percent', 'credit_interest_month_percent', 'credit_block_overdue_days', 'default_min_stock', 'stale_days'];
  const num = (k, label, hint) => <Field label={label} hint={hint} className="c-4"><input type="number" className="input" value={s[k]} onChange={set(k)} /></Field>;
  return (
    <div className="card card-body" style={{ maxWidth: 900 }}>
      <div className="strong mb" style={{ marginBottom: 8 }}>Vendas</div>
      <div className="form-grid mb">
        {num('max_discount_percent_seller', 'Desconto máximo do vendedor (%)', 'Acima disso pede senha do administrador')}
        {num('card_max_installments', 'Máximo de parcelas no cartão')}
      </div>
      <div className="strong mb" style={{ marginBottom: 8 }}>Crediário</div>
      <div className="form-grid mb">
        {num('credit_max_installments', 'Máximo de parcelas')}
        {num('credit_late_fee_percent', 'Multa por atraso (%)')}
        {num('credit_interest_month_percent', 'Juros de mora (% ao mês)')}
        {num('credit_block_overdue_days', 'Bloquear crediário com atraso acima de (dias)', '0 = não bloquear')}
      </div>
      <div className="strong mb" style={{ marginBottom: 8 }}>Estoque</div>
      <div className="form-grid">
        {num('default_min_stock', 'Estoque mínimo padrão (novos produtos)')}
        {num('stale_days', 'Considerar encalhado após (dias sem vender)')}
      </div>
      <div className="row end mt"><button className="btn btn-primary" disabled={busy} onClick={() => save(keys)}><Save size={16} />Salvar</button></div>
    </div>
  );
}

function Senha() {
  const [f, setF] = useState({ current: '', password: '', password2: '' });
  const [run, busy] = useAction();
  const toast = useToast();
  return (
    <div className="card card-body col" style={{ maxWidth: 420 }}>
      <Field label="Senha atual"><input type="password" className="input" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></Field>
      <Field label="Nova senha"><input type="password" className="input" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
      <Field label="Repita a nova senha"><input type="password" className="input" value={f.password2} onChange={(e) => setF({ ...f, password2: e.target.value })} /></Field>
      <button className="btn btn-primary" disabled={busy} onClick={async () => {
        if (f.password !== f.password2) { toast.error('As senhas não conferem.'); return; }
        await run(() => api('auth.changePassword', f), 'Senha alterada!');
        setF({ current: '', password: '', password2: '' });
      }}>Alterar senha</button>
    </div>
  );
}

export default function Configuracoes() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState(params.get('tab') || 'loja');
  return (
    <>
      <PageHeader title="Configurações" />
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'loja', label: 'Dados da loja' }, { id: 'impressora', label: 'Impressora' }, { id: 'backup', label: 'Backup' },
        { id: 'usuarios', label: 'Usuários' }, { id: 'regras', label: 'Regras e limites' }, { id: 'senha', label: 'Minha senha' },
      ]} />
      {tab === 'loja' && <Loja />}
      {tab === 'impressora' && <Impressora />}
      {tab === 'backup' && <Backup />}
      {tab === 'usuarios' && <Usuarios />}
      {tab === 'regras' && <Regras />}
      {tab === 'senha' && <Senha />}
    </>
  );
}
