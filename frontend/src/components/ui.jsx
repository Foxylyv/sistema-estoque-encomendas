import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { fmtQty, STATUS_LABEL } from "../format";
import Icon from "./Icon";

/* ---------- Toasts ---------- */
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((message, { tone = "ok", action, duration = 4500 } = {}) => {
    const id = Math.random().toString(36).slice(2);
    setItems((list) => [...list.slice(-2), { id, message, tone, action }]);
    setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), duration);
  }, []);
  const dismiss = (id) => setItems((list) => list.filter((t) => t.id !== id));
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            <Icon name={t.tone === "error" ? "alert" : "check"} size={18} />
            <span>{t.message}</span>
            {t.action && (
              <button className="toast-action" onClick={() => { t.action.onClick(); dismiss(t.id); }}>
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------- Modal / bottom sheet ---------- */
export function Modal({ open, onClose, title, children, footer, size = "md" }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    document.addEventListener("keydown", onKey);
    document.body.classList.add("no-scroll");
    const first = ref.current?.querySelector("input, select, textarea, button.btn-primary");
    first?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("no-scroll");
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal modal-${size}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar">
            <Icon name="x" />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

/* ---------- Pequenos componentes ---------- */
export function StatusBadge({ status }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABEL[status] || status}</span>;
}

export function Qty({ value, unit, className = "" }) {
  return (
    <span className={`qty ${className}`}>
      {fmtQty(value)} <small>{unit}</small>
    </span>
  );
}

export function StockBar({ stock, min }) {
  const s = Number(stock), m = Number(min);
  const ref = Math.max(m * 2, s, 1);
  const pct = Math.max(0, Math.min(100, (s / ref) * 100));
  const tone = s <= 0 ? "zerado" : s <= m ? "baixo" : "normal";
  return (
    <div className="stockbar" aria-hidden="true">
      <div className={`stockbar-fill fill-${tone}`} style={{ width: `${pct}%` }} />
      {m > 0 && <div className="stockbar-min" style={{ left: `${(m / ref) * 100}%` }} />}
    </div>
  );
}

export function Empty({ icon = "box", title, children }) {
  return (
    <div className="empty">
      <Icon name={icon} size={36} strokeWidth={1.4} />
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}

export function Spinner({ label = "Carregando…" }) {
  return (
    <div className="loading">
      <span className="spinner" aria-hidden="true" />
      {label}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, help }) {
  return (
    <div className="page-head">
      <div>
        <h1 className="title-help">{title}{help && <HelpTip title={title}>{help}</HelpTip>}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder = "Pesquisar…", autoFocus }) {
  return (
    <label className="search">
      <Icon name="search" size={20} />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-label={placeholder}
      />
      {value && (
        <button type="button" className="search-clear" onClick={() => onChange("")} aria-label="Limpar">
          <Icon name="x" size={16} />
        </button>
      )}
    </label>
  );
}

export function Chips({ options, value, onChange, allLabel = "Todas" }) {
  return (
    <div className="chips" role="tablist">
      <button role="tab" aria-selected={!value} className={`chip ${!value ? "on" : ""}`} onClick={() => onChange("")}>
        {allLabel}
      </button>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={String(value) === String(o.value)}
          className={`chip ${String(value) === String(o.value) ? "on" : ""}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
          {o.count !== undefined && <span className="chip-count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, hint, error, help, children, className = "" }) {
  return (
    <label className={`field ${className}`}>
      <span className="field-label">{label}{help && <HelpTip title={label}>{help}</HelpTip>}</span>
      {children}
      {error ? <span className="field-error">{error}</span> : hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

/* ---------- Hook de carregamento ---------- */
export function useLoad(fn, deps) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn()
      .then((data) => alive && setState({ data, loading: false, error: null }))
      .catch((error) => alive && setState({ data: null, loading: false, error }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="alert alert-error">
      <Icon name="alert" />
      <span>{error.message}</span>
      {onRetry && <button className="btn btn-ghost btn-sm" onClick={onRetry}>Tentar de novo</button>}
    </div>
  );
}

/* ---------- Ajuda contextual "(?)" — abre por toque ou clique ---------- */
export function HelpTip({ children, title = "Ajuda", label = "Ajuda" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const esc = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <span className="help" ref={ref}>
      <button
        type="button"
        className={`help-btn ${open ? "on" : ""}`}
        aria-label={label}
        aria-expanded={open}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v); }}
      >
        <Icon name="help" size={18} />
      </button>
      {open && (
        <span className="help-pop" role="tooltip">
          <strong>{title}</strong>
          <span className="help-body">{children}</span>
        </span>
      )}
    </span>
  );
}

/* ---------- Ordenação ---------- */
export function useSort(initialKey, initialDir = "asc") {
  const [sort, setSort] = useState({ key: initialKey, dir: initialDir });
  const toggle = (key) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  return { sort, setSort, toggle };
}

/** Ordena uma lista localmente. getters: { chave: (item) => valor } */
export function sortList(list, { key, dir }, getters) {
  const get = getters[key];
  if (!get) return list;
  const mult = dir === "asc" ? 1 : -1;
  return [...list].sort((a, b) => {
    const va = get(a), vb = get(b);
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * mult;
    return String(va).localeCompare(String(vb), "pt-BR", { sensitivity: "base", numeric: true }) * mult;
  });
}

/** Cabeçalho de tabela clicável (desktop/tablet). */
export function SortTh({ label, k, sort, onSort, className = "" }) {
  const active = sort.key === k;
  return (
    <th className={className} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className={`th-sort ${active ? "on" : ""}`} onClick={() => onSort(k)}>
        {label}
        <Icon name={active ? (sort.dir === "asc" ? "sortUp" : "sortDown") : "sort"} size={14} />
      </button>
    </th>
  );
}

/** Seletor de ordenação — usado no celular, onde o cabeçalho da tabela fica escondido. */
export function SortSelect({ options, sort, setSort, className = "" }) {
  return (
    <div className={`sort-select ${className}`}>
      <Icon name="sort" size={18} />
      <select
        aria-label="Ordenar por"
        value={sort.key}
        onChange={(e) => setSort({ key: e.target.value, dir: options.find((o) => o.value === e.target.value)?.dir || "asc" })}
      >
        {options.map((o) => <option key={o.value} value={o.value}>Ordenar: {o.label}</option>)}
      </select>
      <button
        type="button"
        className="icon-btn"
        aria-label={sort.dir === "asc" ? "Crescente (toque para inverter)" : "Decrescente (toque para inverter)"}
        onClick={() => setSort({ ...sort, dir: sort.dir === "asc" ? "desc" : "asc" })}
      >
        <Icon name={sort.dir === "asc" ? "arrowUp" : "arrowDown"} size={20} />
      </button>
    </div>
  );
}

/* ---------- Exportar para Excel ---------- */
export function ExportButton({ onExport, label = "Exportar Excel" }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      const name = await onExport();
      toast(`Planilha gerada: ${name}`);
    } catch (e) {
      toast(e.message, { tone: "error" });
    } finally {
      setBusy(false);
    }
  }
  return (
    <button type="button" className="btn btn-ghost" onClick={go} disabled={busy}>
      <Icon name="download" /> {busy ? "Gerando…" : label}
    </button>
  );
}
