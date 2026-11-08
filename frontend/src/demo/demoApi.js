// Modo demonstração (GitHub Pages): sem servidor. Responde com um retrato dos dados de
// exemplo do `seed` (todos fictícios). Somente leitura: nada é salvo.
import snapshot from "./demo-data.json";

const DAY = 86400000;
const shiftDays = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(snapshot.snapshot + "T00:00:00").getTime()) / DAY);
const ISO = /^(\d{4}-\d{2}-\d{2})(T.*)?$/;

function shift(v) {
  if (Array.isArray(v)) return v.map(shift);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shift(x)]));
  if (typeof v === "string" && shiftDays) {
    const m = ISO.exec(v);
    if (m) {
      const d = new Date(m[1] + "T12:00:00");
      d.setDate(d.getDate() + shiftDays);
      const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      return ymd + (m[2] || "");
    }
  }
  return v;
}
const DATA = shift(snapshot.data);
const ME = snapshot.me;
const PASSWORDS = { admin: "admin123", gerente: "gerente123", compras: "compras123", cozinha: "cozinha123",
  cozinha2: "cozinha123", loja: "loja123", loja2: "loja123", fabrica: "fabrica123" };

export class DemoError extends Error {
  constructor(status, detail) { super(detail); this.status = status; this.data = { detail }; }
}
const READ_ONLY = "Esta é uma demonstração: as alterações não são salvas. Rode o projeto localmente para testar tudo.";

let currentUser = null;
try { currentUser = JSON.parse(localStorage.getItem("aurora.auth"))?.demoUser || null; } catch { /* sem armazenamento */ }

const page = (list, params) => {
  const size = Number(params.get("page_size")) || 50;
  const n = Number(params.get("page")) || 1;
  const results = list.slice((n - 1) * size, n * size);
  return { count: list.length, next: n * size < list.length ? `page=${n + 1}` : null, previous: null, results };
};
const day = (iso) => iso?.slice(0, 10);
function sortBy(list, ordering, fallback) {
  const key = (ordering || fallback || "").replace(/^-/, "");
  if (!key) return list;
  const desc = (ordering || fallback).startsWith("-");
  return [...list].sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * (desc ? -1 : 1));
}

function orders(est, p) {
  let list = DATA[`${est}|/orders/?todas=1`] || [];
  const now = Date.now();
  if (p.get("quadro")) list = list.filter((o) => ["agendado", "producao", "pronto"].includes(o.status)
      || (o.status === "enviado" && now - new Date(o.status_changed_at) < DAY));
  const st = p.getAll("status");
  if (st.length) list = list.filter((o) => st.includes(o.status));
  if (p.get("loja")) list = list.filter((o) => String(o.store) === p.get("loja"));
  if (p.get("ativas")) list = list.filter((o) => !["enviado", "cancelado"].includes(o.status));
  if (p.get("de")) list = list.filter((o) => day(o.due_at) >= p.get("de"));
  if (p.get("ate")) list = list.filter((o) => day(o.due_at) <= p.get("ate"));
  const q = (p.get("search") || "").toLowerCase();
  if (q) list = list.filter((o) => `${o.customer_name} ${o.customer_phone} ${o.id}`.toLowerCase().includes(q));
  list = sortBy(list, p.get("ordering"), "due_at");
  return p.get("quadro") || p.get("todas") ? list : page(list, p);
}

function movements(est, p) {
  let list = DATA[`${est}|/movements/?page_size=1000`]?.results || [];
  const kinds = p.getAll("kind").filter(Boolean);
  if (kinds.length) list = list.filter((m) => kinds.includes(m.kind));
  if (p.get("user")) list = list.filter((m) => String(m.user) === p.get("user"));
  if (p.get("ingredient")) list = list.filter((m) => String(m.ingredient) === p.get("ingredient"));
  if (p.get("date_from")) list = list.filter((m) => day(m.created_at) >= p.get("date_from"));
  if (p.get("date_to")) list = list.filter((m) => day(m.created_at) <= p.get("date_to"));
  const q = (p.get("search") || "").toLowerCase();
  if (q) list = list.filter((m) => `${m.ingredient_name} ${m.notes} ${m.user_name}`.toLowerCase().includes(q));
  return page(sortBy(list, p.get("ordering"), "-created_at"), p);
}

export async function demoApi(path, { method = "GET", body, params, establishmentId }) {
  await new Promise((r) => setTimeout(r, 120));
  if (path === "/auth/token/") {
    const { username, password } = body || {};
    if (!ME[username] || PASSWORDS[username] !== password) throw new DemoError(401, "Usuário ou senha incorretos.");
    currentUser = username;
    return { access: "demo", refresh: "demo", demoUser: username };
  }
  if (path === "/auth/me/") {
    if (!currentUser || !ME[currentUser]) throw new DemoError(401, "Sessão expirada.");
    return ME[currentUser];
  }
  if (method !== "GET") throw new DemoError(400, READ_ONLY);

  const me = ME[currentUser] || {};
  const est = establishmentId || me.establishment || 1;
  const p = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "") return;
    (Array.isArray(v) ? v : [v]).forEach((x) => p.append(k, x));
  });

  if (path === "/orders/") return orders(est, p);
  if (path === "/movements/") return movements(est, p);
  if (path === "/ingredients/") {
    return DATA[`${est}|/ingredients/?page_size=1000${p.get("active") === "false" ? "&active=false" : ""}`];
  }
  if (path === "/products/") return DATA[`${est}|/products/?active=${p.get("active") === "false" ? "false" : "true"}`];
  if (path === "/users/") return DATA[`${est}|/users/?page_size=500`];
  const hit = DATA[`${est}|${path}`] ?? DATA[`1|${path}`] ?? DATA[`3|${path}`];
  if (hit !== undefined) return hit;
  throw new DemoError(404, "Não disponível na demonstração.");
}
