import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { X, CircleCheck, TriangleAlert, Info, Inbox } from 'lucide-react';
import { api } from '../api';
import { parseMoney } from '../lib/format';

// ---------- Toasts ----------
const ToastCtx = createContext(null);
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((type, text) => {
    const id = Math.random();
    setToasts((t) => [...t, { id, type, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), type === 'error' ? 6000 : 3200);
  }, []);
  const toast = { success: (t) => push('success', t), error: (t) => push('error', t), info: (t) => push('info', t) };
  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>
            {t.type === 'success' ? <CircleCheck size={18} /> : t.type === 'error' ? <TriangleAlert size={18} /> : <Info size={18} />}
            <div>{t.text}</div>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------- Carregamento de dados ----------
export function useLoad(method, args, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const seq = useRef(0);
  const load = useCallback(async () => {
    const my = ++seq.current;
    setLoading(true);
    try {
      const d = await api(method, typeof args === 'function' ? args() : args);
      if (my === seq.current) { setData(d); setError(null); }
    } catch (e) {
      if (my === seq.current) setError(e.message);
    } finally {
      if (my === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { load(); }, [load]);
  return { data, loading, error, reload: load, setData };
}

// Executa uma ação com feedback de erro/sucesso
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn, successMsg) => {
    setBusy(true);
    try {
      const r = await fn();
      if (successMsg) toast.success(successMsg);
      return r;
    } catch (e) {
      toast.error(e.message);
      throw e;
    } finally {
      setBusy(false);
    }
  }, [toast]);
  return [run, busy];
}

// ---------- Modal ----------
// Pilha de modais abertos: só o do topo responde ao Esc
const modalStack = [];
export function Modal({ title, onClose, children, footer, size = '', closeOnBackdrop = false }) {
  const idRef = useRef(Math.random());
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const id = idRef.current;
    modalStack.push(id);
    const onKey = (e) => {
      if (e.key !== 'Escape' || modalStack[modalStack.length - 1] !== id) return;
      e.stopPropagation();
      closeRef.current?.();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      modalStack.splice(modalStack.indexOf(id), 1);
    };
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (closeOnBackdrop && e.target === e.currentTarget) onClose?.(); }}>
      <div className={`modal ${size}`} role="dialog">
        <div className="modal-header">
          <h2>{title}</h2>
          <div className="spacer" />
          {onClose && <button className="btn btn-ghost btn-icon" onClick={onClose} title="Fechar (Esc)"><X size={18} /></button>}
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

// ---------- Confirmação ----------
const ConfirmCtx = createContext(null);
export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);
  const confirm = useCallback((opts) => new Promise((resolve) => {
    setState({ ...(typeof opts === 'string' ? { message: opts } : opts), resolve });
  }), []);
  const close = (v) => { state?.resolve(v); setState(null); };
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {state && (
        <Modal title={state.title || 'Confirmar'} onClose={() => close(false)} size="sm"
          footer={<>
            <button className="btn" onClick={() => close(false)}>Voltar</button>
            <button className={`btn ${state.danger ? 'btn-danger' : 'btn-primary'}`} autoFocus onClick={() => close(true)}>{state.confirmText || 'Confirmar'}</button>
          </>}>
          <div style={{ whiteSpace: 'pre-line' }}>{state.message}</div>
        </Modal>
      )}
    </ConfirmCtx.Provider>
  );
}
export const useConfirm = () => useContext(ConfirmCtx);

// ---------- Campos ----------
export function Field({ label, hint, children, className = '' }) {
  return (
    <div className={`field ${className}`}>
      {label && <label>{label}</label>}
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function MoneyInput({ value, onChange, className = '', ...props }) {
  const [text, setText] = useState(() => format(value));
  const focused = useRef(false);
  function format(v) {
    if (v === '' || v == null) return '';
    return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  useEffect(() => { if (!focused.current) setText(format(value)); }, [value]);
  return (
    <input {...props} className={`input num ${className}`} inputMode="decimal" value={text}
      onFocus={(e) => { focused.current = true; e.target.select(); props.onFocus?.(e); }}
      onBlur={(e) => { focused.current = false; setText(format(value)); props.onBlur?.(e); }}
      onChange={(e) => { setText(e.target.value); onChange(e.target.value.trim() === '' ? '' : parseMoney(e.target.value)); }} />
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <button key={t.id} className={`tab ${value === t.id ? 'active' : ''}`} onClick={() => onChange(t.id)}>
          {t.icon}{t.label}
        </button>
      ))}
    </div>
  );
}

export function Segmented({ options, value, onChange }) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={o.value} className={value === o.value ? 'active' : ''} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Empty({ icon, children }) {
  return <div className="empty">{icon || <Inbox size={34} />}<div>{children || 'Nada por aqui ainda.'}</div></div>;
}

export function Stat({ label, value, foot, icon, trend }) {
  return (
    <div className="card stat">
      <div className="stat-label">{icon}{label}</div>
      <div className="stat-value">{value}</div>
      {(foot || trend != null) && (
        <div className="stat-foot">
          {trend != null && <span className={trend >= 0 ? 'trend-up' : 'trend-down'}>{trend >= 0 ? '▲' : '▼'} {Math.abs(trend)}% </span>}
          {foot}
        </div>
      )}
    </div>
  );
}

export function PageHeader({ title, sub, children }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {children && <div className="actions">{children}</div>}
    </div>
  );
}

export function Loading() { return <div className="loading">Carregando…</div>; }

export function DateRange({ from, to, onChange }) {
  return (
    <div className="row">
      <input type="date" className="input" style={{ width: 150 }} value={from} onChange={(e) => onChange({ from: e.target.value, to })} />
      <span className="muted">até</span>
      <input type="date" className="input" style={{ width: 150 }} value={to} onChange={(e) => onChange({ from, to: e.target.value })} />
    </div>
  );
}

// Autorização de administrador (desconto acima do limite, crediário sem limite etc.)
export function AuthorizeModal({ message, onClose, onAuthorized }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  async function submit(e) {
    e.preventDefault();
    try {
      await api('auth.authorize', { username, password });
      onAuthorized({ username, password });
    } catch (err) { setError(err.message); }
  }
  return (
    <Modal title="Autorização do administrador" onClose={onClose} size="sm">
      <form onSubmit={submit} className="col">
        <div className="alert alert-warning"><TriangleAlert size={18} /><div>{message}</div></div>
        <Field label="Usuário administrador"><input className="input" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} /></Field>
        <Field label="Senha"><input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        {error && <div className="text-danger small">{error}</div>}
        <div className="row end"><button type="button" className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary">Autorizar</button></div>
      </form>
    </Modal>
  );
}

export function StatusBadge({ status }) {
  const map = {
    concluida: ['success', 'Concluída'], cancelada: ['danger', 'Cancelada'], aberta: ['warning', 'Em aberto'], paga: ['success', 'Paga'],
    vencida: ['danger', 'Vencida'], aberto: ['success', 'Aberto'], fechado: ['', 'Fechado'], recebida: ['success', 'Recebida'],
    finalizado: ['success', 'Finalizado'], cancelado: ['danger', 'Cancelado'],
  };
  const [tone, label] = map[status] || ['', status];
  return <span className={`badge ${tone ? 'badge-' + tone : ''}`}>{label}</span>;
}
