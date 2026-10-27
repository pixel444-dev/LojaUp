import { useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Lock, Printer, Wallet } from 'lucide-react';
import { api } from '../api';
import { useApp } from '../App';
import { Modal, Field, MoneyInput, useLoad, useAction, PageHeader, Empty, Loading, Stat, useToast } from '../components/ui';
import { brl, dateTime, methodLabel, r2 } from '../lib/format';
import { printHtml, cashReport } from '../lib/print';

function Summary({ sum }) {
  const rows = Object.entries(sum.byMethod).filter(([, v]) => v.sales || v.receipts);
  return (
    <div className="grid grid-2">
      <div className="card">
        <div className="card-header"><h3>Entradas por forma de pagamento</h3></div>
        {!rows.length ? <Empty>Nenhuma entrada ainda.</Empty> : (
          <table className="table table-compact">
            <thead><tr><th>Forma</th><th className="num">Vendas</th><th className="num">Receb. crediário</th><th className="num">Total</th></tr></thead>
            <tbody>{rows.map(([m, v]) => (
              <tr key={m}><td>{methodLabel(m)}</td><td className="num">{brl(v.sales)}</td><td className="num">{v.receipts ? brl(v.receipts) : '—'}</td><td className="num strong">{brl(v.sales + v.receipts)}</td></tr>
            ))}</tbody>
          </table>
        )}
      </div>
      <div className="card">
        <div className="card-header"><h3>Dinheiro na gaveta</h3></div>
        <div className="card-body">
          <dl className="kv">
            <dt>Fundo de troco</dt><dd>{brl(sum.session.opening_amount)}</dd>
            <dt>(+) Vendas em dinheiro</dt><dd>{brl(sum.byMethod.dinheiro.sales)}</dd>
            <dt>(+) Recebimentos de crediário</dt><dd>{brl(sum.byMethod.dinheiro.receipts)}</dd>
            <dt>(+) Suprimentos</dt><dd>{brl(sum.suprimentos)}</dd>
            <dt>(−) Sangrias</dt><dd>{brl(sum.sangrias)}</dd>
            {sum.cashRefunds > 0 && <><dt>(−) Devoluções em dinheiro</dt><dd>{brl(sum.cashRefunds)}</dd></>}
            {sum.estornos > 0 && <><dt>(−) Estornos de vendas</dt><dd>{brl(sum.estornos)}</dd></>}
            <dt className="strong" style={{ fontSize: 15 }}>= Esperado</dt><dd className="strong" style={{ fontSize: 15 }}>{brl(sum.expectedCash)}</dd>
            {sum.session.status === 'fechado' && <>
              <dt>Contado</dt><dd>{brl(sum.session.counted_amount)}</dd>
              <dt>Diferença</dt><dd className={Math.abs(sum.session.difference) >= 0.01 ? (sum.session.difference < 0 ? 'text-danger strong' : 'text-warning strong') : 'text-success strong'}>{brl(sum.session.difference)}</dd>
            </>}
          </dl>
        </div>
      </div>
      {sum.moves.length > 0 && (
        <div className="card span-2">
          <div className="card-header"><h3>Sangrias e suprimentos</h3></div>
          <table className="table table-compact">
            <tbody>{sum.moves.map((m) => (
              <tr key={m.id}><td>{dateTime(m.created_at)}</td><td><span className={`badge ${m.type === 'suprimento' ? 'badge-success' : 'badge-warning'}`}>{m.type}</span></td><td>{m.description}</td><td>{m.user_name}</td><td className="num strong">{brl(m.amount)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MoveModal({ type, onClose, onDone }) {
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [run, busy] = useAction();
  async function save() {
    await run(() => api('cash.movement', { type, amount: r2(amount), description }), type === 'sangria' ? 'Sangria registrada.' : 'Suprimento registrado.');
    onDone();
  }
  return (
    <Modal title={type === 'sangria' ? 'Sangria (retirada de dinheiro)' : 'Suprimento (entrada de dinheiro)'} onClose={onClose} size="sm"
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={busy} onClick={save}>Confirmar</button></>}>
      <div className="col">
        <Field label="Valor"><MoneyInput autoFocus className="input-lg" value={amount} onChange={setAmount} /></Field>
        <Field label="Descrição"><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={type === 'sangria' ? 'Ex.: depósito no banco, pagamento de fornecedor' : 'Ex.: reforço de troco'} /></Field>
      </div>
    </Modal>
  );
}

function CloseModal({ sum, onClose, onDone }) {
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  const [run, busy] = useAction();
  const diff = counted === '' ? null : r2(r2(counted) - sum.expectedCash);
  async function save() {
    const id = await run(() => api('cash.close', { counted: r2(counted), notes }), 'Caixa fechado!');
    onDone(id);
  }
  return (
    <Modal title="Fechar caixa" onClose={onClose} size="sm"
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-danger" disabled={busy || counted === ''} onClick={save}><Lock size={16} />Fechar caixa</button></>}>
      <div className="col">
        <div className="muted">Conte o dinheiro da gaveta e informe o valor. O sistema compara com o esperado.</div>
        <Field label="Dinheiro contado na gaveta"><MoneyInput autoFocus className="input-lg" value={counted} onChange={setCounted} /></Field>
        {diff != null && (
          <div className={`alert ${Math.abs(diff) < 0.01 ? 'alert-success' : diff < 0 ? 'alert-danger' : 'alert-warning'}`}>
            {Math.abs(diff) < 0.01 ? 'Caixa confere! ✔' : diff < 0 ? `Faltando ${brl(-diff)}` : `Sobrando ${brl(diff)}`}
          </div>
        )}
        <Field label="Observações"><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

export default function Caixa() {
  const { cash, reloadCash, settings } = useApp();
  const toast = useToast();
  const [modal, setModal] = useState(null);
  const [amount, setAmount] = useState('');
  const [detail, setDetail] = useState(null);
  const [run] = useAction();
  const { data: history, reload } = useLoad('cash.history', {}, [cash?.session?.id]);
  const print = async (s) => { try { await printHtml(cashReport(s, settings), settings); } catch (e) { toast.error(e.message); } };

  async function open() {
    await run(() => api('cash.open', { amount: r2(amount) }), 'Caixa aberto!');
    setAmount(''); reloadCash();
  }
  async function afterClose(id) {
    setModal(null);
    await reloadCash();
    reload();
    print(await api('cash.get', { id }));
  }

  return (
    <>
      <PageHeader title="Caixa" sub={cash ? `Caixa #${cash.session.id} aberto por ${cash.session.user_name} em ${dateTime(cash.session.opened_at)}` : 'Nenhum caixa aberto'}>
        {cash && <>
          <button className="btn" onClick={() => setModal('suprimento')}><ArrowDownRight size={16} />Suprimento</button>
          <button className="btn" onClick={() => setModal('sangria')}><ArrowUpRight size={16} />Sangria</button>
          <button className="btn" onClick={() => print(cash)}><Printer size={16} />Resumo parcial</button>
          <button className="btn btn-danger" onClick={() => setModal('close')}><Lock size={16} />Fechar caixa</button>
        </>}
      </PageHeader>

      {cash ? (
        <>
          <div className="grid grid-4 mb">
            <Stat label="Vendas" value={cash.salesInfo.qty} foot={`Ticket médio ${brl(cash.ticket)}`} />
            <Stat label="Total vendido" value={brl(cash.salesInfo.total)} foot={cash.salesInfo.discount ? `Descontos ${brl(cash.salesInfo.discount)}` : ''} />
            <Stat label="Dinheiro esperado na gaveta" value={brl(cash.expectedCash)} />
            <Stat label="Canceladas" value={cash.canceled.qty} foot={cash.canceled.qty ? brl(cash.canceled.total) : ''} />
          </div>
          <Summary sum={cash} />
        </>
      ) : (
        <div className="card card-body mb" style={{ maxWidth: 480 }}>
          <div className="row mb"><Wallet size={20} /><h3>Abrir caixa</h3></div>
          <Field label="Fundo de troco (dinheiro inicial na gaveta)"><MoneyInput className="input-lg" value={amount} onChange={setAmount} onKeyDown={(e) => e.key === 'Enter' && open()} /></Field>
          <button className="btn btn-primary btn-lg mt btn-block" onClick={open}>Abrir caixa</button>
        </div>
      )}

      <div className="card mt">
        <div className="card-header"><h3>Histórico de caixas</h3></div>
        {!history ? <Loading /> : !history.length ? <Empty>Nenhum caixa registrado.</Empty> : (
          <table className="table">
            <thead><tr><th>Nº</th><th>Abertura</th><th>Fechamento</th><th>Operador</th><th className="num">Vendas</th><th className="num">Total vendido</th><th className="num">Esperado</th><th className="num">Contado</th><th className="num">Diferença</th></tr></thead>
            <tbody>{history.map((h) => (
              <tr key={h.id} className="clickable" onClick={async () => setDetail(await api('cash.get', { id: h.id }))}>
                <td className="strong">#{h.id}</td><td>{dateTime(h.opened_at)}</td><td>{h.closed_at ? dateTime(h.closed_at) : <span className="badge badge-success">Aberto</span>}</td>
                <td>{h.user_name}</td><td className="num">{h.sales_count}</td><td className="num">{brl(h.sales_total)}</td>
                <td className="num">{h.expected_amount != null ? brl(h.expected_amount) : '—'}</td><td className="num">{h.counted_amount != null ? brl(h.counted_amount) : '—'}</td>
                <td className="num">{h.difference != null ? <span className={`badge ${Math.abs(h.difference) < 0.01 ? 'badge-success' : h.difference < 0 ? 'badge-danger' : 'badge-warning'}`}>{brl(h.difference)}</span> : '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>

      {(modal === 'sangria' || modal === 'suprimento') && <MoveModal type={modal} onClose={() => setModal(null)} onDone={() => { setModal(null); reloadCash(); }} />}
      {modal === 'close' && <CloseModal sum={cash} onClose={() => setModal(null)} onDone={afterClose} />}
      {detail && (
        <Modal title={`Caixa #${detail.session.id}`} onClose={() => setDetail(null)} size="xl"
          footer={<button className="btn" onClick={() => print(detail)}><Printer size={16} />Imprimir relatório</button>}>
          <Summary sum={detail} />
        </Modal>
      )}
    </>
  );
}
