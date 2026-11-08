import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import Icon from "../components/Icon";
import { Chips, Empty, ErrorBox, Field, Modal, PageHeader, SearchBox, Spinner, useLoad, useToast } from "../components/ui";
import { todayISO } from "../format";
import { fmtDue, printOrders } from "../orders";

const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const MAX_QTY = 999;

/** Telefone: (21) 99999-9999 ou (21) 9999-9999 enquanto digita. */
function maskPhone(v) {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

const emptyCustomer = () => ({ customer_name: "", customer_phone: "", date: "", time: "", notes: "" });

export default function NovaEncomenda() {
  const { establishment } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const products = useLoad(() => api("/products/", { params: { active: "true" } }), []);

  const [search, setSearch] = useState("");
  const [group, setGroup] = useState("");
  const [cart, setCart] = useState([]); // { product, quantity, notes, showNotes }
  const [form, setForm] = useState(emptyCustomer);
  const [tried, setTried] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);

  const all = products.data || [];
  const groups = useMemo(() => [...new Set(all.map((p) => p.group).filter(Boolean))], [all]);
  const visible = useMemo(() => {
    const q = norm(search.trim());
    return all.filter((p) => (!group || p.group === group) && (!q || norm(p.name).includes(q)));
  }, [all, search, group]);

  const qtyOf = (id) => cart.find((c) => c.product.id === id)?.quantity || 0;
  const add = (product, delta = 1) =>
    setCart((list) => {
      const found = list.find((c) => c.product.id === product.id);
      if (!found) return delta > 0 ? [...list, { product, quantity: delta, notes: "", showNotes: false }] : list;
      const q = Math.min(MAX_QTY, found.quantity + delta);
      return q <= 0 ? list.filter((c) => c !== found) : list.map((c) => (c === found ? { ...c, quantity: q } : c));
    });
  const patch = (id, p) => setCart((list) => list.map((c) => (c.product.id === id ? { ...c, ...p } : c)));
  const set = (k) => (e) => setForm({ ...form, [k]: k === "customer_phone" ? maskPhone(e.target.value) : e.target.value });

  const dueDate = form.date && form.time ? new Date(`${form.date}T${form.time}`) : null;
  const problems = [];
  if (!cart.length) problems.push("Escolha ao menos um produto.");
  if (!form.customer_name.trim()) problems.push("Informe o nome do cliente.");
  if (!form.date) problems.push("Informe o dia da entrega.");
  if (!form.time) problems.push("Informe a hora da entrega.");
  if (dueDate && dueDate.getTime() < Date.now() - 10 * 60000) problems.push("A data e hora de entrega já passaram.");
  const units = cart.reduce((s, c) => s + c.quantity, 0);

  function review(e) {
    e.preventDefault();
    setTried(true);
    setError("");
    if (!problems.length) setConfirming(true);
  }

  async function send() {
    setBusy(true);
    setError("");
    try {
      const order = await api("/orders/", {
        method: "POST",
        body: {
          customer_name: form.customer_name.trim(),
          customer_phone: form.customer_phone.trim(),
          due_at: dueDate.toISOString(),
          notes: form.notes.trim(),
          items: cart.map((c) => ({ product: c.product.id, quantity: c.quantity, notes: c.notes.trim() })),
        },
      });
      setConfirming(false);
      setDone(order);
      toast(`Encomenda #${order.id} enviada para a fábrica.`);
    } catch (err) {
      setError(err.message);
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setDone(null);
    setCart([]);
    setForm(emptyCustomer());
    setTried(false);
    setSearch("");
    window.scrollTo({ top: 0 });
  }

  return (
    <div className="page">
      <PageHeader
        title="Nova encomenda"
        subtitle={`${establishment.name} · vai direto para a fábrica.`}
        actions={<button className="btn btn-ghost" onClick={() => navigate("/encomendas")}><Icon name="back" /> Encomendas</button>}
      />
      <form className="grid-entry" onSubmit={review} noValidate>
        <div className="entry-form">
          <section className="card">
            <h2 className="card-title step"><span className="step-n">1</span> Produtos</h2>
            <div className="toolbar">
              <SearchBox value={search} onChange={setSearch} placeholder="Buscar produto…" />
            </div>
            {groups.length > 1 && <Chips options={groups.map((g) => ({ value: g, label: g }))} value={group} onChange={setGroup} allLabel="Todos" />}
            <ErrorBox error={products.error} onRetry={products.reload} />
            {products.loading && !products.data ? <Spinner /> : visible.length === 0 ? (
              <Empty icon="cake" title={all.length ? "Nenhum produto encontrado" : "Nenhum produto cadastrado"}>
                {!all.length && "Peça à fábrica para cadastrar o catálogo em “Produtos”."}
              </Empty>
            ) : (
              <div className="prod-grid">
                {visible.map((p) => {
                  const q = qtyOf(p.id);
                  return (
                    <button type="button" key={p.id} className={`prod-tile ${q ? "on" : ""}`} onClick={() => add(p)}>
                      {p.group && <span className="tile-cat">{p.group}</span>}
                      <span className="prod-name">{p.name}</span>
                      {p.description && <span className="muted small">{p.description}</span>}
                      <span className="prod-add">{q ? <><b>{q}</b> no pedido</> : <><Icon name="plus" size={16} /> Adicionar</>}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <section className="card">
            <h2 className="card-title step"><span className="step-n">2</span> Cliente e entrega</h2>
            <div className="auto-grid">
              <Field label="Nome do cliente *" className="ag-wide" error={tried && !form.customer_name.trim() ? "Obrigatório" : ""}>
                <input className="input input-lg" value={form.customer_name} onChange={set("customer_name")} autoComplete="off" maxLength={120} />
              </Field>
              <Field label="Telefone">
                <input className="input input-lg" value={form.customer_phone} onChange={set("customer_phone")}
                       inputMode="tel" placeholder="(21) 99999-9999" autoComplete="off" />
              </Field>
              <Field label="Dia da entrega *" error={tried && !form.date ? "Obrigatório" : ""}>
                <input className="input input-lg" type="date" min={todayISO()} value={form.date} onChange={set("date")} />
              </Field>
              <Field label="Hora *" error={tried && !form.time ? "Obrigatório" : ""}>
                <input className="input input-lg" type="time" value={form.time} onChange={set("time")} step={300} />
              </Field>
              <Field label="Observações da encomenda" className="ag-wide" hint="Ex.: retirada pelo marido, sinal pago no Pix, alergia…">
                <textarea className="input" value={form.notes} onChange={set("notes")} rows={2} />
              </Field>
            </div>
          </section>
        </div>

        <aside className="entry-summary card">
          <h2 className="card-title">Resumo</h2>
          {cart.length === 0 ? (
            <p className="muted">Toque nos produtos para adicionar.</p>
          ) : (
            <ul className="cart">
              {cart.map((c) => (
                <li key={c.product.id} className="cart-row">
                  <div className="cart-line">
                    <span className="grow"><strong>{c.product.name}</strong></span>
                    <div className="stepper" role="group" aria-label={`Quantidade de ${c.product.name}`}>
                      <button type="button" className="icon-btn" onClick={() => add(c.product, -1)}
                              aria-label={c.quantity === 1 ? "Remover" : "Diminuir"}>
                        <Icon name={c.quantity === 1 ? "trash" : "minus"} size={18} />
                      </button>
                      <input className="stepper-val" inputMode="numeric" value={c.quantity} aria-label="Quantidade"
                             onChange={(e) => {
                               const n = parseInt(e.target.value.replace(/\D/g, ""), 10);
                               patch(c.product.id, { quantity: Math.min(MAX_QTY, Math.max(1, n || 1)) });
                             }} />
                      <button type="button" className="icon-btn" onClick={() => add(c.product, 1)} aria-label="Aumentar">
                        <Icon name="plus" size={18} />
                      </button>
                    </div>
                  </div>
                  {c.showNotes || c.notes ? (
                    <input className="input cart-note" value={c.notes} maxLength={255} autoFocus={c.showNotes && !c.notes}
                           placeholder="Ex.: escrever “Parabéns, Ana”, sem açúcar…"
                           onChange={(e) => patch(c.product.id, { notes: e.target.value })} />
                  ) : (
                    <button type="button" className="link-btn small" onClick={() => patch(c.product.id, { showNotes: true })}>
                      + observação deste item
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {dueDate && !Number.isNaN(dueDate.getTime()) && (
            <p className="cart-due"><Icon name="clock" size={18} /> Entrega: <b>{fmtDue(dueDate)}</b></p>
          )}
          {tried && problems.length > 0 && (
            <ul className="problems">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
          )}
          {error && <div className="alert alert-error"><Icon name="alert" /><span>{error}</span></div>}
          <button className="btn btn-primary btn-lg btn-block" type="submit">
            Revisar e enviar{units ? ` (${units} ${units === 1 ? "item" : "itens"})` : ""}
          </button>
        </aside>
      </form>

      {confirming && (
        <Modal open onClose={() => !busy && setConfirming(false)} title="Confira a encomenda" size="sm"
          footer={<>
            <button className="btn btn-ghost" onClick={() => setConfirming(false)} disabled={busy}>Corrigir</button>
            <button className="btn btn-primary grow" onClick={send} disabled={busy}>{busy ? "Enviando…" : "Enviar para a fábrica"}</button>
          </>}>
          <div className="alert alert-warn"><Icon name="alert" /><span>Depois de enviada, a encomenda <b>não pode ser editada</b>.</span></div>
          <dl className="ord-dl">
            <dt>Cliente</dt><dd><strong>{form.customer_name.trim()}</strong>{form.customer_phone && ` · ${form.customer_phone}`}</dd>
            <dt>Entrega</dt><dd><strong>{fmtDue(dueDate)}</strong></dd>
          </dl>
          <ul className="ord-items ord-items-lg">
            {cart.map((c) => (
              <li key={c.product.id}><b>{c.quantity}×</b> {c.product.name}{c.notes.trim() && <span className="ord-item-note">{c.notes.trim()}</span>}</li>
            ))}
          </ul>
          {form.notes.trim() && <p className="ord-notes-box">{form.notes.trim()}</p>}
        </Modal>
      )}

      {done && (
        <Modal open onClose={reset} title="Encomenda enviada!" size="sm"
          footer={<>
            <button className="btn btn-ghost" onClick={() => navigate("/encomendas")}>Ver encomendas</button>
            <button className="btn btn-primary grow" onClick={reset}><Icon name="plus" /> Nova encomenda</button>
          </>}>
          <div className="done-box">
            <span className="done-icon"><Icon name="check" size={32} /></span>
            <p className="done-num">#{done.id}</p>
            <p><strong>{done.customer_name}</strong> · {fmtDue(done.due_at)}</p>
            <p className="muted small">Já está no quadro da fábrica.</p>
            <button className="btn btn-ghost btn-block" onClick={() => printOrders([done], { via: "VIA DO CLIENTE" })}>
              <Icon name="printer" /> Imprimir via do cliente
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
