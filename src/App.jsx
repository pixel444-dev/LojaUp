import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, ShoppingCart, Wallet, Receipt, Shirt, Boxes, Truck, Building2, Landmark, Users, CreditCard,
  ChartColumn, Tag, Settings, LogOut, Store, Lock,
} from 'lucide-react';
import { api } from './api';
import { Field } from './components/ui';
import Dashboard from './pages/Dashboard';
import PDV from './pages/PDV';
import Caixa from './pages/Caixa';
import Vendas from './pages/Vendas';
import Produtos from './pages/Produtos';
import Estoque from './pages/Estoque';
import Compras from './pages/Compras';
import Fornecedores from './pages/Fornecedores';
import Financeiro from './pages/Financeiro';
import Clientes from './pages/Clientes';
import ClienteDetalhe from './pages/ClienteDetalhe';
import Crediario from './pages/Crediario';
import Relatorios from './pages/Relatorios';
import Promocoes from './pages/Promocoes';
import Configuracoes from './pages/Configuracoes';

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

const NAV = [
  { section: 'Loja' },
  { to: '/painel', label: 'Painel', icon: LayoutDashboard, admin: true },
  { to: '/pdv', label: 'Vender (PDV)', icon: ShoppingCart },
  { to: '/caixa', label: 'Caixa', icon: Wallet },
  { to: '/vendas', label: 'Vendas e trocas', icon: Receipt },
  { section: 'Mercadorias' },
  { to: '/produtos', label: 'Produtos', icon: Shirt },
  { to: '/estoque', label: 'Estoque', icon: Boxes },
  { to: '/compras', label: 'Compras', icon: Truck, admin: true },
  { to: '/fornecedores', label: 'Fornecedores', icon: Building2, admin: true },
  { to: '/promocoes', label: 'Promoções', icon: Tag },
  { section: 'Clientes' },
  { to: '/clientes', label: 'Clientes', icon: Users },
  { to: '/crediario', label: 'Crediário', icon: CreditCard, badge: 'overdue' },
  { section: 'Gestão', admin: true },
  { to: '/financeiro', label: 'Financeiro', icon: Landmark, admin: true },
  { to: '/relatorios', label: 'Relatórios', icon: ChartColumn, admin: true },
  { to: '/configuracoes', label: 'Configurações', icon: Settings, admin: true },
];

const TITLES = {
  '/painel': 'Painel do dono', '/pdv': 'Frente de caixa', '/caixa': 'Caixa', '/vendas': 'Vendas e trocas', '/produtos': 'Produtos',
  '/estoque': 'Estoque', '/compras': 'Compras', '/fornecedores': 'Fornecedores', '/promocoes': 'Promoções', '/clientes': 'Clientes',
  '/crediario': 'Crediário', '/financeiro': 'Financeiro', '/relatorios': 'Relatórios', '/configuracoes': 'Configurações',
};

function Login({ status, onLogged }) {
  const setup = status.needsSetup;
  const [form, setForm] = useState({ storeName: '', name: '', username: '', password: '', password2: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  async function submit(e) {
    e.preventDefault();
    setError('');
    if (setup && form.password !== form.password2) { setError('As senhas não conferem.'); return; }
    setBusy(true);
    try {
      const user = await api(setup ? 'auth.setup' : 'auth.login', form);
      onLogged(user);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return (
    <div className="login-page">
      <form className="card login-card" onSubmit={submit}>
        <div className="brand-logo" style={{ width: 46, height: 46, borderRadius: 12 }}><Store size={24} color="#fff" /></div>
        <h1>{setup ? 'Bem-vindo ao LojaUp' : status.storeName}</h1>
        <div className="muted" style={{ marginBottom: 20 }}>{setup ? 'Vamos configurar sua loja. Crie o usuário administrador.' : 'Entre com seu usuário para continuar.'}</div>
        <div className="col" style={{ gap: 12 }}>
          {setup && <Field label="Nome da loja"><input className="input" required autoFocus value={form.storeName} onChange={set('storeName')} /></Field>}
          {setup && <Field label="Seu nome"><input className="input" required value={form.name} onChange={set('name')} /></Field>}
          <Field label="Usuário"><input className="input" required autoFocus={!setup} value={form.username} onChange={set('username')} /></Field>
          <Field label="Senha"><input className="input" type="password" required value={form.password} onChange={set('password')} /></Field>
          {setup && <Field label="Repita a senha"><input className="input" type="password" required value={form.password2} onChange={set('password2')} /></Field>}
          {error && <div className="alert alert-danger">{error}</div>}
          <button className="btn btn-primary btn-lg btn-block" disabled={busy}>{setup ? 'Criar e entrar' : 'Entrar'}</button>
        </div>
      </form>
    </div>
  );
}

function Layout({ children }) {
  const { user, settings, cash, logout, overdueCount } = useApp();
  const loc = useLocation();
  const base = '/' + loc.pathname.split('/')[1];
  const isAdmin = user.role === 'admin';
  const flush = base === '/pdv';
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo"><Store size={19} color="#fff" /></div>
          <div><div className="brand-name">LojaUp</div><div className="brand-store">{settings.store_name}</div></div>
        </div>
        {NAV.filter((n) => isAdmin || !n.admin).map((n, i) => n.section
          ? <div key={i} className="nav-section">{n.section}</div>
          : (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <n.icon size={18} />{n.label}
              {n.badge === 'overdue' && overdueCount > 0 && <span className="nav-badge">{overdueCount}</span>}
            </NavLink>
          ))}
        <div className="sidebar-footer">
          <div className="user-chip">
            <div className="user-avatar">{user.name.slice(0, 2).toUpperCase()}</div>
            <div style={{ minWidth: 0 }}><div className="strong" style={{ fontSize: 13 }}>{user.name}</div><div style={{ fontSize: 11.5, color: 'var(--sidebar-text)' }}>{isAdmin ? 'Administrador' : 'Vendedor'}</div></div>
          </div>
          <button className="nav-link" style={{ width: '100%', border: 0, background: 'none', cursor: 'pointer' }} onClick={logout}><LogOut size={18} />Sair</button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="topbar-title">{TITLES[base] || 'LojaUp'}</div>
          <div className="topbar-right">
            {cash
              ? <NavLink to="/caixa" className="badge badge-success" style={{ padding: '5px 10px' }}>● Caixa aberto</NavLink>
              : <NavLink to="/caixa" className="badge badge-danger" style={{ padding: '5px 10px' }}><Lock size={12} /> Caixa fechado</NavLink>}
            <span className="muted small">{new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}</span>
          </div>
        </header>
        <div className={`content ${flush ? 'flush' : ''}`}>{children}</div>
      </div>
    </div>
  );
}

export default function App() {
  const [status, setStatus] = useState(null);
  const [user, setUser] = useState(null);
  const [settings, setSettings] = useState(null);
  const [cash, setCash] = useState(null);
  const [overdueCount, setOverdueCount] = useState(0);
  const [bootError, setBootError] = useState('');

  const reloadSettings = useCallback(async () => setSettings(await api('settings.get')), []);
  const reloadCash = useCallback(async () => {
    setCash(await api('cash.current'));
    try {
      const list = await api('installments.list', { status: 'vencida' });
      setOverdueCount(new Set(list.map((i) => i.customer_id)).size);
    } catch (e) { /* ignora */ }
  }, []);

  useEffect(() => {
    api('auth.status').then((s) => { setStatus(s); if (s.user) setUser(s.user); })
      .catch((e) => setBootError(e.message));
  }, []);
  useEffect(() => {
    if (user) { reloadSettings(); reloadCash(); }
  }, [user, reloadSettings, reloadCash]);

  async function logout() {
    await api('auth.logout');
    setUser(null); setSettings(null);
    setStatus(await api('auth.status'));
  }

  if (bootError) return <div className="login-page"><div className="alert alert-danger">Não foi possível iniciar: {bootError}</div></div>;
  if (!status) return null;
  if (!user) return <Login status={status} onLogged={setUser} />;
  if (!settings) return null;

  const isAdmin = user.role === 'admin';
  const home = isAdmin ? '/painel' : '/pdv';
  const adminOnly = (el) => (isAdmin ? el : <Navigate to="/pdv" replace />);

  return (
    <AppCtx.Provider value={{ user, isAdmin, settings, reloadSettings, cash, reloadCash, logout, overdueCount }}>
      <Layout>
        <Routes>
          <Route path="/" element={<Navigate to={home} replace />} />
          <Route path="/painel" element={adminOnly(<Dashboard />)} />
          <Route path="/pdv" element={<PDV />} />
          <Route path="/caixa" element={<Caixa />} />
          <Route path="/vendas" element={<Vendas />} />
          <Route path="/produtos" element={<Produtos />} />
          <Route path="/estoque" element={<Estoque />} />
          <Route path="/compras" element={adminOnly(<Compras />)} />
          <Route path="/fornecedores" element={adminOnly(<Fornecedores />)} />
          <Route path="/promocoes" element={<Promocoes />} />
          <Route path="/clientes" element={<Clientes />} />
          <Route path="/clientes/:id" element={<ClienteDetalhe />} />
          <Route path="/crediario" element={<Crediario />} />
          <Route path="/financeiro" element={adminOnly(<Financeiro />)} />
          <Route path="/relatorios" element={adminOnly(<Relatorios />)} />
          <Route path="/configuracoes" element={adminOnly(<Configuracoes />)} />
          <Route path="*" element={<Navigate to={home} replace />} />
        </Routes>
      </Layout>
    </AppCtx.Provider>
  );
}
