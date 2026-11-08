import { demoApi } from "./demo/demoApi";

const DEMO = !!import.meta.env.VITE_DEMO;
const BASE = import.meta.env.VITE_API_URL || "/api";
const KEY = "srgrao.auth";

export const tokens = {
  get() {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || null;
    } catch {
      return null;
    }
  },
  set(value) {
    try {
      if (value) localStorage.setItem(KEY, JSON.stringify(value));
      else localStorage.removeItem(KEY);
    } catch {
      /* armazenamento indisponível: sessão vale só enquanto a aba estiver aberta */
    }
    memory = value;
  },
};
let memory = tokens.get();

export class ApiError extends Error {
  constructor(status, data) {
    super(extractMessage(data) || `Erro ${status}`);
    this.status = status;
    this.data = data;
  }
}

function extractMessage(data) {
  if (!data) return "";
  if (typeof data === "string") return data;
  if (data.detail) return data.detail;
  if (Array.isArray(data)) return extractMessage(data[0]);
  if (data.non_field_errors) return extractMessage(data.non_field_errors);
  const [field, value] = Object.entries(data)[0] || [];
  if (!field) return "";
  const msg = extractMessage(value);
  return field === "items" ? msg : `${field}: ${msg}`;
}

let refreshing = null;
async function refreshAccess() {
  if (!memory?.refresh) return false;
  refreshing ||= fetch(`${BASE}/auth/refresh/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh: memory.refresh }),
  })
    .then(async (r) => {
      if (!r.ok) return false;
      const data = await r.json();
      tokens.set({ ...memory, ...data });
      return true;
    })
    .catch(() => false)
    .finally(() => setTimeout(() => (refreshing = null), 0));
  return refreshing;
}

// Unidade (cafeteria) em uso — enviada em todas as requisições.
let establishmentId = null;
export function setEstablishment(id) {
  establishmentId = id;
}

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

function buildUrl(path, params) {
  let url = `${BASE}${path}`;
  if (params) {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v === undefined || v === null || v === "") return;
      (Array.isArray(v) ? v : [v]).forEach((item) => qs.append(k, item));
    });
    const s = qs.toString();
    if (s) url += `?${s}`;
  }
  return url;
}

function authHeaders(extra = {}) {
  const headers = { ...extra };
  if (memory?.access) headers.Authorization = `Bearer ${memory.access}`;
  if (establishmentId) headers["X-Establishment"] = String(establishmentId);
  return headers;
}

export async function api(path, { method = "GET", body, params, retry = true } = {}) {
  if (DEMO) {
    try {
      return await demoApi(path, { method, body, params, establishmentId });
    } catch (e) {
      if (e.status === 401 && path !== "/auth/token/") { tokens.set(null); onUnauthorized(); }
      throw new ApiError(e.status, e.data);
    }
  }
  const url = buildUrl(path, params);
  const headers = authHeaders({ Accept: "application/json" });
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let res;
  try {
    res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError(0, { detail: "Sem conexão com o servidor. Verifique a internet e tente de novo." });
  }

  if (res.status === 401 && retry && memory?.refresh) {
    if (await refreshAccess()) return api(path, { method, body, params, retry: false });
    tokens.set(null);
    onUnauthorized();
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

/** Baixa um arquivo autenticado (ex.: planilha Excel) e dispara o download. */
export async function download(path, { params, fallbackName = "arquivo.xlsx", retry = true } = {}) {
  if (DEMO) throw new ApiError(400, { detail: "A exportação para Excel funciona rodando o projeto com o backend (veja o README)." });
  let res;
  try {
    res = await fetch(buildUrl(path, params), { headers: authHeaders() });
  } catch {
    throw new ApiError(0, { detail: "Sem conexão com o servidor." });
  }
  if (res.status === 401 && retry && (await refreshAccess())) {
    return download(path, { params, fallbackName, retry: false });
  }
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
  const match = /filename="?([^"]+)"?/.exec(res.headers.get("Content-Disposition") || "");
  const name = match ? match[1] : fallbackName;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return name;
}

export async function login(username, password) {
  const data = await api("/auth/token/", { method: "POST", body: { username, password }, retry: false });
  tokens.set(data);
  return api("/auth/me/");
}

export function logout() {
  tokens.set(null);
}
