import { useMemo, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import Icon from "../components/Icon";
import { Chips, Empty, ErrorBox, HelpTip, SearchBox, Spinner, StatusBadge, useLoad } from "../components/ui";
import { fmtMoney, fmtQty, fmtWhen } from "../format";

const RANK = { zerado: 0, baixo: 1, normal: 2 };

/** Painel consolidado de todas as unidades (admin master). */
export default function PainelRede({ onOpenUnit }) {
  const { data, loading, error, reload } = useLoad(() => api("/dashboard/rede/"), []);
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;

  const t = data.totals;
  const names = Object.fromEntries(data.units.map((u) => [u.id, u.name]));

  return (
    <>
      <div className="stats">
        <Stat label="Unidades ativas" value={t.units} icon="store" />
        <Stat label="Itens com estoque baixo" value={t.low} icon="alert" tone={t.low ? "baixo" : ""}
              hint="somando todas as unidades" />
        <Stat label="Itens zerados" value={t.zero} icon="x" tone={t.zero ? "zerado" : ""} hint="somando todas as unidades" />
        <Stat label="Compras · 30 dias" value={fmtMoney(t.purchases_30d)} icon="receipt" small
              hint={`${t.entries_today} entradas · ${t.exits_today} saídas hoje`} />
      </div>

      <section className="section-tight">
        <h2 className="section-title title-help">
          Unidades
          <HelpTip title="Unidades">Toque em uma unidade para abrir o painel dela e trabalhar no estoque daquela cafeteria.</HelpTip>
        </h2>
        <div className="unit-grid">
          {data.units.map((u) => (
            <button key={u.id} className={`unit-card card ${u.zero ? "uc-zero" : u.low ? "uc-low" : ""}`} onClick={() => onOpenUnit(u)}>
              <div className="uc-head">
                <span className="uc-icon"><Icon name="store" /></span>
                <strong className="grow">{u.name}</strong>
                <Icon name="chevron" size={18} />
              </div>
              <div className="uc-status">
                {u.zero > 0 && <span className="badge badge-zerado">{u.zero} zerados</span>}
                {u.low > 0 && <span className="badge badge-baixo">{u.low} baixos</span>}
                {!u.zero && !u.low && <span className="badge badge-normal">Estoque em dia</span>}
              </div>
              <dl className="uc-metrics">
                <div><dt>Entradas hoje</dt><dd>{u.entries_today}</dd></div>
                <div><dt>Saídas hoje</dt><dd>{u.exits_today}</dd></div>
                <div><dt>Compras 30d</dt><dd>{fmtMoney(u.purchases_30d)}</dd></div>
                <div><dt>Perdas 30d</dt><dd>{u.losses_30d} {u.losses_30d === 1 ? "registro" : "registros"}</dd></div>
              </dl>
              <span className="uc-last muted small">
                {u.last_movement_at ? `Último lançamento: ${fmtWhen(u.last_movement_at)} · ${u.last_movement_by}` : "Sem lançamentos"}
              </span>
            </button>
          ))}
        </div>
      </section>

      <div className="grid-2 mt">
        <PurchasesChart units={data.units} />
        <TopConsumed rows={data.top_consumed} names={names} />
      </div>

      <StockMatrix rows={data.matrix} units={data.units} />
    </>
  );
}

function Stat({ label, value, hint, icon, tone = "", small }) {
  return (
    <div className={`stat stat-${tone}`}>
      <span className="stat-icon"><Icon name={icon} /></span>
      <span className={`stat-value ${small ? "stat-value-sm" : ""}`}>{value}</span>
      <span className="stat-label">{label}</span>
      {hint && <span className="stat-hint">{hint}</span>}
    </div>
  );
}

/** Barra horizontal de uma série, com dica ao passar o mouse, focar ou tocar. */
function BarRow({ label, value, max, display, tip }) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <li>
      <button type="button" className="bar-row" aria-label={`${label}: ${display}`}>
        <span className="bars-label">{label}</span>
        <span className="bars-track"><span className="bars-fill" style={{ width: `${pct}%` }} /></span>
        <span className="bars-value">{display}</span>
        {tip && <span className="bar-tip" role="tooltip">{tip}</span>}
      </button>
    </li>
  );
}

function PurchasesChart({ units }) {
  const max = Math.max(...units.map((u) => Number(u.purchases_30d)), 0);
  return (
    <section className="card">
      <header className="card-head">
        <h2 className="title-help">
          Compras por unidade · 30 dias
          <HelpTip title="Compras por unidade">
            Soma do “valor total do item” lançado nas entradas dos últimos 30 dias (entradas canceladas não contam).
            Itens lançados sem valor não entram na soma.
          </HelpTip>
        </h2>
      </header>
      {max === 0 ? (
        <p className="muted">Nenhuma compra com valor informado nos últimos 30 dias.</p>
      ) : (
        <ul className="bars hbars">
          {units.map((u) => (
            <BarRow key={u.id} label={u.name} value={Number(u.purchases_30d)} max={max} display={fmtMoney(u.purchases_30d)}
                    tip={<><strong>{u.name}</strong><span>{fmtMoney(u.purchases_30d)} em compras</span><span>{u.entries_today} entradas hoje</span></>} />
          ))}
        </ul>
      )}
    </section>
  );
}

function TopConsumed({ rows, names }) {
  const max = Math.max(...rows.map((r) => r.count), 0);
  return (
    <section className="card">
      <header className="card-head">
        <h2 className="title-help">
          Mais usados na rede · 7 dias
          <HelpTip title="Mais usados">
            Ingredientes com mais baixas de consumo na semana, somando todas as unidades. A barra é o número de baixas;
            ao lado, a quantidade total. Passe o mouse ou toque para ver por unidade.
          </HelpTip>
        </h2>
      </header>
      {rows.length === 0 ? (
        <p className="muted">Sem consumo registrado na semana.</p>
      ) : (
        <ul className="bars hbars">
          {rows.map((r) => (
            <BarRow
              key={r.ingredient}
              label={r.name}
              value={r.count}
              max={max}
              display={`${r.count} ${r.count === 1 ? "baixa" : "baixas"} · ${fmtQty(r.total)} ${r.unit}`}
              tip={<>
                <strong>{r.name} · {fmtQty(r.total)} {r.unit}</strong>
                {Object.entries(r.per).map(([uid, q]) => (
                  <span key={uid}>{names[uid]}: {fmtQty(q)} {r.unit}</span>
                ))}
              </>}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function StockMatrix({ rows, units }) {
  const [mode, setMode] = useState("alerta");
  const [search, setSearch] = useState("");

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .map((r) => {
        const statuses = units.map((u) => r.per[u.id].status);
        const worst = Math.min(...statuses.map((s) => RANK[s]));
        // Uma unidade precisa e outra tem o dobro do mínimo: dá para remanejar.
        const needs = units.some((u) => r.per[u.id].status !== "normal");
        const surplus = units.some((u) => Number(r.per[u.id].stock) > Math.max(Number(r.per[u.id].min) * 2, 0) && Number(r.per[u.id].stock) > 0);
        return { ...r, worst, transfer: needs && surplus };
      })
      .filter((r) => (mode === "alerta" ? r.worst < 2 : true))
      .filter((r) => !q || r.name.toLowerCase().includes(q) || r.category.toLowerCase().includes(q))
      .sort((a, b) => a.worst - b.worst || a.name.localeCompare(b.name, "pt-BR"));
  }, [rows, units, mode, search]);

  const alertCount = rows.filter((r) => units.some((u) => r.per[u.id].status !== "normal")).length;

  return (
    <section className="section">
      <h2 className="section-title title-help">
        Estoque comparado entre unidades
        <HelpTip title="Estoque comparado">
          <p>Saldo de cada ingrediente em cada unidade, lado a lado, e o total da rede.</p>
          <p><b>Pode remanejar</b> aparece quando uma unidade está precisando e outra tem mais que o dobro do mínimo.</p>
        </HelpTip>
      </h2>
      <div className="toolbar">
        <SearchBox value={search} onChange={setSearch} placeholder="Buscar ingrediente…" />
        <Chips options={[{ value: "todos", label: "Todos os itens" }]} value={mode === "todos" ? "todos" : ""}
               onChange={(v) => setMode(v || "alerta")} allLabel={`Em alerta em alguma unidade (${alertCount})`} />
      </div>
      {list.length === 0 ? (
        <Empty icon="check" title={mode === "alerta" ? "Nenhum item em alerta na rede" : "Nenhum item encontrado"} />
      ) : (
        <div className="card table-card">
          <table className="table matrix">
            <thead>
              <tr>
                <th>Ingrediente</th>
                {units.map((u) => <th key={u.id} className="num">{u.name}</th>)}
                <th className="num">Total rede</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id}>
                  <td className="mx-name">
                    <strong>{r.name}</strong>
                    <span className="muted small block">{r.category}</span>
                    {r.transfer && <span className="transfer-tag"><Icon name="trend" size={14} /> Pode remanejar</span>}
                  </td>
                  {units.map((u) => {
                    const c = r.per[u.id];
                    return (
                      <td key={u.id} className={`num mx-cell mx-${c.status}`} data-label={u.name}>
                        <span className="qty">{fmtQty(c.stock)} <small>{r.unit}</small></span>
                        {c.status !== "normal" ? <StatusBadge status={c.status} /> : <span className="muted small block">mín. {fmtQty(c.min)}</span>}
                      </td>
                    );
                  })}
                  <td className="num mx-total" data-label="Total rede"><span className="qty">{fmtQty(r.total)} <small>{r.unit}</small></span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
