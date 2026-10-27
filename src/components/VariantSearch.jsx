import { useEffect, useRef, useState } from 'react';
import { ScanBarcode } from 'lucide-react';
import { api } from '../api';
import { brl } from '../lib/format';
import { useToast } from './ui';

// Campo de busca de produto/variação por código de barras ou texto
export default function VariantSearch({ onPick, placeholder = 'Código de barras ou nome do produto', autoFocus = false, showCost = false }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [active, setActive] = useState(0);
  const toast = useToast();
  const ref = useRef(null);

  useEffect(() => {
    const t = q.trim();
    if (t.length < 2 || /^\d{8,}$/.test(t)) { setResults([]); return; }
    const h = setTimeout(() => api('products.searchVariants', { q: t, limit: 25 }).then((r) => { setResults(r); setActive(0); }), 200);
    return () => clearTimeout(h);
  }, [q]);

  function pick(v) {
    onPick(v);
    setQ(''); setResults([]);
    setTimeout(() => ref.current?.focus(), 20);
  }

  async function enter() {
    const t = q.trim();
    if (!t) return;
    if (results.length && !/^\d{6,}$/.test(t)) { pick(results[active]); return; }
    const v = await api('products.findBarcode', { code: t });
    if (v) pick(v);
    else {
      const r = await api('products.searchVariants', { q: t, limit: 25 });
      if (r.length === 1) pick(r[0]); else if (r.length) setResults(r); else toast.error('Produto não encontrado.');
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <div className="input-group">
        <ScanBarcode size={17} className="icon" />
        <input ref={ref} className="input" autoFocus={autoFocus} placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)}
          onBlur={() => setTimeout(() => setResults([]), 150)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); enter().catch((err) => toast.error(err.message)); }
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          }} />
      </div>
      {results.length > 0 && (
        <div className="search-results">
          {results.map((v, i) => (
            <div key={v.id} className={`search-item ${i === active ? 'active' : ''}`} onMouseDown={(e) => { e.preventDefault(); pick(v); }}>
              <div style={{ flex: 1 }}><div className="strong">{v.label}</div><div className="small muted">{[v.brand, v.barcode].filter(Boolean).join(' · ')}</div></div>
              <span className="badge">{v.stock} un.</span>
              <span className="num strong" style={{ minWidth: 80 }}>{brl(showCost ? v.cost : v.price)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
