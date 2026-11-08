import { useEffect, useState } from "react";
import { api, download } from "../api";
import { useAuth } from "../auth";
import Icon from "../components/Icon";
import {
  Chips, Empty, ErrorBox, ExportButton, Field, Modal, PageHeader, SearchBox, SortSelect, SortTh, Spinner,
  useSort, useToast,
} from "../components/ui";
import { fmtMoney, fmtQty, fmtWhen, KIND_TONE } from "../format";

const KINDS = [
  { value: "entrada", label: "Entradas" },
  { value: "consumo", label: "Consumo" },
  { value: "perda", label: "Perdas" },
  { value: "ajuste", label: "Ajustes" },
  { value: "inicial", label: "Saldo inicial" },
  { value: "estorno", label: "Estornos" },
];
// chave local -> campo de ordenação da API
const ORDER = { date: "created_at", ingredient: "ingredient__name", kind: "kind", qty: "quantity", user: "user__first_name" };
const SORT_OPTIONS = [
  { value: "date", label: "Data", dir: "desc" },
  { value: "ingredient", label: "Ingrediente" },
  { value: "kind", label: "Tipo" },
  { value: "qty", label: "Quantidade", dir: "desc" },
  { value: "user", label: "Responsável" },
];

export default function Historico() {
  const { can, meta } = useAuth();
  const full = can("historico");
  const toast = useToast();
  const [filters, setFilters] = useState({ kind: "", search: "", date_from: "", date_to: "", user: "" });
  const { sort, setSort, toggle } = useSort("date", "desc");
  const [rows, setRows] = useState([]);
  const [next, setNext] = useState(null);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reversing, setReversing] = useState(null);
  const [users, setUsers] = useState([]);
  const [showFilters, setShowFilters] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (can("usuarios")) api("/users/", { params: { page_size: 500 } }).then((d) => setUsers(d.results)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ordering = `${sort.dir === "desc" ? "-" : ""}${ORDER[sort.key]}`;
  const params = { ...filters, ordering };

  useEffect(() => setPage(1), [sort]);

  // Busca com pequena espera para não disparar a cada tecla.
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      setLoading(true);
      api("/movements/", { params: { ...params, page } })
        .then((d) => {
          if (!alive) return;
          setRows((r) => (page === 1 ? d.results : [...r, ...d.results]));
          setNext(d.next);
          setCount(d.count);
          setError(null);
        })
        .catch((e) => alive && setError(e))
        .finally(() => alive && setLoading(false));
    }, filters.search ? 300 : 0);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, page, reloadKey, ordering]);

  const set = (patch) => { setPage(1); setFilters((f) => ({ ...f, ...patch })); };
  const activeFilters = ["date_from", "date_to", "user"].filter((k) => filters[k]).length;

  return (
    <div className="page">
      <PageHeader
        title={full ? "Histórico de movimentações" : "Meus lançamentos"}
        subtitle={full ? `${count} lançamentos · entradas, saídas, ajustes e estornos, com o responsável.` : "Suas baixas registradas."}
        help={<>
          <p>Cada linha é um lançamento: quem fez, quando, quanto e o saldo que ficou depois.</p>
          <p>Toque no título de uma coluna para ordenar (no celular, use “Ordenar”).</p>
          <p><b>Estornar</b> cria um lançamento contrário. O original continua no histórico, riscado.</p>
          {!can("estorno") && <p>Você pode desfazer suas próprias baixas em até {meta.kitchen_undo_minutes} minutos.</p>}
          {can("exportar") && <p><b>Exportar Excel</b> baixa os lançamentos com os filtros e a ordem atuais.</p>}
        </>}
        actions={can("exportar") && <ExportButton onExport={() => download("/movements/export/", { params })} />}
      />

      <div className="toolbar">
        <SearchBox value={filters.search} onChange={(v) => set({ search: v })} placeholder="Ingrediente, fornecedor, NF…" />
        <button className="btn btn-ghost" onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters}>
          <Icon name="filter" /> Filtros{activeFilters ? ` (${activeFilters})` : ""}
        </button>
      </div>
      <Chips options={KINDS} value={filters.kind} onChange={(v) => set({ kind: v })} allLabel="Todos" />
      <SortSelect className="show-sm-flex" options={SORT_OPTIONS} sort={sort} setSort={setSort} />

      {showFilters && (
        <div className="card filters">
          <Field label="De">
            <input type="date" className="input" value={filters.date_from} onChange={(e) => set({ date_from: e.target.value })} />
          </Field>
          <Field label="Até">
            <input type="date" className="input" value={filters.date_to} onChange={(e) => set({ date_to: e.target.value })} />
          </Field>
          {users.length > 0 && (
            <Field label="Usuário">
              <select className="input" value={filters.user} onChange={(e) => set({ user: e.target.value })}>
                <option value="">Todos</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
              </select>
            </Field>
          )}
          <button className="btn btn-ghost" onClick={() => set({ date_from: "", date_to: "", user: "" })}>Limpar</button>
        </div>
      )}

      <ErrorBox error={error} />
      {loading && page === 1 && !rows.length ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <Empty icon="history" title="Nenhuma movimentação encontrada" />
      ) : (
        <div className="card table-card">
          <table className="table table-history">
            <thead>
              <tr>
                <SortTh label="Data" k="date" sort={sort} onSort={toggle} />
                <SortTh label="Tipo" k="kind" sort={sort} onSort={toggle} />
                <SortTh label="Ingrediente" k="ingredient" sort={sort} onSort={toggle} />
                <SortTh label="Quantidade" k="qty" sort={sort} onSort={toggle} className="num" />
                <th className="num hide-md">Saldo após</th>
                <SortTh label="Responsável" k="user" sort={sort} onSort={toggle} className="hide-sm" />
                <th aria-label="Ações" />
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const pos = Number(m.quantity) > 0;
                return (
                  <tr key={m.id} className={m.is_reversed ? "reversed" : ""}>
                    <td className="nowrap muted" data-label="Data">{fmtWhen(m.created_at)}</td>
                    <td data-label="Tipo"><span className={`kind kind-${KIND_TONE[m.kind]}`}>{m.kind_display}</span></td>
                    <td data-label="Ingrediente">
                      <strong>{m.ingredient_name}</strong>
                      {(m.entry_label || m.notes) && (
                        <span className="muted small block">{m.entry_label || m.notes}</span>
                      )}
                      <span className="show-sm muted small">por {m.user_name}</span>
                      {m.is_reversed && <span className="muted small block">estornado</span>}
                    </td>
                    <td className={`num move-qty ${pos ? "pos" : "neg"}`} data-label="Quantidade">
                      {pos ? "+" : "−"}{fmtQty(Math.abs(m.quantity))} <small>{m.ingredient_unit}</small>
                      {m.input_unit !== m.ingredient_unit && (
                        <span className="muted small block">({fmtQty(m.input_quantity)} {m.input_unit})</span>
                      )}
                      {m.total_cost != null && <span className="muted small block">{fmtMoney(m.total_cost)}</span>}
                    </td>
                    <td className="num hide-md muted" data-label="Saldo após">{fmtQty(m.balance_after)} {m.ingredient_unit}</td>
                    <td className="hide-sm" data-label="Responsável">{m.user_name}</td>
                    <td className="actions">
                      {m.can_reverse && (
                        <button className="btn btn-ghost btn-sm" onClick={() => setReversing(m)}>
                          <Icon name="undo" size={16} /> {can("estorno") ? "Estornar" : "Desfazer"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {next && (
            <div className="load-more">
              <button className="btn btn-ghost" onClick={() => setPage((p) => p + 1)} disabled={loading}>
                {loading ? "Carregando…" : `Carregar mais (${rows.length} de ${count})`}
              </button>
            </div>
          )}
        </div>
      )}

      {reversing && (
        <ReverseModal
          movement={reversing}
          onClose={() => setReversing(null)}
          onDone={() => {
            setReversing(null);
            toast("Lançamento estornado.");
            setPage(1);
            setReloadKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}

function ReverseModal({ movement: m, onClose, onDone }) {
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function go() {
    setBusy(true);
    try {
      await api(`/movements/${m.id}/estornar/`, { method: "POST", body: { notes } });
      onDone();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title="Estornar lançamento" size="sm"
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn btn-danger grow" onClick={go} disabled={busy}>{busy ? "Estornando…" : "Estornar"}</button>
      </>}>
      <p>
        Será criado um lançamento oposto de <strong>{fmtQty(Math.abs(m.quantity))} {m.ingredient_unit}</strong> para{" "}
        <strong>{m.ingredient_name}</strong>. O registro original permanece no histórico.
      </p>
      <Field label="Motivo" className="mt">
        <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex.: quantidade digitada errada" />
      </Field>
      {error && <div className="alert alert-error"><Icon name="alert" /><span>{error}</span></div>}
    </Modal>
  );
}
