import { useNavigate } from 'react-router-dom';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { TriangleAlert, CircleCheck, Info, Lightbulb, RefreshCw, ShoppingCart, Gift, PackageMinus, TrendingUp, ChevronRight } from 'lucide-react';
import { useApp } from '../App';
import { useLoad, Loading, Empty, Stat } from '../components/ui';
import { brl, date, num, whatsappLink } from '../lib/format';

const ICONS = { danger: TriangleAlert, warning: TriangleAlert, success: CircleCheck, info: Lightbulb };

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

export default function Dashboard() {
  const { user, settings } = useApp();
  const nav = useNavigate();
  const { data: d, reload, loading } = useLoad('insights.dashboard', {}, []);
  if (!d) return <Loading />;
  const t = d.today;
  const m = d.month;
  const urgent = d.alerts.filter((a) => a.level === 'danger').length;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{greeting()}, {user.name.split(' ')[0]}!</h1>
          <div className="sub">
            {urgent ? `${urgent} ponto(s) precisam da sua atenção hoje.` : 'Tudo sob controle por aqui.'} Veja o resumo da {settings.store_name}.
          </div>
        </div>
        <div className="actions">
          <button className="btn" onClick={reload} disabled={loading}><RefreshCw size={16} />Atualizar</button>
          <button className="btn btn-primary" onClick={() => nav('/pdv')}><ShoppingCart size={16} />Vender</button>
        </div>
      </div>

      <div className="grid grid-5 mb">
        <Stat label="Vendido hoje" value={brl(t.revenue)} trend={t.vs_last_week} foot={t.vs_last_week != null ? 'vs. mesmo dia da semana passada' : `${t.sales} venda(s)`} />
        <Stat label="Vendido no mês" value={brl(m.revenue)} trend={m.vs_prev} foot={m.vs_prev != null ? 'vs. mesmo período do mês passado' : `${m.sales} venda(s)`} />
        <Stat label="Projeção do mês" value={brl(m.projection)} foot="no ritmo atual de vendas" icon={<TrendingUp size={14} />} />
        <Stat label="Lucro líquido do mês" value={<span className={m.net_profit < 0 ? 'text-danger' : ''}>{brl(m.net_profit)}</span>} foot={`margem bruta ${m.gross_margin}%`} />
        <Stat label="Ticket médio (mês)" value={brl(m.ticket)} foot={`${num(m.pa)} peças por venda`} />
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.15fr) minmax(0, 1fr)' }}>
        <div className="card">
          <div className="card-header"><Lightbulb size={18} color="var(--warning)" /><h3>O que precisa da sua atenção</h3><div className="actions"><span className="badge">{d.alerts.length}</span></div></div>
          {!d.alerts.length ? <Empty icon={<CircleCheck size={34} />}>Nenhum alerta. A loja está em dia!</Empty> : (
            <div style={{ maxHeight: 460, overflowY: 'auto' }}>
              {d.alerts.map((a, i) => {
                const Icon = ICONS[a.level] || Info;
                return (
                  <div key={i} className="insight" onClick={() => a.link && nav(a.link)}>
                    <div className={`insight-icon lvl-${a.level}`}><Icon size={17} /></div>
                    <div style={{ flex: 1 }}>
                      <div className="insight-title">{a.title} <span className="badge" style={{ marginLeft: 4, fontWeight: 500 }}>{a.group}</span></div>
                      <div className="insight-text">{a.text}</div>
                    </div>
                    {a.link && <ChevronRight size={16} color="var(--text-3)" />}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="col" style={{ gap: 16 }}>
          <div className="card">
            <div className="card-header"><h3>Vendas dos últimos 30 dias</h3></div>
            <div className="card-body" style={{ height: 220 }}>
              <ResponsiveContainer>
                <AreaChart data={d.series.map((s) => ({ dia: date(s.period).slice(0, 5), Faturamento: s.net, Lucro: s.profit }))}>
                  <defs>
                    <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#4f46e5" stopOpacity={0.3} /><stop offset="1" stopColor="#4f46e5" stopOpacity={0} /></linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eceef2" />
                  <XAxis dataKey="dia" tick={{ fontSize: 10.5 }} interval={4} />
                  <YAxis tick={{ fontSize: 10.5 }} width={45} tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v)} />
                  <Tooltip formatter={(v) => brl(v)} />
                  <Area type="monotone" dataKey="Faturamento" stroke="#4f46e5" fill="url(#g1)" strokeWidth={2} />
                  <Area type="monotone" dataKey="Lucro" stroke="#16a34a" fill="transparent" strokeWidth={1.5} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="card">
            <div className="card-header"><h3>Campeões de venda (30 dias)</h3><div className="actions"><button className="btn btn-ghost btn-sm" onClick={() => nav('/relatorios?tab=produtos')}>Ver todos</button></div></div>
            {!d.top.length ? <Empty>Sem vendas no período.</Empty> : (
              <table className="table table-compact">
                <tbody>{d.top.map((p, i) => (
                  <tr key={p.id}><td className="muted" style={{ width: 24 }}>{i + 1}</td><td className="strong">{p.name}</td><td className="num">{p.qty} un.</td><td className="num">{brl(p.revenue)}</td><td className="num"><span className="badge">{p.margin}%</span></td><td className="num small muted">estoque {p.stock}</td></tr>
                ))}</tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-2 mt">
        <div className="card">
          <div className="card-header"><ShoppingCart size={17} /><h3>Sugestão de compra</h3><div className="actions"><button className="btn btn-ghost btn-sm" onClick={() => nav('/relatorios?tab=reposicao')}>Ver tudo</button></div></div>
          {!d.suggestions.length ? <Empty>Nenhum item vendendo rápido com estoque curto.</Empty> : (
            <table className="table table-compact">
              <thead><tr><th>Produto</th><th className="num">Estoque</th><th className="num">Acaba em</th><th className="num">Comprar</th></tr></thead>
              <tbody>{d.suggestions.map((s) => (
                <tr key={s.id}><td>{s.product_name} {[s.color, s.size].filter(Boolean).join(' ')}</td><td className="num">{s.stock}</td>
                  <td className="num"><span className={`badge ${s.coverage_days <= 7 ? 'badge-danger' : 'badge-warning'}`}>{s.stock <= 0 ? 'esgotado' : `${s.coverage_days}d`}</span></td><td className="num strong">{s.suggested_qty}</td></tr>
              ))}</tbody>
            </table>
          )}
        </div>
        <div className="card">
          <div className="card-header"><PackageMinus size={17} /><h3>Dinheiro parado em estoque</h3><div className="actions"><span className="badge badge-warning">{brl(d.stale.value)}</span><button className="btn btn-ghost btn-sm" onClick={() => nav('/relatorios?tab=encalhados')}>Ver tudo</button></div></div>
          {!d.stale.items.length ? <Empty>Nenhum produto encalhado. 🎉</Empty> : (
            <table className="table table-compact">
              <thead><tr><th>Produto</th><th className="num">Peças</th><th className="num">Parado há</th><th className="num">Custo</th><th className="num">Sugestão</th></tr></thead>
              <tbody>{d.stale.items.map((s) => (
                <tr key={s.id}><td>{s.name}</td><td className="num">{s.stock}</td><td className="num">{s.idle_days} dias</td><td className="num">{brl(s.stock_value)}</td><td className="num">{s.suggested_discount ? `${s.suggested_discount}% off` : '—'}</td></tr>
              ))}</tbody>
            </table>
          )}
        </div>
      </div>

      {d.birthdays.length > 0 && (
        <div className="card mt">
          <div className="card-header"><Gift size={17} /><h3>Aniversariantes da semana</h3><span className="muted small">Uma mensagem com um cupom traz o cliente de volta.</span></div>
          <div className="card-body row wrap">
            {d.birthdays.map((b) => (
              <a key={b.id} className="chip" href={whatsappLink(b.phone, `Feliz aniversário, ${b.name.split(' ')[0]}! 🎉 A ${settings.store_name} preparou um presente especial para você. Venha nos visitar!`) || undefined} target="_blank" rel="noreferrer">
                🎂 {b.name} — {date(b.birth_date).slice(0, 5)}
              </a>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
