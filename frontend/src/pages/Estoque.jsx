import { useMemo, useState } from "react";
import { api, download } from "../api";
import { useAuth } from "../auth";
import AdjustForm from "../components/AdjustForm";
import Icon from "../components/Icon";
import {
  Chips, Empty, ErrorBox, ExportButton, Modal, PageHeader, Qty, SearchBox, SortSelect, SortTh, Spinner,
  StatusBadge, StockBar, sortList, useLoad, useSort,
} from "../components/ui";
import { fmtQty, fmtWhen } from "../format";

const STATUS_FILTERS = [
  { value: "alerta", label: "Precisa repor" },
  { value: "normal", label: "Normal" },
];
const STATUS_RANK = { zerado: 0, baixo: 1, normal: 2 };
const GETTERS = {
  name: (i) => i.name,
  category: (i) => i.category_name,
  stock: (i) => Number(i.stock),
  min: (i) => Number(i.min_stock),
  status: (i) => STATUS_RANK[i.status] * 1e9 + Number(i.stock),
};
const SORT_OPTIONS = [
  { value: "name", label: "Nome" },
  { value: "status", label: "Situação (acabando primeiro)" },
  { value: "category", label: "Categoria" },
  { value: "stock", label: "Saldo" },
  { value: "min", label: "Mínimo" },
];
const API_ORDER = { name: "name", category: "category__name", stock: "stock", min: "min_stock", status: "stock" };

export default function Estoque() {
  const { can } = useAuth();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [detail, setDetail] = useState(null);
  const { sort, setSort, toggle } = useSort("name");

  const cats = useLoad(() => api("/categories/"), []);
  const ings = useLoad(() => api("/ingredients/", { params: { page_size: 1000 } }), []);

  const all = ings.data?.results || [];
  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = all.filter((i) => {
      if (category && String(i.category) !== String(category)) return false;
      if (status === "alerta" && i.status === "normal") return false;
      if (status === "normal" && i.status !== "normal") return false;
      return !q || i.name.toLowerCase().includes(q);
    });
    return sortList(filtered, sort, GETTERS);
  }, [all, search, category, status, sort]);

  const alertCount = all.filter((i) => i.status !== "normal").length;

  const exportXlsx = () =>
    download("/ingredients/export/", {
      params: {
        category, search,
        status: status || undefined,
        ordering: `${sort.dir === "desc" ? "-" : ""}${API_ORDER[sort.key]}`,
      },
    });

  return (
    <div className="page">
      <PageHeader
        title="Estoque"
        subtitle={`${all.length} ingredientes · ${alertCount} precisando de reposição`}
        help={<>
          <p>Saldo atual de cada ingrediente nesta unidade.</p>
          <p><span className="badge badge-baixo">Estoque baixo</span> o saldo chegou ao mínimo. <span className="badge badge-zerado">Zerado</span> acabou.</p>
          <p>A barra mostra o nível; o tracinho marca o estoque mínimo.</p>
          <p>Toque em uma linha para ver as últimas movimentações. Toque no título de uma coluna para ordenar.</p>
          {can("exportar") && <p><b>Exportar Excel</b> baixa a lista com os filtros e a ordem atuais.</p>}
        </>}
        actions={can("exportar") && <ExportButton onExport={exportXlsx} />}
      />

      <div className="toolbar">
        <SearchBox value={search} onChange={setSearch} placeholder="Buscar ingrediente…" />
        <Chips options={STATUS_FILTERS} value={status} onChange={setStatus} allLabel="Todos" />
      </div>
      <Chips
        options={(cats.data || []).filter((c) => c.ingredient_count).map((c) => ({ value: c.id, label: c.name }))}
        value={category}
        onChange={setCategory}
      />
      <SortSelect className="show-sm-flex" options={SORT_OPTIONS} sort={sort} setSort={setSort} />

      <ErrorBox error={ings.error} onRetry={ings.reload} />
      {ings.loading && !ings.data ? (
        <Spinner />
      ) : list.length === 0 ? (
        <Empty title="Nenhum item encontrado" />
      ) : (
        <div className="card table-card">
          <table className="table table-stock">
            <thead>
              <tr>
                <SortTh label="Ingrediente" k="name" sort={sort} onSort={toggle} />
                <SortTh label="Categoria" k="category" sort={sort} onSort={toggle} className="hide-sm" />
                <SortTh label="Saldo" k="stock" sort={sort} onSort={toggle} className="num" />
                <SortTh label="Mínimo" k="min" sort={sort} onSort={toggle} className="num hide-sm" />
                <th className="hide-md">Nível</th>
                <SortTh label="Situação" k="status" sort={sort} onSort={toggle} />
              </tr>
            </thead>
            <tbody>
              {list.map((i) => (
                <tr key={i.id} className={`clickable row-${i.status}`} onClick={() => setDetail(i)} tabIndex={0}
                    onKeyDown={(e) => e.key === "Enter" && setDetail(i)}>
                  <td>
                    <strong>{i.name}</strong>
                    <span className="show-sm muted small">{i.category_name} · mín. {fmtQty(i.min_stock)} {i.unit}</span>
                  </td>
                  <td className="hide-sm muted">{i.category_name}</td>
                  <td className="num"><Qty value={i.stock} unit={i.unit} /></td>
                  <td className="num hide-sm muted">{fmtQty(i.min_stock)} {i.unit}</td>
                  <td className="hide-md bar-cell"><StockBar stock={i.stock} min={i.min_stock} /></td>
                  <td><StatusBadge status={i.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detail && (
        <IngredientDetail
          ingredient={detail}
          onClose={() => setDetail(null)}
          onChanged={() => { setDetail(null); ings.reload(); }}
        />
      )}
    </div>
  );
}

function IngredientDetail({ ingredient: i, onClose, onChanged }) {
  const { can } = useAuth();
  const moves = useLoad(() => api(`/ingredients/${i.id}/movements/`), [i.id]);
  const [adjusting, setAdjusting] = useState(false);

  return (
    <Modal open onClose={onClose} title={i.name} size="md">
      <div className="detail-head">
        <div>
          <span className="muted small">Saldo atual</span>
          <Qty value={i.stock} unit={i.unit} className="qty-xl" />
        </div>
        <div className="detail-meta">
          <StatusBadge status={i.status} />
          <span className="muted small">Mínimo: {fmtQty(i.min_stock)} {i.unit}</span>
          <span className="muted small">{i.category_name}</span>
        </div>
      </div>
      <StockBar stock={i.stock} min={i.min_stock} />

      {can("ajuste") && !adjusting && (
        <button className="btn btn-ghost btn-block mt" onClick={() => setAdjusting(true)}>
          <Icon name="scale" /> Corrigir saldo manualmente
        </button>
      )}
      {adjusting && <div className="mt"><AdjustForm ingredient={i} onCancel={() => setAdjusting(false)} onDone={onChanged} /></div>}

      <h3 className="section-title mt">{can("historico") ? "Últimas movimentações" : "Seus últimos lançamentos"}</h3>
      {moves.loading ? (
        <Spinner />
      ) : moves.data?.length ? (
        <ul className="move-list compact">
          {moves.data.map((m) => (
            <li key={m.id} className={m.is_reversed ? "reversed" : ""}>
              <div className="move-main">
                <strong>{m.kind_display}</strong>
                <span className="muted">{fmtWhen(m.created_at)} · {m.user_name}{m.notes ? ` · ${m.notes}` : ""}</span>
              </div>
              <span className={`move-qty ${Number(m.quantity) > 0 ? "pos" : "neg"}`}>
                {Number(m.quantity) > 0 ? "+" : "−"}{fmtQty(Math.abs(m.quantity))} <small>{i.unit}</small>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Sem movimentações.</p>
      )}
    </Modal>
  );
}
