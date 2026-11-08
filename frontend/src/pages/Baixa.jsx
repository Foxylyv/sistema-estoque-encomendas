import { useMemo, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import Icon from "../components/Icon";
import QuantityPad from "../components/QuantityPad";
import {
  Chips, Empty, ErrorBox, Field, Modal, PageHeader, Qty, SearchBox, Spinner, StockBar, useLoad, useToast,
} from "../components/ui";
import { fmtQty, fmtWhen, parseQty } from "../format";

const FACTOR = { kg: 1000, g: 1, L: 1000, ml: 1, un: 1 };
const convert = (q, from, to) => (q * FACTOR[from]) / FACTOR[to];

function normalize(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export default function Baixa() {
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [selected, setSelected] = useState(null);
  const [onlyAlerts, setOnlyAlerts] = useState(false);
  const { meta } = useAuth();

  const cats = useLoad(() => api("/categories/"), []);
  const ings = useLoad(() => api("/ingredients/", { params: { page_size: 1000 } }), []);
  const recent = useLoad(() => api("/movements/", { params: { kind: ["consumo", "perda"], page_size: 6 } }), []);

  const list = useMemo(() => {
    const all = ings.data?.results || [];
    const q = normalize(search.trim());
    return all.filter(
      (i) =>
        (!category || String(i.category) === String(category)) &&
        (!q || normalize(i.name).includes(q)) &&
        (!onlyAlerts || i.status !== "normal")
    );
  }, [ings.data, search, category, onlyAlerts]);

  const all = ings.data?.results || [];
  const zero = all.filter((i) => i.status === "zerado").length;
  const low = all.filter((i) => i.status === "baixo").length;

  function afterChange() {
    ings.reload();
    recent.reload();
  }

  async function undo(mov) {
    try {
      await api(`/movements/${mov.id}/estornar/`, { method: "POST", body: { notes: "Desfeito pela cozinha" } });
      toast("Lançamento desfeito. Saldo restaurado.");
      afterChange();
    } catch (e) {
      toast(e.message, { tone: "error" });
    }
  }

  function onSaved(mov) {
    setSelected(null);
    toast(
      `${mov.kind_display}: ${fmtQty(mov.input_quantity)} ${mov.input_unit} de ${mov.ingredient_name}`,
      { action: { label: "Desfazer", onClick: () => undo(mov) }, duration: 7000 }
    );
    afterChange();
  }

  const catOptions = (cats.data || [])
    .filter((c) => c.ingredient_count > 0)
    .map((c) => ({ value: c.id, label: c.name }));

  return (
    <div className="page">
      <PageHeader
        title="Registrar consumo"
        subtitle="Toque no ingrediente usado e informe a quantidade."
        help={<>
          <p>1. Toque no ingrediente (use a busca ou as categorias).</p>
          <p>2. Digite a quantidade usada. Você pode escolher a unidade: por exemplo, <b>g</b> para um item controlado em kg.</p>
          <p>3. Toque em <b>Confirmar</b>. O saldo é atualizado na hora.</p>
          <p>Errou? Toque em <b>Desfazer</b> no aviso ou em “Seus últimos lançamentos” (até {meta.kitchen_undo_minutes} minutos).</p>
          <p>Use <b>Perda / descarte</b> para itens vencidos ou estragados.</p>
        </>}
      />

      {(zero > 0 || low > 0) && (
        <button className={`stock-alert ${onlyAlerts ? "on" : ""}`} onClick={() => setOnlyAlerts((v) => !v)}>
          <Icon name="alert" size={22} />
          <span className="stock-alert-text">
            {zero > 0 && <strong className="sa-zero">{zero} {zero === 1 ? "esgotado" : "esgotados"}</strong>}
            {low > 0 && <strong className="sa-low">{low} acabando</strong>}
          </span>
          <span className="stock-alert-cta">{onlyAlerts ? "Mostrar todos" : "Ver só esses"}</span>
        </button>
      )}

      <div className="sticky-tools">
        <SearchBox value={search} onChange={setSearch} placeholder="Buscar ingrediente…" />
        <Chips options={catOptions} value={category} onChange={setCategory} />
      </div>

      <ErrorBox error={ings.error} onRetry={ings.reload} />
      {ings.loading && !ings.data ? (
        <Spinner />
      ) : list.length === 0 ? (
        <Empty icon="search" title="Nenhum ingrediente encontrado">Tente outro nome ou categoria.</Empty>
      ) : (
        <div className="tile-grid">
          {list.map((i) => (
            <button key={i.id} className={`tile tile-${i.status}`} onClick={() => setSelected(i)}>
              <span className="tile-top">
                <span className="tile-cat">{i.category_name}</span>
                {i.status !== "normal" && (
                  <span className={`tile-flag flag-${i.status}`}>{i.status === "zerado" ? "Esgotado" : "Acabando"}</span>
                )}
              </span>
              <span className="tile-name">{i.name}</span>
              <span className="tile-foot">
                <Qty value={i.stock} unit={i.unit} />
              </span>
              <StockBar stock={i.stock} min={i.min_stock} />
            </button>
          ))}
        </div>
      )}

      <section className="section">
        <h2 className="section-title">Seus últimos lançamentos</h2>
        {recent.data?.results?.length ? (
          <ul className="move-list card">
            {recent.data.results.map((m) => (
              <li key={m.id} className={m.is_reversed ? "reversed" : ""}>
                <div className="move-main">
                  <strong>{m.ingredient_name}</strong>
                  <span className="muted">
                    {m.kind_display} · {fmtWhen(m.created_at)}
                    {m.is_reversed && " · desfeito"}
                  </span>
                </div>
                <span className="move-qty out">
                  −{fmtQty(m.input_quantity)} <small>{m.input_unit}</small>
                </span>
                {m.can_reverse && (
                  <button className="btn btn-ghost btn-sm" onClick={() => undo(m)}>
                    <Icon name="undo" size={16} /> Desfazer
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          !recent.loading && <p className="muted">Nenhum lançamento ainda.</p>
        )}
      </section>

      {selected && <ExitSheet ingredient={selected} onClose={() => setSelected(null)} onSaved={onSaved} />}
    </div>
  );
}

function ExitSheet({ ingredient, onClose, onSaved }) {
  const { meta } = useAuth();
  const units = ingredient.compatible_units;
  // Para itens em kg/L, sugere a unidade menor (g/ml), mais comum no preparo.
  const defaultUnit = ingredient.unit === "kg" ? "g" : ingredient.unit === "L" ? "ml" : ingredient.unit;
  const [unit, setUnit] = useState(defaultUnit);
  const [value, setValue] = useState("");
  const [kind, setKind] = useState("consumo");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const qty = parseQty(value);
  const valid = qty > 0;
  const inBase = valid ? convert(qty, unit, ingredient.unit) : 0;
  const after = Number(ingredient.stock) - inBase;
  const exceeds = valid && after < -1e-9 && !meta.allow_negative_stock;
  const needsReason = kind === "perda" && !notes.trim();

  async function save() {
    if (!valid || exceeds || needsReason) return;
    setBusy(true);
    setError("");
    try {
      const mov = await api("/movements/saida/", {
        method: "POST",
        body: { ingredient: ingredient.id, quantity: qty.toFixed(3), unit, kind, notes },
      });
      onSaved(mov);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={ingredient.name}
      size="sheet"
      footer={
        <>
          <button className="btn btn-ghost btn-lg" onClick={onClose}>Cancelar</button>
          <button
            className="btn btn-primary btn-lg grow"
            onClick={save}
            disabled={!valid || exceeds || needsReason || busy}
          >
            <Icon name="check" /> {busy ? "Salvando…" : `Confirmar ${kind === "perda" ? "perda" : "saída"}`}
          </button>
        </>
      }
    >
      <div className="exit-sheet">
        <div className="exit-left">
          <div className="exit-balance">
            <span className="muted">Saldo atual</span>
            <Qty value={ingredient.stock} unit={ingredient.unit} className="qty-lg" />
          </div>

          <div className="segmented" role="radiogroup" aria-label="Tipo de saída">
            {[["consumo", "Consumo"], ["perda", "Perda / descarte"]].map(([v, l]) => (
              <button key={v} role="radio" aria-checked={kind === v} className={kind === v ? "on" : ""} onClick={() => setKind(v)}>
                {l}
              </button>
            ))}
          </div>

          <div className={`qty-display ${exceeds ? "is-error" : ""}`}>
            <input
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value.replace(/[^\d,.]/g, "").replace(".", ","))}
              onKeyDown={(e) => e.key === "Enter" && save()}
              placeholder="0"
              aria-label="Quantidade"
            />
            <span className="qty-display-unit">{unit}</span>
          </div>

          {units.length > 1 && (
            <div className="segmented" role="radiogroup" aria-label="Unidade">
              {units.map((u) => (
                <button key={u} role="radio" aria-checked={unit === u} className={unit === u ? "on" : ""} onClick={() => setUnit(u)}>
                  {u}
                </button>
              ))}
            </div>
          )}

          <p className={`exit-after ${exceeds || after < 0 ? "text-error" : ""}`}>
            {exceeds ? (
              <><Icon name="alert" size={18} /> Quantidade maior que o saldo disponível.</>
            ) : valid ? (
              <>Saldo após a baixa: <strong>{fmtQty(after)} {ingredient.unit}</strong></>
            ) : (
              "Digite a quantidade utilizada."
            )}
          </p>

          {kind === "perda" && (
            <Field label="Motivo da perda" error={needsReason && valid ? "Obrigatório para perdas." : ""}>
              <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex.: vencido, caiu no chão…" />
            </Field>
          )}
          {error && <div className="alert alert-error"><Icon name="alert" /><span>{error}</span></div>}
        </div>
        <QuantityPad value={value} onChange={setValue} />
      </div>
    </Modal>
  );
}
