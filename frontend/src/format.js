const num = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
const dateOnly = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" });
const timeOnly = new Intl.DateTimeFormat("pt-BR", { timeStyle: "short" });

export const fmtQty = (v) => num.format(Number(v || 0));
export const fmtMoney = (v) => money.format(Number(v || 0));
export const fmtDateTime = (v) => (v ? dateTime.format(new Date(v)) : "");
export const fmtDate = (v) => (v ? dateOnly.format(new Date(`${v}T12:00:00`)) : "");

export function fmtWhen(v) {
  const d = new Date(v);
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return `Hoje, ${timeOnly.format(d)}`;
  if (d.toDateString() === y.toDateString()) return `Ontem, ${timeOnly.format(d)}`;
  return dateTime.format(d);
}

/** Converte "1,5" ou "1.5" em número; retorna NaN se inválido. */
export function parseQty(text) {
  if (typeof text === "number") return text;
  const clean = String(text || "").trim().replace(/\s/g, "").replace(",", ".");
  if (!clean || !/^\d*\.?\d*$/.test(clean)) return NaN;
  return Number(clean);
}

export const todayISO = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};

export const STATUS_LABEL = { normal: "Normal", baixo: "Estoque baixo", zerado: "Zerado" };

export const KIND_TONE = {
  inicial: "in",
  entrada: "in",
  consumo: "out",
  perda: "loss",
  ajuste: "adjust",
  estorno: "muted",
};
