import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth";
import { ordersMode } from "../orders";
import Icon from "./Icon";

/** Itens de navegação conforme as permissões do usuário e a unidade em uso. */
export function navItems(auth) {
  const { can, isMaster } = auth;
  const mode = ordersMode(auth);
  const kitchenOnly = !isMaster && !["entrada", "historico", "ingredientes", "ajuste", "usuarios"].some(can);
  const stockAccess = isMaster || ["baixa", "entrada", "historico", "ingredientes", "ajuste", "usuarios"].some(can);
  const items = [];
  if (kitchenOnly) {
    if (mode) items.push({ to: "/encomendas", label: "Encomendas", icon: "cake" });
    if (can("baixa")) items.push(mode ? { to: "/baixa", label: "Baixa", icon: "out" } : { to: "/", label: "Baixa", icon: "out", end: true });
  } else {
    items.push({ to: "/", label: "Painel", icon: "home", end: true });
    if (mode) items.push({ to: "/encomendas", label: "Encomendas", icon: "cake" });
    if (can("baixa")) items.push({ to: "/baixa", label: "Baixa", icon: "out" });
  }
  if (stockAccess) items.push({ to: "/estoque", label: "Estoque", icon: "box" });
  if (can("entrada")) items.push({ to: "/entrada", label: "Entrada", icon: "receipt" });
  if (stockAccess) items.push({ to: "/historico", label: can("historico") ? "Histórico" : "Lançamentos", icon: "history" });
  if (can("ingredientes")) items.push({ to: "/ingredientes", label: "Ingredientes", icon: "tag" });
  if (isMaster || mode === "fabrica") items.push({ to: "/produtos", label: "Produtos", icon: "tag" });
  if (can("usuarios")) items.push({ to: "/usuarios", label: isMaster ? "Usuários" : "Equipe", icon: "users" });
  if (isMaster) items.push({ to: "/unidades", label: "Unidades", icon: "store" });
  return { items, kitchenOnly, mode };
}

export function profileName(caps = []) {
  const set = new Set(caps);
  if (set.has("usuarios") && set.size >= 7) return "Gerente da unidade";
  if (set.has("producao")) return "Fábrica";
  if (set.size === 1 && set.has("encomendas")) return "Atendente (encomendas)";
  if (set.has("entrada")) return "Compras";
  if (set.size === 1 && set.has("baixa")) return "Funcionário";
  return "Acesso personalizado";
}

const MOBILE_PRIMARY = 4; // itens visíveis na barra inferior do celular

function EstablishmentPicker({ compact = false }) {
  const { isMaster, establishments, establishment, selectEstablishment } = useAuth();
  if (!establishment) return null;
  const active = establishments.filter((e) => e.active);
  if (!isMaster || active.length < 2) {
    return (
      <div className={`est-label ${compact ? "compact" : ""}`} title="Unidade">
        <Icon name="store" size={16} />
        <span>{establishment.name}</span>
      </div>
    );
  }
  return (
    <label className={`est-picker ${compact ? "compact" : ""}`}>
      <Icon name="store" size={16} />
      <select
        value={establishment.id}
        aria-label="Unidade em uso"
        onChange={(e) => selectEstablishment(active.find((x) => x.id === Number(e.target.value)))}
      >
        {active.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
      </select>
    </label>
  );
}

export default function Layout() {
  const auth = useAuth();
  const { user, logout, establishment, isMaster } = auth;
  const { items: nav } = navItems(auth);
  const [moreOpen, setMoreOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setMoreOpen(false), [location.pathname]);

  const primary = nav.slice(0, nav.length > MOBILE_PRIMARY + 1 ? MOBILE_PRIMARY : nav.length);
  const overflow = nav.slice(primary.length);
  const overflowActive = overflow.some((n) => location.pathname.startsWith(n.to));

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <img src={`${import.meta.env.BASE_URL}logo.jpg`} alt="Sr. Grão Cafeteria & Doceria" />
          <div className="brand-text">
            <strong>Sr. Grão</strong>
            <span>Estoque e encomendas</span>
          </div>
        </div>
        <div className="side-est"><EstablishmentPicker /></div>
        <nav className="side-nav" aria-label="Principal">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className="side-link">
              <Icon name={n.icon} size={22} />
              <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="side-user">
          <div className="avatar" aria-hidden="true">{(user.full_name || "?").slice(0, 1)}</div>
          <div className="side-user-text">
            <strong>{user.full_name}</strong>
            <span>{isMaster ? "Admin master" : profileName(user.effective_capabilities)}</span>
          </div>
          <button className="icon-btn" onClick={logout} title="Sair" aria-label="Sair">
            <Icon name="logout" />
          </button>
        </div>
      </aside>

      <header className="topbar">
        <img src={`${import.meta.env.BASE_URL}logo.jpg`} alt="" />
        <div className="topbar-text">
          <strong>Sr. Grão</strong>
          <EstablishmentPicker compact />
        </div>
        <button className="icon-btn" onClick={logout} aria-label="Sair">
          <Icon name="logout" />
        </button>
      </header>

      <main className="main">
        {establishment ? (
          // A chave força recarregar a tela ao trocar de unidade.
          <Outlet key={establishment.id} />
        ) : (
          <div className="page">
            <div className="alert alert-error">
              <Icon name="alert" />
              <span>
                {isMaster
                  ? "Nenhuma unidade ativa. Cadastre uma unidade em “Unidades”."
                  : "Seu usuário não está vinculado a uma unidade ativa. Fale com o administrador."}
              </span>
            </div>
            {isMaster && <Outlet />}
          </div>
        )}
      </main>

      <nav className="bottom-nav" aria-label="Principal">
        {primary.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className="bottom-link">
            <Icon name={n.icon} size={24} />
            <span>{n.label}</span>
          </NavLink>
        ))}
        {overflow.length > 0 && (
          <button
            className={`bottom-link ${overflowActive ? "active" : ""}`}
            onClick={() => setMoreOpen((v) => !v)}
            aria-expanded={moreOpen}
          >
            <Icon name="more" size={24} />
            <span>Mais</span>
          </button>
        )}
      </nav>

      {moreOpen && (
        <div className="more-sheet-backdrop" onClick={() => setMoreOpen(false)}>
          <div className="more-sheet" onClick={(e) => e.stopPropagation()}>
            {overflow.map((n) => (
              <NavLink key={n.to} to={n.to} className="more-link">
                <Icon name={n.icon} size={22} />
                <span>{n.label}</span>
                <Icon name="chevron" size={18} className="muted" />
              </NavLink>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
