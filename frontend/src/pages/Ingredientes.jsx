import { useMemo, useState } from "react";
import { api, download } from "../api";
import { useAuth } from "../auth";
import AdjustForm from "../components/AdjustForm";
import Icon from "../components/Icon";
import {
  Chips, Empty, ErrorBox, ExportButton, Field, Modal, PageHeader, Qty, SearchBox, SortSelect, SortTh, Spinner,
  StatusBadge, sortList, useLoad, useSort, useToast,
} from "../components/ui";
import { fmtQty, parseQty } from "../format";

const UNITS = [
  ["kg", "Quilograma (kg)"], ["g", "Grama (g)"], ["L", "Litro (L)"], ["ml", "Mililitro (ml)"], ["un", "Unidade (un)"],
];
const COMPATIBLE = { kg: ["kg", "g"], g: ["kg", "g"], L: ["L", "ml"], ml: ["L", "ml"], un: ["un"] };
const GETTERS = {
  name: (i) => i.name,
  category: (i) => i.category_name,
  unit: (i) => i.unit,
  min: (i) => Number(i.min_stock),
  stock: (i) => Number(i.stock),
};
const SORT_OPTIONS = [
  { value: "name", label: "Nome" },
  { value: "category", label: "Categoria" },
  { value: "unit", label: "Unidade" },
  { value: "min", label: "Mínimo" },
  { value: "stock", label: "Saldo" },
];
const API_ORDER = { name: "name", category: "category__name", unit: "unit", min: "min_stock", stock: "stock" };

export default function Ingredientes() {
  const { establishment, can } = useAuth();
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState("");
  const [editing, setEditing] = useState(null);
  const [catsOpen, setCatsOpen] = useState(false);
  const { sort, setSort, toggle } = useSort("name");

  const cats = useLoad(() => api("/categories/"), []);
  const ings = useLoad(
    () => api("/ingredients/", { params: { page_size: 1000, active: showInactive ? "false" : "true" } }),
    [showInactive]
  );

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = (ings.data?.results || []).filter(
      (i) => !q || i.name.toLowerCase().includes(q) || i.category_name.toLowerCase().includes(q)
    );
    return sortList(filtered, sort, GETTERS);
  }, [ings.data, search, sort]);

  const exportXlsx = () =>
    download("/ingredients/export/", {
      params: { search, active: showInactive ? "false" : "true", ordering: `${sort.dir === "desc" ? "-" : ""}${API_ORDER[sort.key]}` },
    });

  return (
    <div className="page">
      <PageHeader
        title="Ingredientes"
        subtitle={`Catálogo compartilhado entre as unidades · mínimo e saldo de ${establishment?.name || "—"}`}
        help={<>
          <p>O <b>nome, a categoria e a unidade</b> valem para todas as cafeterias. O <b>estoque mínimo e o saldo</b> são da unidade selecionada.</p>
          <p>Ao cadastrar, você pode informar o <b>saldo inicial</b>; ele entra no histórico como “Saldo inicial”.</p>
          <p>Para corrigir um saldo depois, abra o ingrediente e use <b>Corrigir saldo</b>. O ajuste fica registrado com seu nome e o motivo.</p>
          <p>Toque no título de uma coluna para ordenar.</p>
        </>}
        actions={
          <>
            {can("exportar") && <ExportButton onExport={exportXlsx} />}
            <button className="btn btn-ghost" onClick={() => setCatsOpen(true)}><Icon name="tag" /> Categorias</button>
            <button className="btn btn-primary" onClick={() => setEditing({})}><Icon name="plus" /> Novo ingrediente</button>
          </>
        }
      />
      <div className="toolbar">
        <SearchBox value={search} onChange={setSearch} placeholder="Buscar por nome ou categoria…" />
        <Chips options={[{ value: "1", label: "Inativos" }]} value={showInactive} onChange={setShowInactive} allLabel="Ativos" />
      </div>
      <SortSelect className="show-sm-flex" options={SORT_OPTIONS} sort={sort} setSort={setSort} />

      <ErrorBox error={ings.error} onRetry={ings.reload} />
      {ings.loading && !ings.data ? <Spinner /> : list.length === 0 ? (
        <Empty icon="tag" title="Nenhum ingrediente">Cadastre o primeiro item para começar.</Empty>
      ) : (
        <div className="card table-card">
          <table className="table">
            <thead>
              <tr>
                <SortTh label="Nome" k="name" sort={sort} onSort={toggle} />
                <SortTh label="Categoria" k="category" sort={sort} onSort={toggle} className="hide-sm" />
                <SortTh label="Unid." k="unit" sort={sort} onSort={toggle} className="hide-sm" />
                <SortTh label="Mínimo" k="min" sort={sort} onSort={toggle} className="num" />
                <SortTh label="Saldo" k="stock" sort={sort} onSort={toggle} className="num" />
                <th aria-label="Ações" />
              </tr>
            </thead>
            <tbody>
              {list.map((i) => (
                <tr key={i.id} className={`clickable row-${i.status}`} onClick={() => setEditing(i)}>
                  <td>
                    <strong>{i.name}</strong>
                    <span className="show-sm muted small block">{i.category_name} · {i.unit}</span>
                  </td>
                  <td className="hide-sm muted">{i.category_name}</td>
                  <td className="hide-sm">{i.unit}</td>
                  <td className="num">{fmtQty(i.min_stock)}</td>
                  <td className="num"><Qty value={i.stock} unit={i.unit} /></td>
                  <td className="actions"><Icon name="edit" size={18} className="muted" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <IngredientForm
          ingredient={editing}
          categories={cats.data || []}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); ings.reload(); cats.reload(); }}
        />
      )}
      {catsOpen && <CategoriesModal cats={cats} onClose={() => { setCatsOpen(false); ings.reload(); }} />}
    </div>
  );
}

export function IngredientForm({ ingredient, categories, onClose, onSaved, presetName = "" }) {
  const toast = useToast();
  const { can, establishment } = useAuth();
  const isNew = !ingredient.id;
  const [form, setForm] = useState({
    name: ingredient.name || presetName,
    category: ingredient.category || categories[0]?.id || "",
    unit: ingredient.unit || "kg",
    min_stock: ingredient.min_stock != null ? String(ingredient.min_stock).replace(".", ",") : "",
    active: ingredient.active ?? true,
  });
  const [initial, setInitial] = useState({ quantity: "", unit: "" });
  const [adjusting, setAdjusting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const initialUnit = COMPATIBLE[form.unit].includes(initial.unit) ? initial.unit : form.unit;

  async function submit(e) {
    e.preventDefault();
    const min = form.min_stock === "" ? 0 : parseQty(form.min_stock);
    if (!(min >= 0)) return setError("Estoque mínimo inválido.");
    const init = initial.quantity === "" ? null : parseQty(initial.quantity);
    if (init !== null && !(init >= 0)) return setError("Saldo inicial inválido.");
    setBusy(true);
    setError("");
    try {
      const body = { ...form, category: Number(form.category), min_stock: min.toFixed(3) };
      if (isNew && init) Object.assign(body, { initial_quantity: init.toFixed(3), initial_unit: initialUnit });
      const saved = await api(isNew ? "/ingredients/" : `/ingredients/${ingredient.id}/`, { method: isNew ? "POST" : "PATCH", body });
      toast(isNew ? "Ingrediente cadastrado." : "Ingrediente atualizado.");
      onSaved(saved);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={isNew ? "Novo ingrediente" : ingredient.name} size="sm"
      footer={!adjusting && <>
        <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary grow" form="ing-form" disabled={busy}>{busy ? "Salvando…" : "Salvar"}</button>
      </>}>
      {!isNew && (
        <div className="saldo-box">
          <div>
            <span className="muted small block">Saldo em {establishment?.name}</span>
            <Qty value={ingredient.stock} unit={ingredient.unit} className="qty-lg" />
          </div>
          <StatusBadge status={ingredient.status} />
          {can("ajuste") && !adjusting && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdjusting(true)}>
              <Icon name="scale" size={16} /> Corrigir saldo
            </button>
          )}
        </div>
      )}
      {adjusting ? (
        <AdjustForm ingredient={ingredient} onCancel={() => setAdjusting(false)} onDone={onSaved} />
      ) : (
        <form id="ing-form" className="form" onSubmit={submit}>
          <Field label="Nome *">
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="Ex.: Farinha de trigo" />
          </Field>
          <Field label="Categoria *">
            <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} required>
              <option value="" disabled>Selecione…</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <div className="form-row">
            <Field label="Unidade *" className="grow"
                   help="É a unidade em que o saldo é guardado. Entradas e baixas podem usar unidades compatíveis (kg ↔ g, L ↔ ml) e o sistema converte. Não pode ser trocada depois que houver movimentações.">
              <select className="input" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
                {UNITS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
            <Field label={`Estoque mínimo (${form.unit})`} className="grow"
                   help="Quando o saldo chegar a este valor, o item aparece como “Estoque baixo” / “Acabando”. Cada unidade tem o seu.">
              <input className="input" inputMode="decimal" value={form.min_stock} placeholder="0"
                     onChange={(e) => setForm({ ...form, min_stock: e.target.value })} />
            </Field>
          </div>
          {isNew && (
            <div className="form-row">
              <Field label="Saldo inicial (opcional)" className="grow"
                     help={`Quanto já existe hoje em ${establishment?.name || "esta unidade"}. Fica registrado no histórico como “Saldo inicial”.`}>
                <input className="input" inputMode="decimal" value={initial.quantity} placeholder="0"
                       onChange={(e) => setInitial({ ...initial, quantity: e.target.value })} />
              </Field>
              {COMPATIBLE[form.unit].length > 1 && (
                <Field label="Unid.">
                  <select className="input" value={initialUnit} onChange={(e) => setInitial({ ...initial, unit: e.target.value })}>
                    {COMPATIBLE[form.unit].map((u) => <option key={u}>{u}</option>)}
                  </select>
                </Field>
              )}
            </div>
          )}
          {!isNew && (
            <label className="check">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              <span>Ativo (aparece na baixa, na entrada e no estoque)</span>
            </label>
          )}
          {!isNew && !form.active && Number(ingredient.stock) !== 0 && (
            <div className="alert"><Icon name="alert" /><span>Este item ainda tem saldo. Considere corrigir o saldo antes de desativar.</span></div>
          )}
          {error && <div className="alert alert-error"><Icon name="alert" /><span>{error}</span></div>}
        </form>
      )}
    </Modal>
  );
}

function CategoriesModal({ cats, onClose }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [edit, setEdit] = useState({});

  async function run(fn, msg) {
    try {
      await fn();
      if (msg) toast(msg);
      cats.reload();
    } catch (e) {
      toast(e.message, { tone: "error" });
    }
  }

  return (
    <Modal open onClose={onClose} title="Categorias" size="sm">
      <form className="form-row" onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        run(() => api("/categories/", { method: "POST", body: { name: name.trim(), order: (cats.data?.length || 0) } }), "Categoria criada.")
          .then(() => setName(""));
      }}>
        <input className="input grow" placeholder="Nova categoria" value={name} onChange={(e) => setName(e.target.value)} aria-label="Nome da categoria" />
        <button className="btn btn-primary"><Icon name="plus" /> Adicionar</button>
      </form>
      <ul className="cat-list">
        {(cats.data || []).map((c) => (
          <li key={c.id}>
            {edit[c.id] !== undefined ? (
              <input className="input grow" value={edit[c.id]} autoFocus
                     onChange={(e) => setEdit({ ...edit, [c.id]: e.target.value })}
                     onKeyDown={(e) => {
                       if (e.key === "Enter") run(() => api(`/categories/${c.id}/`, { method: "PATCH", body: { name: edit[c.id] } }))
                         .then(() => setEdit({ ...edit, [c.id]: undefined }));
                       if (e.key === "Escape") setEdit({ ...edit, [c.id]: undefined });
                     }} />
            ) : (
              <span className="grow">{c.name} <span className="muted small">· {c.ingredient_count} itens</span></span>
            )}
            <button className="icon-btn" aria-label="Renomear" onClick={() => setEdit({ ...edit, [c.id]: c.name })}><Icon name="edit" size={18} /></button>
            <button className="icon-btn" aria-label="Excluir"
                    onClick={() => run(() => api(`/categories/${c.id}/`, { method: "DELETE" }), "Categoria excluída.")}>
              <Icon name="trash" size={18} />
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
