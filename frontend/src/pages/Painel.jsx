import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import Icon from "../components/Icon";
import { Empty, ErrorBox, PageHeader, Qty, Spinner, StatusBadge, useLoad } from "../components/ui";
import { fmtQty, fmtWhen, KIND_TONE } from "../format";
import PainelRede from "./PainelRede";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

// Lembra a aba escolhida mesmo quando a tela é recriada ao trocar de unidade.
let lastView = "rede";

export default function Painel() {
  const { user, isMaster, establishment, establishments, selectEstablishment } = useAuth();
  const [view, setView] = useState(isMaster ? lastView : "unidade");
  const change = (v) => { lastView = v; setView(v); };

  const tabs = isMaster && (
    <div className="segmented view-tabs" role="tablist" aria-label="Visão do painel">
      <button role="tab" aria-selected={view === "rede"} className={view === "rede" ? "on" : ""} onClick={() => change("rede")}>
        <Icon name="store" size={18} /> Todas as unidades
      </button>
      <button role="tab" aria-selected={view === "unidade"} className={view === "unidade" ? "on" : ""} onClick={() => change("unidade")}>
        <Icon name="home" size={18} /> {establishment?.name || "Unidade"}
      </button>
    </div>
  );

  if (view === "unidade") return <UnitDashboard tabs={tabs} />;
  return (
    <div className="page">
      <PageHeader
        title={`${greeting()}, ${user.first_name || user.full_name}`}
        subtitle="Visão geral de todas as cafeterias"
        help={<>
          <p>Números somados de todas as unidades ativas.</p>
          <p>Toque em uma unidade para abrir o painel dela. A tabela no fim compara o saldo de cada ingrediente entre as unidades.</p>
          <p>Para trabalhar no estoque de uma unidade, escolha-a no seletor do menu ou na aba ao lado.</p>
        </>}
      />
      {tabs}
      <PainelRede onOpenUnit={(u) => {
        lastView = "unidade";
        const est = establishments.find((e) => e.id === u.id);
        if (est && est.id !== establishment?.id) selectEstablishment(est);
        else setView("unidade");
      }} />
    </div>
  );
}

function UnitDashboard({ tabs }) {
  const { user, can, establishment } = useAuth();
  const { data, loading, error, reload } = useLoad(() => api("/dashboard/"), []);

  if (loading && !data) return <div className="page"><Spinner /></div>;
  if (error) return <div className="page"><ErrorBox error={error} onRetry={reload} /></div>;

  const t = data.totals;
  const maxTop = Math.max(...data.top_consumed.map((r) => r.count), 1);

  return (
    <div className="page">
      <PageHeader
        title={`${greeting()}, ${user.first_name || user.full_name}`}
        subtitle={`Resumo do estoque · ${establishment?.name || ""}`}
        help={<>
          <p>Visão rápida da unidade selecionada.</p>
          <p><b>Estoque baixo</b>: o saldo chegou ao estoque mínimo definido no cadastro. <b>Zerados</b>: saldo acabou.</p>
          <p>Toque nos cartões para abrir o estoque.</p>
        </>}
        actions={(can("entrada") || can("baixa")) && (
          <>
            {can("entrada") && <Link to="/entrada" className="btn btn-primary"><Icon name="receipt" /> Nova entrada</Link>}
            {can("baixa") && <Link to="/baixa" className="btn btn-ghost"><Icon name="out" /> Registrar baixa</Link>}
          </>
        )}
      />
      {tabs}

      <div className="stats">
        <Stat label="Ingredientes ativos" value={t.ingredients} icon="box" />
        <Stat label="Estoque baixo" value={t.low} icon="alert" tone={t.low ? "baixo" : ""} to="/estoque" />
        <Stat label="Zerados" value={t.zero} icon="x" tone={t.zero ? "zerado" : ""} to="/estoque" />
        <Stat label="Movimentos hoje" value={t.entries_today + t.exits_today}
              hint={`${t.entries_today} entradas · ${t.exits_today} saídas`} icon="history" />
      </div>

      <div className="grid-2">
        <section className="card">
          <header className="card-head">
            <h2>Precisam de reposição</h2>
            <Link to="/estoque" className="link">Ver estoque</Link>
          </header>
          {data.alerts.length === 0 ? (
            <Empty icon="check" title="Tudo em dia">Nenhum item abaixo do mínimo.</Empty>
          ) : (
            <ul className="alert-list">
              {data.alerts.map((i) => (
                <li key={i.id}>
                  <div>
                    <strong>{i.name}</strong>
                    <span className="muted small">mínimo {fmtQty(i.min_stock)} {i.unit}</span>
                  </div>
                  <Qty value={i.stock} unit={i.unit} />
                  <StatusBadge status={i.status} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="stack">
          <section className="card">
            <header className="card-head">
              <h2>Mais usados · 7 dias</h2>
            </header>
            {data.top_consumed.length === 0 ? (
              <p className="muted">Sem consumo registrado na semana.</p>
            ) : (
              <ul className="bars">
                {data.top_consumed.map((r) => (
                  <li key={r.ingredient}>
                    <span className="bars-label">{r.name}</span>
                    <span className="bars-track">
                      <span className="bars-fill" style={{ width: `${(r.count / maxTop) * 100}%` }} />
                    </span>
                    <span className="bars-value">{r.count} {r.count === 1 ? "baixa" : "baixas"} · {fmtQty(r.total)} {r.unit}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <header className="card-head">
              <h2>Últimas movimentações</h2>
              <Link to="/historico" className="link">{can("historico") ? "Histórico" : "Meus lançamentos"}</Link>
            </header>
            <ul className="move-list compact">
              {data.recent.map((m) => (
                <li key={m.id} className={m.is_reversed ? "reversed" : ""}>
                  <span className={`kind-dot ${KIND_TONE[m.kind]}`} aria-hidden="true" />
                  <div className="move-main">
                    <strong>{m.ingredient_name}</strong>
                    <span className="muted">{m.kind_display} · {m.user_name} · {fmtWhen(m.created_at)}</span>
                  </div>
                  <span className={`move-qty ${Number(m.quantity) > 0 ? "pos" : "neg"}`}>
                    {Number(m.quantity) > 0 ? "+" : "−"}{fmtQty(Math.abs(m.quantity))} <small>{m.ingredient_unit}</small>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, hint, icon, tone = "", to }) {
  const body = (
    <>
      <span className="stat-icon"><Icon name={icon} /></span>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
      {hint && <span className="stat-hint">{hint}</span>}
    </>
  );
  return to ? (
    <Link to={to} className={`stat stat-${tone}`}>{body}</Link>
  ) : (
    <div className={`stat stat-${tone}`}>{body}</div>
  );
}
