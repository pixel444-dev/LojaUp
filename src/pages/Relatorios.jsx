import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend, Cell } from 'recharts';
import { Tag } from 'lucide-react';
import { useLoad, PageHeader, Empty, Loading, Tabs, Segmented, Stat, DateRange } from '../components/ui';
import { brl, num, pct, date, today, addDays, monthStart } from '../lib/format';

const shortBrl = (v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)));

function Faturamento({ range }) {
  const [groupBy, setGroupBy] = useState('day');
  const { data } = useLoad('reports.revenue', { ...range, groupBy }, [range, groupBy]);
  if (!data) return <Loading />;
  const sum = (k) => data.reduce((a, r) => a + r[k], 0);
  const sales = sum('sales');
  const net = sum('net');
  const profit = sum('profit');
  const fmtPeriod = (p) => (groupBy === 'month' ? p.split('-').reverse().join('/') : groupBy === 'week' ? `sem. ${date(p).slice(0, 5)}` : date(p).slice(0, 5));
  return (
    <>
      <div className="grid grid-5 mb">
        <Stat label="Faturamento líquido" value={brl(net)} foot={`bruto ${brl(sum('gross'))}`} />
        <Stat label="Lucro bruto estimado" value={brl(profit)} foot={`margem ${pct(net ? ((profit / net) * 100).toFixed(1) : 0)}`} />
        <Stat label="Vendas" value={num(sales)} foot={`${num(sum('pieces'))} peças`} />
        <Stat label="Ticket médio" value={brl(sales ? sum('gross') / sales : 0)} foot={`${sales ? (sum('pieces') / sales).toFixed(1) : 0} peças por venda`} />
        <Stat label="Descontos e devoluções" value={brl(sum('discount') + sum('returns'))} foot={`devoluções ${brl(sum('returns'))}`} />
      </div>
      <div className="card mb">
        <div className="card-header"><h3>Faturamento e lucro</h3><div className="actions"><Segmented value={groupBy} onChange={setGroupBy} options={[{ value: 'day', label: 'Diário' }, { value: 'week', label: 'Semanal' }, { value: 'month', label: 'Mensal' }]} /></div></div>
        <div className="card-body" style={{ height: 300 }}>
          <ResponsiveContainer>
            <BarChart data={data.map((r) => ({ ...r, label: fmtPeriod(r.period) }))}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eceef2" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={shortBrl} />
              <Tooltip formatter={(v) => brl(v)} />
              <Legend />
              <Bar dataKey="net" name="Faturamento líquido" fill="#4f46e5" radius={[3, 3, 0, 0]} />
              <Bar dataKey="profit" name="Lucro bruto" fill="#16a34a" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="card">
        <table className="table table-compact">
          <thead><tr><th>Período</th><th className="num">Vendas</th><th className="num">Peças</th><th className="num">Bruto</th><th className="num">Descontos</th><th className="num">Devoluções</th><th className="num">Líquido</th><th className="num">Custo</th><th className="num">Lucro</th><th className="num">Margem</th><th className="num">Ticket</th></tr></thead>
          <tbody>{[...data].reverse().filter((r) => r.sales || r.returns).map((r) => (
            <tr key={r.period}><td>{fmtPeriod(r.period)}</td><td className="num">{r.sales}</td><td className="num">{r.pieces}</td><td className="num">{brl(r.gross)}</td><td className="num">{brl(r.discount)}</td><td className="num">{brl(r.returns)}</td>
              <td className="num strong">{brl(r.net)}</td><td className="num">{brl(r.cost)}</td><td className="num strong">{brl(r.profit)}</td><td className="num">{pct(r.margin)}</td><td className="num">{brl(r.ticket)}</td></tr>
          ))}</tbody>
          <tfoot><tr><td>Total</td><td className="num">{sales}</td><td className="num">{sum('pieces')}</td><td className="num">{brl(sum('gross'))}</td><td className="num">{brl(sum('discount'))}</td><td className="num">{brl(sum('returns'))}</td><td className="num">{brl(net)}</td><td className="num">{brl(sum('cost'))}</td><td className="num">{brl(profit)}</td><td className="num">{pct(net ? ((profit / net) * 100).toFixed(1) : 0)}</td><td /></tr></tfoot>
        </table>
      </div>
    </>
  );
}

function Produtos({ range }) {
  const [sort, setSort] = useState('qty');
  const { data } = useLoad('reports.products', range, [range]);
  const sorted = useMemo(() => [...(data || [])].sort((a, b) => (sort === 'margin' ? a.margin - b.margin : b[sort] - a[sort])), [data, sort]);
  if (!data) return <Loading />;
  const totalRevenue = data.reduce((a, p) => a + p.revenue, 0);
  let acc = 0;
  return (
    <>
      <div className="row mb">
        <span className="muted">Ordenar por</span>
        <Segmented value={sort} onChange={setSort} options={[{ value: 'qty', label: 'Mais vendidos' }, { value: 'revenue', label: 'Faturamento' }, { value: 'profit', label: 'Lucro' }, { value: 'margin', label: 'Menor margem' }]} />
      </div>
      <div className="card">
        {!sorted.length ? <Empty>Nenhuma venda no período.</Empty> : (
          <table className="table table-compact">
            <thead><tr><th>#</th><th>Produto</th><th>Categoria</th><th className="num">Qtd</th><th className="num">Faturamento</th><th className="num">Custo</th><th className="num">Lucro</th><th className="num">Margem</th><th className="num">Lucro/peça</th><th className="num">Estoque</th><th>Curva</th></tr></thead>
            <tbody>{sorted.map((p, i) => {
              acc += p.revenue;
              const curve = sort === 'revenue' ? (acc / totalRevenue <= 0.8 ? 'A' : acc / totalRevenue <= 0.95 ? 'B' : 'C') : null;
              return (
                <tr key={p.id}>
                  <td className="muted">{i + 1}</td><td className="strong">{p.name}<div className="small muted">{[p.brand, p.model].filter(Boolean).join(' · ')}</div></td><td>{p.category}</td>
                  <td className="num strong">{p.qty}</td><td className="num">{brl(p.revenue)}</td><td className="num">{brl(p.cost)}</td><td className="num strong">{brl(p.profit)}</td>
                  <td className="num"><span className={`badge ${p.margin < 35 ? 'badge-danger' : p.margin < 50 ? 'badge-warning' : 'badge-success'}`}>{pct(p.margin)}</span></td>
                  <td className="num">{brl(p.qty ? p.profit / p.qty : 0)}</td><td className="num">{p.stock}</td>
                  <td>{curve && <span className={`badge ${curve === 'A' ? 'badge-success' : curve === 'B' ? 'badge-info' : ''}`}>{curve}</span>}</td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </div>
      {sort === 'revenue' && <div className="small muted mt-s">Curva ABC: produtos “A” somam 80% do faturamento — nunca deixe faltar.</div>}
    </>
  );
}

function Encalhados() {
  const [days, setDays] = useState(60);
  const nav = useNavigate();
  const { data } = useLoad('reports.stale', { days }, [days]);
  if (!data) return <Loading />;
  const value = data.reduce((a, p) => a + p.stock_value, 0);
  return (
    <>
      <div className="row mb">
        <span className="muted">Sem vender há mais de</span>
        <Segmented value={days} onChange={setDays} options={[30, 60, 90, 120, 180].map((d) => ({ value: d, label: `${d} dias` }))} />
      </div>
      <div className="grid grid-3 mb">
        <Stat label="Produtos encalhados" value={data.length} />
        <Stat label="Dinheiro parado (custo)" value={brl(value)} />
        <Stat label="Valor de venda" value={brl(data.reduce((a, p) => a + p.sale_value, 0))} foot={`${data.reduce((a, p) => a + p.stock, 0)} peças`} />
      </div>
      <div className="card">
        {!data.length ? <Empty>Nenhum produto encalhado. Ótimo giro de estoque! 🎉</Empty> : (
          <table className="table table-compact">
            <thead><tr><th>Produto</th><th>Categoria</th><th className="num">Peças</th><th className="num">Custo parado</th><th>Última venda</th><th className="num">Dias parado</th><th className="num">Sugestão</th><th /></tr></thead>
            <tbody>{data.map((p) => (
              <tr key={p.id}>
                <td className="strong">{p.name}<div className="small muted">{p.brand}</div></td><td>{p.category}</td><td className="num">{p.stock}</td>
                <td className="num strong">{brl(p.stock_value)}</td><td>{p.never_sold ? <span className="badge badge-danger">nunca vendeu</span> : date(p.last_sale)}</td>
                <td className="num"><span className={`badge ${p.idle_days > 120 ? 'badge-danger' : 'badge-warning'}`}>{p.idle_days}</span></td>
                <td className="num">{p.suggested_discount > 0 ? `${p.suggested_discount}% off → ${brl(p.sale_price * (1 - p.suggested_discount / 100))}` : 'rever exposição'}</td>
                <td className="actions-cell"><button className="btn btn-sm" onClick={() => nav(`/promocoes?product=${p.id}&discount=${p.suggested_discount}&name=${encodeURIComponent(p.name)}`)}><Tag size={13} />Criar promoção</button></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      <div className="small muted mt-s">A sugestão de desconto considera o tempo parado e a margem do produto, sem vender abaixo do custo. Mudar a peça de lugar na vitrine também ajuda.</div>
    </>
  );
}

function Reposicao() {
  const { data } = useLoad('reports.purchaseSuggestions', {}, []);
  if (!data) return <Loading />;
  const bySupplier = data.reduce((m, s) => { const k = s.supplier_name || 'Sem fornecedor'; (m[k] = m[k] || []).push(s); return m; }, {});
  return (
    <>
      <div className="alert alert-info mb">Calculado pelo ritmo de vendas dos últimos 30 dias. A sugestão cobre 45 dias de venda. Itens que acabam em menos de 20 dias aparecem aqui.</div>
      {!data.length ? <div className="card"><Empty>Nenhum item precisa de reposição agora.</Empty></div> : Object.entries(bySupplier).map(([sup, items]) => (
        <div key={sup} className="card mb">
          <div className="card-header"><h3>{sup}</h3><div className="actions"><span className="badge">{items.reduce((a, i) => a + i.suggested_qty, 0)} peças · {brl(items.reduce((a, i) => a + i.suggested_cost, 0))}</span></div></div>
          <table className="table table-compact">
            <thead><tr><th>Produto</th><th className="num">Vendidas (30d)</th><th className="num">Por dia</th><th className="num">Estoque</th><th className="num">Acaba em</th><th className="num">Comprar</th><th className="num">Custo estimado</th></tr></thead>
            <tbody>{items.map((s) => (
              <tr key={s.id}>
                <td className="strong">{s.product_name} {[s.color, s.size].filter(Boolean).join(' ')}</td><td className="num">{s.sold}</td><td className="num">{s.per_day}</td><td className="num">{s.stock}</td>
                <td className="num"><span className={`badge ${s.coverage_days <= 7 ? 'badge-danger' : 'badge-warning'}`}>{s.stock <= 0 ? 'esgotado' : `${s.coverage_days} dias`}</span></td>
                <td className="num strong">{s.suggested_qty}</td><td className="num">{brl(s.suggested_cost)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ))}
    </>
  );
}

function Grade({ range }) {
  const [category, setCategory] = useState('');
  const { data: options } = useLoad('products.options', {}, []);
  const { data } = useLoad('reports.sizeGrid', { ...range, category }, [range, category]);
  return (
    <>
      <div className="row mb">
        <select className="select" style={{ width: 220 }} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Todas as categorias</option>{options?.categories.map((c) => <option key={c}>{c}</option>)}
        </select>
        <span className="small muted">Compare o que vende com o que você tem. Barras desiguais = grade de compra errada.</span>
      </div>
      {!data ? <Loading /> : !data.length ? <div className="card"><Empty>Sem dados.</Empty></div> : (
        <div className="grid grid-2">
          <div className="card">
            <div className="card-body" style={{ height: 320 }}>
              <ResponsiveContainer>
                <BarChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eceef2" />
                  <XAxis dataKey="size" /><YAxis unit="%" tick={{ fontSize: 11 }} /><Tooltip formatter={(v) => `${v}%`} /><Legend />
                  <Bar dataKey="sold_share" name="% das vendas" fill="#4f46e5" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="stock_share" name="% do estoque" fill="#cbd5e1" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="card">
            <table className="table table-compact">
              <thead><tr><th>Tamanho</th><th className="num">Vendidas</th><th className="num">% vendas</th><th className="num">Estoque</th><th className="num">% estoque</th><th>Leitura</th></tr></thead>
              <tbody>{data.map((r) => {
                const gap = r.sold_share - r.stock_share;
                return (
                  <tr key={r.size}><td className="strong">{r.size}</td><td className="num">{r.sold}</td><td className="num">{pct(r.sold_share)}</td><td className="num">{r.stock}</td><td className="num">{pct(r.stock_share)}</td>
                    <td>{gap > 8 ? <span className="badge badge-danger">comprar mais</span> : gap < -8 ? <span className="badge badge-warning">sobrando</span> : <span className="badge badge-success">equilibrado</span>}</td></tr>
                );
              })}</tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

const COLORS = ['#4f46e5', '#16a34a', '#f59e0b', '#dc2626', '#0ea5e9', '#a855f7', '#14b8a6', '#f43f5e', '#84cc16', '#64748b'];

function Analises({ range }) {
  const [by, setBy] = useState('category');
  const { data } = useLoad('reports.breakdown', { ...range, by }, [range, by]);
  const options = [
    { value: 'category', label: 'Categoria' }, { value: 'brand', label: 'Marca' }, { value: 'size', label: 'Tamanho' }, { value: 'color', label: 'Cor' },
    { value: 'seller', label: 'Vendedor' }, { value: 'payment', label: 'Pagamento' }, { value: 'weekday', label: 'Dia da semana' }, { value: 'hour', label: 'Horário' },
  ];
  const total = (data || []).reduce((a, r) => a + r.revenue, 0);
  return (
    <>
      <div className="row mb"><Segmented value={by} onChange={setBy} options={options} /></div>
      {!data ? <Loading /> : !data.length ? <div className="card"><Empty>Sem vendas no período.</Empty></div> : (
        <div className="grid grid-2">
          <div className="card"><div className="card-body" style={{ height: 340 }}>
            <ResponsiveContainer>
              <BarChart data={data} layout={by === 'hour' || by === 'weekday' ? 'horizontal' : 'vertical'} margin={{ left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eceef2" />
                {by === 'hour' || by === 'weekday'
                  ? <><XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} tickFormatter={shortBrl} /></>
                  : <><XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={shortBrl} /><YAxis type="category" dataKey="label" width={110} tick={{ fontSize: 11 }} /></>}
                <Tooltip formatter={(v) => brl(v)} />
                <Bar dataKey="revenue" name="Faturamento" radius={3}>{data.map((_, i) => <Cell key={i} fill={by === 'hour' || by === 'weekday' ? '#4f46e5' : COLORS[i % COLORS.length]} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </div></div>
          <div className="card">
            <table className="table table-compact">
              <thead><tr><th>{options.find((o) => o.value === by).label}</th><th className="num">Vendas</th>{by !== 'payment' && <th className="num">Peças</th>}<th className="num">Faturamento</th><th className="num">%</th>{by !== 'payment' && <th className="num">Margem</th>}</tr></thead>
              <tbody>{data.map((r) => (
                <tr key={r.label}><td className="strong">{r.label}</td><td className="num">{r.sales}</td>{by !== 'payment' && <td className="num">{r.qty}</td>}<td className="num">{brl(r.revenue)}</td><td className="num">{pct(total ? ((r.revenue / total) * 100).toFixed(1) : 0)}</td>{by !== 'payment' && <td className="num">{pct(r.margin)}</td>}</tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function ValorEstoque() {
  const { data } = useLoad('reports.stockValue', {}, []);
  if (!data) return <Loading />;
  const t = data.reduce((a, r) => ({ pieces: a.pieces + r.pieces, cost: a.cost + r.cost_value, sale: a.sale + r.sale_value }), { pieces: 0, cost: 0, sale: 0 });
  return (
    <>
      <div className="grid grid-3 mb">
        <Stat label="Peças em estoque" value={num(t.pieces)} />
        <Stat label="Valor a preço de custo" value={brl(t.cost)} />
        <Stat label="Valor a preço de venda" value={brl(t.sale)} foot={`lucro potencial ${brl(t.sale - t.cost)}`} />
      </div>
      <div className="card">
        <table className="table">
          <thead><tr><th>Categoria</th><th className="num">Peças</th><th className="num">Custo</th><th className="num">Venda</th><th className="num">% do estoque</th></tr></thead>
          <tbody>{data.map((r) => <tr key={r.category}><td className="strong">{r.category}</td><td className="num">{r.pieces}</td><td className="num">{brl(r.cost_value)}</td><td className="num">{brl(r.sale_value)}</td><td className="num">{pct(t.cost ? ((r.cost_value / t.cost) * 100).toFixed(1) : 0)}</td></tr>)}</tbody>
        </table>
      </div>
    </>
  );
}

export default function Relatorios() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState(params.get('tab') || 'faturamento');
  const [range, setRange] = useState({ from: monthStart(), to: today() });
  const presets = [
    { label: 'Hoje', from: today(), to: today() }, { label: '7 dias', from: addDays(today(), -6), to: today() },
    { label: 'Este mês', from: monthStart(), to: today() }, { label: '30 dias', from: addDays(today(), -29), to: today() },
    { label: '90 dias', from: addDays(today(), -89), to: today() }, { label: '12 meses', from: addDays(today(), -364), to: today() },
  ];
  const usesRange = ['faturamento', 'produtos', 'grade', 'analises'].includes(tab);
  return (
    <>
      <PageHeader title="Relatórios" sub="Entenda o que está acontecendo na loja" />
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'faturamento', label: 'Faturamento' }, { id: 'produtos', label: 'Produtos e lucro' }, { id: 'encalhados', label: 'Encalhados' },
        { id: 'reposicao', label: 'Sugestão de compra' }, { id: 'grade', label: 'Grade de tamanhos' }, { id: 'analises', label: 'Análises' }, { id: 'estoque', label: 'Valor do estoque' },
      ]} />
      {usesRange && (
        <div className="row mb wrap">
          <DateRange {...range} onChange={setRange} />
          {presets.map((p) => <button key={p.label} className={`chip ${range.from === p.from && range.to === p.to ? 'active' : ''}`} onClick={() => setRange({ from: p.from, to: p.to })}>{p.label}</button>)}
        </div>
      )}
      {tab === 'faturamento' && <Faturamento range={range} />}
      {tab === 'produtos' && <Produtos range={range} />}
      {tab === 'encalhados' && <Encalhados />}
      {tab === 'reposicao' && <Reposicao />}
      {tab === 'grade' && <Grade range={range} />}
      {tab === 'analises' && <Analises range={range} />}
      {tab === 'estoque' && <ValorEstoque />}
    </>
  );
}
