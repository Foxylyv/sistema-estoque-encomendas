import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import Icon from "../components/Icon";
import { Empty, ErrorBox, Field, HelpTip, Modal, PageHeader, Spinner, useLoad, useToast } from "../components/ui";
import { fmtDate, fmtDateTime, fmtMoney, fmtQty, parseQty, todayISO } from "../format";
import { IngredientForm } from "./Ingredientes";

const FACTOR = { kg: 1000, g: 1, L: 1000, ml: 1, un: 1 };
const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const emptyHead = () => ({ supplier: "", invoice_number: "", invoice_date: todayISO(), notes: "" });

export default function Entrada() {
  const toast = useToast();
  const { can } = useAuth();
  const ings = useLoad(() => api("/ingredients/", { params: { page_size: 1000 } }), []);
  const cats = useLoad(() => api("/categories/"), []);
  const suppliers = useLoad(() => api("/entries/fornecedores/"), []);
  const entries = useLoad(() => api("/entries/"), []);

  const [head, setHead] = useState(emptyHead);
  const [items, setItems] = useState([]); // { ingredient, quantity, unit, total }
  const [showNotes, setShowNotes] = useState(false);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState(null);
  const [creating, setCreating] = useState(null);

  const addItem = (ing) => {
    setItems((list) => (list.some((it) => it.ingredient.id === ing.id) ? list : [...list, { ingredient: ing, quantity: "", unit: ing.unit, total: "" }]));
    setTimeout(() => document.getElementById(`qty-${ing.id}`)?.focus(), 50);
  };
  const setItem = (id, patch) => setItems((l) => l.map((it) => (it.ingredient.id === id ? { ...it, ...patch } : it)));
  const removeItem = (id) => setItems((l) => l.filter((it) => it.ingredient.id !== id));

  const total = items.reduce((s, it) => s + (parseQty(it.total) > 0 ? parseQty(it.total) : 0), 0);
  const missingQty = items.filter((it) => !(parseQty(it.quantity) > 0));
  const problems = [];
  if (!head.supplier.trim()) problems.push("Informe o fornecedor.");
  if (!head.invoice_date) problems.push("Informe a data da nota.");
  if (!items.length) problems.push("Adicione ao menos um item.");
  if (missingQty.length) problems.push(`Falta a quantidade de ${missingQty.length === 1 ? missingQty[0].ingredient.name : `${missingQty.length} itens`}.`);

  async function submit(e) {
    e.preventDefault();
    setTried(true);
    if (problems.length) return;
    setBusy(true);
    setError("");
    try {
      const entry = await api("/entries/", {
        method: "POST",
        body: {
          ...head,
          supplier: head.supplier.trim(),
          items: items.map((it) => ({
            ingredient: it.ingredient.id,
            quantity: parseQty(it.quantity).toFixed(3),
            unit: it.unit,
            total_cost: parseQty(it.total) > 0 ? parseQty(it.total).toFixed(2) : null,
          })),
        },
      });
      toast(`Entrada registrada: ${items.length} ${items.length === 1 ? "item" : "itens"} de ${entry.supplier}.`);
      setHead(emptyHead());
      setItems([]);
      setTried(false);
      setShowNotes(false);
      entries.reload();
      suppliers.reload();
      ings.reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="Entrada de mercadorias"
        subtitle="Confira a mercadoria com a nota e lance o que chegou."
        help={<>
          <p><b>1.</b> Preencha o fornecedor e a data da nota (o número é opcional, mas ajuda a conferir depois).</p>
          <p><b>2.</b> Busque cada ingrediente que chegou e digite a quantidade. Pode usar outra unidade compatível, como <b>g</b> para um item em kg.</p>
          <p><b>3.</b> O valor é opcional: digite o <b>total do item na nota</b>, não o preço unitário.</p>
          <p><b>4.</b> Confira o resumo e toque em <b>Confirmar entrada</b>. O saldo é somado na hora.</p>
          <p>Lançou errado? Abra a entrada em “Entradas recentes” e cancele (precisa da permissão de estorno).</p>
        </>}
      />

      <div className="grid-entry">
        <form className="entry-form" onSubmit={submit} noValidate>
          <section className="card">
            <h2 className="card-title step"><span className="step-n">1</span> Nota fiscal</h2>
            <div className="auto-grid">
              <Field label="Fornecedor *" className="ag-wide" error={tried && !head.supplier.trim() ? "Obrigatório" : ""}>
                <input className="input" list="suppliers" value={head.supplier} placeholder="Nome do fornecedor"
                       onChange={(e) => setHead({ ...head, supplier: e.target.value })} />
                <datalist id="suppliers">
                  {(suppliers.data || []).map((s) => <option key={s} value={s} />)}
                </datalist>
              </Field>
              <Field label="Nº da nota">
                <input className="input" value={head.invoice_number} inputMode="numeric" placeholder="Opcional"
                       onChange={(e) => setHead({ ...head, invoice_number: e.target.value })} />
              </Field>
              <Field label="Data da nota *">
                <input className="input" type="date" value={head.invoice_date} max={todayISO()}
                       onChange={(e) => setHead({ ...head, invoice_date: e.target.value })} />
              </Field>
            </div>
          </section>

          <section className="card">
            <h2 className="card-title step"><span className="step-n">2</span> O que chegou</h2>
            {ings.loading && !ings.data ? <Spinner /> : (
              <IngredientPicker
                ingredients={ings.data?.results || []}
                selected={items.map((it) => it.ingredient.id)}
                onPick={addItem}
                onCreate={can("ingredientes") ? (name) => setCreating(name) : null}
              />
            )}

            {items.length === 0 ? (
              <p className={`items-empty ${tried ? "text-error" : "muted"}`}>
                Nenhum item ainda. Busque acima e toque no ingrediente para adicionar.
              </p>
            ) : (
              <ul className="entry-items">
                {items.map((it) => (
                  <EntryItemRow key={it.ingredient.id} item={it} tried={tried}
                                onChange={(patch) => setItem(it.ingredient.id, patch)}
                                onRemove={() => removeItem(it.ingredient.id)} />
                ))}
              </ul>
            )}

            {showNotes ? (
              <Field label="Observações" className="mt">
                <textarea className="input" rows={2} value={head.notes} autoFocus
                          onChange={(e) => setHead({ ...head, notes: e.target.value })} />
              </Field>
            ) : (
              <button type="button" className="link-btn mt" onClick={() => setShowNotes(true)}>
                <Icon name="plus" size={16} /> Adicionar observação
              </button>
            )}
          </section>

          <section className="card entry-summary">
            <h2 className="card-title step"><span className="step-n">3</span> Conferir e confirmar</h2>
            <div className="summary-line">
              <span>{items.length} {items.length === 1 ? "item" : "itens"}{head.supplier ? ` · ${head.supplier}` : ""}</span>
              {total > 0 && <strong className="total">{fmtMoney(total)}</strong>}
            </div>
            {tried && problems.length > 0 && (
              <ul className="problems">
                {problems.map((p) => <li key={p}><Icon name="alert" size={16} /> {p}</li>)}
              </ul>
            )}
            {error && <div className="alert alert-error"><Icon name="alert" /><span>{error}</span></div>}
            <button className="btn btn-primary btn-lg btn-block" disabled={busy}>
              <Icon name="check" /> {busy ? "Registrando…" : "Confirmar entrada"}
            </button>
          </section>
        </form>

        <section className="card recent-entries">
          <h2 className="card-title">Entradas recentes</h2>
          <ErrorBox error={entries.error} onRetry={entries.reload} />
          {entries.loading && !entries.data ? <Spinner /> : entries.data?.results?.length ? (
            <ul className="entry-list">
              {entries.data.results.slice(0, 12).map((e) => (
                <li key={e.id}>
                  <button className={`entry-row ${e.is_cancelled ? "reversed" : ""}`} onClick={() => setView(e)}>
                    <div>
                      <strong>{e.supplier}</strong>
                      <span className="muted small">
                        {e.invoice_number ? `NF ${e.invoice_number} · ` : ""}{fmtDate(e.invoice_date)}
                        {e.is_cancelled && " · cancelada"}
                      </span>
                    </div>
                    <span className="muted small nowrap">{e.movements.filter((m) => m.kind === "entrada").length} itens</span>
                    <Icon name="chevron" size={18} />
                  </button>
                </li>
              ))}
            </ul>
          ) : <Empty icon="receipt" title="Nenhuma entrada ainda" />}
        </section>
      </div>

      {view && (
        <EntryDetail entry={view} onClose={() => setView(null)}
                     onChanged={() => { setView(null); entries.reload(); ings.reload(); }} />
      )}
      {creating !== null && (
        <IngredientForm
          ingredient={{}}
          presetName={creating}
          categories={cats.data || []}
          onClose={() => setCreating(null)}
          onSaved={(saved) => { setCreating(null); ings.reload(); if (saved) addItem(saved); }}
        />
      )}
    </div>
  );
}

/** Busca de ingredientes com sugestões. Sem texto, sugere o que está acabando. */
function IngredientPicker({ ingredients, selected, onPick, onCreate }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  const results = useMemo(() => {
    const t = norm(q.trim());
    const avail = ingredients.filter((i) => !selected.includes(i.id));
    if (!t) return avail.filter((i) => i.status !== "normal").slice(0, 8);
    // Quem bate pelo nome vem antes de quem bate só pela categoria.
    const byName = avail.filter((i) => norm(i.name).includes(t))
      .sort((a, b) => norm(a.name).indexOf(t) - norm(b.name).indexOf(t));
    const byCat = avail.filter((i) => !norm(i.name).includes(t) && norm(i.category_name).includes(t));
    return [...byName, ...byCat].slice(0, 8);
  }, [q, ingredients, selected]);

  const pick = (i) => { onPick(i); setQ(""); setOpen(false); };

  return (
    <div className="picker" ref={ref}>
      <label className="search">
        <Icon name="search" size={20} />
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); if (results[0]) pick(results[0]); }
            if (e.key === "Escape") setOpen(false);
          }}
          placeholder="Buscar ingrediente para adicionar…"
          aria-label="Buscar ingrediente para adicionar"
          autoComplete="off"
        />
      </label>
      {open && (
        <div className="picker-pop" role="listbox">
          {!q.trim() && results.length > 0 && <div className="picker-hint">Sugestões: itens acabando nesta unidade</div>}
          {results.map((i) => (
            <button type="button" key={i.id} role="option" className="picker-opt" onClick={() => pick(i)}>
              <span className="grow">
                <strong>{i.name}</strong>
                <span className="muted small block">{i.category_name}</span>
              </span>
              <span className={`picker-stock st-${i.status}`}>{fmtQty(i.stock)} {i.unit}</span>
              <Icon name="plus" size={18} />
            </button>
          ))}
          {q.trim() && results.length === 0 && (
            <div className="picker-hint">Nenhum ingrediente com “{q}”.</div>
          )}
          {q.trim() && onCreate && (
            <button type="button" className="picker-opt picker-new" onClick={() => { onCreate(q.trim()); setOpen(false); setQ(""); }}>
              <Icon name="plus" size={18} /> <span className="grow">Cadastrar “{q.trim()}” como novo ingrediente</span>
            </button>
          )}
          {!q.trim() && results.length === 0 && <div className="picker-hint">Digite o nome do ingrediente.</div>}
        </div>
      )}
    </div>
  );
}

function EntryItemRow({ item, tried, onChange, onRemove }) {
  const ing = item.ingredient;
  const q = parseQty(item.quantity);
  const after = q > 0 ? Number(ing.stock) + (q * FACTOR[item.unit]) / FACTOR[ing.unit] : null;
  const missing = tried && !(q > 0);
  return (
    <li className={`entry-item ${missing ? "has-error" : ""}`}>
      <div className="ei-head">
        <div className="grow">
          <strong>{ing.name}</strong>
          <span className="muted small block">
            {ing.category_name} · saldo {fmtQty(ing.stock)} {ing.unit}
            {after !== null && <> → <b className="text-ok">{fmtQty(after)} {ing.unit}</b></>}
          </span>
        </div>
        <button type="button" className="icon-btn" onClick={onRemove} aria-label={`Remover ${ing.name}`}>
          <Icon name="x" />
        </button>
      </div>
      <div className="ei-fields">
        <Field label="Quantidade *" className="ei-qty" error={missing ? "Informe a quantidade" : ""}>
          <div className="qty-unit">
            <input id={`qty-${ing.id}`} className="input" inputMode="decimal" value={item.quantity} placeholder="0"
                   onChange={(e) => onChange({ quantity: e.target.value })} />
            {ing.compatible_units.length > 1 ? (
              <div className="segmented seg-sm">
                {ing.compatible_units.map((u) => (
                  <button type="button" key={u} className={item.unit === u ? "on" : ""} onClick={() => onChange({ unit: u })}>{u}</button>
                ))}
              </div>
            ) : (
              <span className="unit-tag">{ing.unit}</span>
            )}
          </div>
        </Field>
        <Field label={<>Valor total do item <span className="muted">(opcional)</span></>} className="ei-cost">
          <div className="money">
            <span>R$</span>
            <input className="input" inputMode="decimal" value={item.total} placeholder="0,00"
                   onChange={(e) => onChange({ total: e.target.value })} />
          </div>
        </Field>
      </div>
    </li>
  );
}

function EntryDetail({ entry, onClose, onChanged }) {
  const toast = useToast();
  const { can } = useAuth();
  const [confirm, setConfirm] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const items = entry.movements.filter((m) => m.kind === "entrada");

  async function cancel() {
    setBusy(true);
    try {
      await api(`/entries/${entry.id}/cancelar/`, { method: "POST", body: { notes: reason } });
      toast("Entrada cancelada. Os saldos foram estornados.");
      onChanged();
    } catch (e) {
      toast(e.message, { tone: "error" });
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={entry.supplier} size="md"
      footer={!entry.is_cancelled && can("estorno") && (confirm ? (
        <>
          <button className="btn btn-ghost" onClick={() => setConfirm(false)}>Voltar</button>
          <button className="btn btn-danger grow" onClick={cancel} disabled={busy}>Confirmar cancelamento</button>
        </>
      ) : (
        <>
          <button className="btn btn-ghost btn-danger-text" onClick={() => setConfirm(true)}>
            <Icon name="undo" /> Cancelar entrada
          </button>
          <HelpTip title="Cancelar entrada">Estorna todos os itens desta nota. A entrada e o estorno continuam no histórico.</HelpTip>
        </>
      ))}
    >
      <dl className="dl">
        <div><dt>Nota fiscal</dt><dd>{entry.invoice_number || "—"}</dd></div>
        <div><dt>Data da nota</dt><dd>{fmtDate(entry.invoice_date)}</dd></div>
        <div><dt>Lançado por</dt><dd>{entry.created_by_name}</dd></div>
        <div><dt>Lançado em</dt><dd>{fmtDateTime(entry.created_at)}</dd></div>
      </dl>
      {entry.notes && <p className="muted">{entry.notes}</p>}
      <table className="table mt">
        <thead><tr><th>Item</th><th className="num">Qtd.</th><th className="num">Valor</th></tr></thead>
        <tbody>
          {items.map((m) => (
            <tr key={m.id} className={m.is_reversed ? "reversed" : ""}>
              <td>{m.ingredient_name}</td>
              <td className="num nowrap">{fmtQty(m.input_quantity)} {m.input_unit}</td>
              <td className="num nowrap">{m.total_cost != null ? fmtMoney(m.total_cost) : "—"}</td>
            </tr>
          ))}
        </tbody>
        {Number(entry.total_cost) > 0 && (
          <tfoot><tr><td colSpan={2}>Total</td><td className="num">{fmtMoney(entry.total_cost)}</td></tr></tfoot>
        )}
      </table>
      {confirm && (
        <Field label="Motivo do cancelamento" className="mt">
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)}
                 placeholder="Ex.: nota lançada em duplicidade" autoFocus />
        </Field>
      )}
      {entry.is_cancelled && <div className="alert mt"><Icon name="undo" /><span>Esta entrada foi cancelada.</span></div>}
    </Modal>
  );
}
