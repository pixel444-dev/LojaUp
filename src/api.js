// Chamada à API local (Electron IPC; em desenvolvimento no navegador usa a ponte HTTP)
export async function api(method, args) {
  let res;
  if (window.lojaup) {
    res = await window.lojaup.call(method, args);
  } else {
    const r = await fetch('http://127.0.0.1:5174', { method: 'POST', body: JSON.stringify({ method, args }) });
    res = await r.json();
  }
  if (!res.ok) {
    const err = new Error(res.error || 'Erro desconhecido');
    err.authRequired = !!res.authRequired;
    throw err;
  }
  return res.data;
}

export const isElectron = () => !!window.lojaup;
