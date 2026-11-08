import { useState } from "react";
import { api } from "../api";
import { fmtFull, fmtDue, printOrders, sinceText, STATUS, urgency } from "../orders";
import Icon from "./Icon";
import { ErrorBox, Field, Modal, Spinner, useLoad, useToast } from "./ui";

export function StatusTag({ status }) {
  return <span className={`ord-status st-${status}`}>{STATUS[status]?.label || status}</span>;
}

/** Cartão de encomenda (lista da loja e quadro da fábrica). */
export function OrderCard({ order: o, onOpen, showStore = true, flags = [], footer, now }) {
  const urg = urgency(o, now);
  return (
    <article className={`ord-card ${urg ? `urg-${urg}` : ""} ${flags.includes("nova") ? "is-new" : ""} ${o.status === "cancelado" ? "is-cancelled" : ""}`}>
      <button type="button" className="ord-card-main" onClick={onOpen} aria-label={`Abrir encomenda ${o.id} de ${o.customer_name}`}>
        <div className="ord-card-top">
          <span className="ord-num">#{o.id}</span>
          <strong className="ord-customer">{o.customer_name}</strong>
          {flags.includes("nova") && <span className="ord-flag flag-new">Nova</span>}
          {flags.includes("naoimpressa") && <span className="ord-flag flag-print" title="Ainda não impressa pela fábrica"><Icon name="printer" size={12} /> Imprimir</span>}
        </div>
        <div className={`ord-due ${urg}`}>
          <Icon name="clock" size={16} />
          <span>{fmtDue(o.due_at)}</span>
          {urg === "late" && <b className="ord-late">atrasada</b>}
        </div>
        <ul className="ord-items">
          {o.items.map((i) => (
            <li key={i.id}>
              <b>{i.quantity}×</b> {i.product_name}
              {i.notes && <span className="ord-item-note">{i.notes}</span>}
            </li>
          ))}
        </ul>
        {o.notes && <p className="ord-notes"><Icon name="note" size={14} /> {o.notes}</p>}
        <div className="ord-meta muted small">
          {showStore && <span className="ord-store"><Icon name="store" size={14} /> {o.store_name}</span>}
          {o.customer_phone && <span>{o.customer_phone}</span>}
          <span title={fmtFull(o.created_at)}>feita {sinceText(o.created_at, now)}</span>
        </div>
      </button>
      {footer && <div className="ord-card-foot">{footer}</div>}
    </article>
  );
}

const EVENT_TEXT = {
  criada: () => "Encomenda registrada",
  andamento: (e) => `Andamento: ${e.status_label}`,
  impressa: () => "Impressa pela fábrica",
  cancelada: (e) => `Cancelada${e.note ? `: ${e.note}` : ""}`,
};

/** Detalhe da encomenda. Na fábrica (`factory`), mostra também mudar andamento e cancelar. */
export function OrderDetail({ orderId, onClose, factory = false, onChanged, onPrint }) {
  const toast = useToast();
  const res = useLoad(() => api(`/orders/${orderId}/`), [orderId]);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const o = res.data;

  async function move(status) {
    setBusy(true);
    try {
      const updated = await api(`/orders/${o.id}/andamento/`, { method: "POST", body: { status } });
      toast(`#${o.id}: ${STATUS[status].label}.`);
      onChanged?.(updated);
      res.reload();
    } catch (e) {
      toast(e.message, { tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  const st = o && STATUS[o.status];
  return (
    <Modal open onClose={onClose} title={o ? `Encomenda #${o.id}` : "Encomenda"} size="md"
      footer={o && (
        <>
          {factory ? (
            <button className="btn btn-ghost" onClick={() => onPrint ? onPrint(o) : printOrders([o])}>
              <Icon name="printer" /> Imprimir comanda
            </button>
          ) : (
            <button className="btn btn-ghost" onClick={() => printOrders([o], { via: "VIA DO CLIENTE" })}>
              <Icon name="printer" /> Imprimir via do cliente
            </button>
          )}
          {factory && st?.next && (
            <button className="btn btn-primary grow" disabled={busy} onClick={() => move(st.next)}>
              {st.action} <Icon name="chevron" />
            </button>
          )}
        </>
      )}>
      <ErrorBox error={res.error} onRetry={res.reload} />
      {!o ? <Spinner /> : (
        <div className="ord-detail">
          <div className="ord-detail-head">
            <StatusTag status={o.status} />
            <span className="ord-due-big"><Icon name="clock" size={20} /> {fmtDue(o.due_at)}</span>
          </div>
          {o.status === "cancelado" && (
            <div className="alert alert-error"><Icon name="alert" /><span>Cancelada: {o.cancel_reason}</span></div>
          )}
          <dl className="ord-dl">
            <dt>Cliente</dt><dd><strong>{o.customer_name}</strong></dd>
            {o.customer_phone && <><dt>Telefone</dt><dd><a href={`tel:${o.customer_phone.replace(/\D/g, "")}`}>{o.customer_phone}</a></dd></>}
            <dt>Loja</dt><dd>{o.store_name}</dd>
            <dt>Registrada</dt><dd>{fmtFull(o.created_at)} por {o.created_by_name}</dd>
          </dl>
          <h3 className="ord-h3">Produtos</h3>
          <ul className="ord-items ord-items-lg">
            {o.items.map((i) => (
              <li key={i.id}><b>{i.quantity}×</b> {i.product_name}{i.notes && <span className="ord-item-note">{i.notes}</span>}</li>
            ))}
          </ul>
          {o.notes && <><h3 className="ord-h3">Observações</h3><p className="ord-notes-box">{o.notes}</p></>}

          {factory && o.status !== "cancelado" && (
            <div className="ord-detail-actions">
              {st?.prev && (
                <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => move(st.prev)}>
                  <Icon name="back" size={16} /> Voltar para “{STATUS[st.prev].label}”
                </button>
              )}
              <button className="btn btn-ghost btn-sm btn-danger-text" onClick={() => setCancelling(true)}>
                <Icon name="x" size={16} /> Cancelar encomenda
              </button>
            </div>
          )}

          <h3 className="ord-h3">Histórico</h3>
          <ol className="ord-timeline">
            {o.events.map((e) => (
              <li key={e.id}>
                <span>{(EVENT_TEXT[e.action] || (() => e.action))(e)}</span>
                <span className="muted small">{fmtFull(e.created_at)} · {e.user_name}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
      {cancelling && o && (
        <CancelModal order={o} onClose={() => setCancelling(false)}
                     onDone={(updated) => { setCancelling(false); onChanged?.(updated); res.reload(); }} />
      )}
    </Modal>
  );
}

function CancelModal({ order, onClose, onDone }) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e) {
    e.preventDefault();
    if (!reason.trim()) return setError("Informe o motivo.");
    setBusy(true);
    try {
      const updated = await api(`/orders/${order.id}/cancelar/`, { method: "POST", body: { reason: reason.trim() } });
      toast(`Encomenda #${order.id} cancelada.`);
      onDone(updated);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={`Cancelar encomenda #${order.id}?`} size="sm"
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Voltar</button>
        <button className="btn btn-danger grow" form="cancel-form" disabled={busy}>{busy ? "Cancelando…" : "Cancelar encomenda"}</button>
      </>}>
      <form id="cancel-form" className="form" onSubmit={submit}>
        <p className="muted">{order.customer_name} · {fmtDue(order.due_at)}. A loja verá a encomenda como cancelada, com o motivo.</p>
        <Field label="Motivo *" error={error}>
          <input className="input" value={reason} maxLength={255} autoFocus
                 placeholder="Ex.: cliente desistiu, pedido em duplicidade…"
                 onChange={(e) => { setReason(e.target.value); setError(""); }} />
        </Field>
      </form>
    </Modal>
  );
}
