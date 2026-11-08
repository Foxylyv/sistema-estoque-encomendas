// Utilidades do módulo de Encomendas: datas, andamento, impressão e aviso sonoro.

/** Modo da aba Encomendas conforme a unidade em uso: "fabrica" (quadro), "loja" ou null. */
export function ordersMode({ establishment, can }) {
  if (!establishment) return null;
  if (establishment.kind === "fabrica") return can("producao") ? "fabrica" : null;
  return can("encomendas") ? "loja" : null;
}

export const STATUS = {
  agendado: { label: "Agendado", next: "producao", action: "Iniciar produção" },
  producao: { label: "Em produção", next: "pronto", prev: "agendado", action: "Marcar como pronto" },
  pronto: { label: "Pronto", next: "enviado", prev: "producao", action: "Enviar à loja" },
  enviado: { label: "Enviado à loja", prev: "pronto" },
  cancelado: { label: "Cancelado" },
};
export const BOARD_COLUMNS = ["agendado", "producao", "pronto", "enviado"];

const pad = (n) => String(n).padStart(2, "0");
const timeFmt = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
const weekday = new Intl.DateTimeFormat("pt-BR", { weekday: "short" });
const weekdayLong = new Intl.DateTimeFormat("pt-BR", { weekday: "long" });
const dayMonth = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });
const full = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

/** "2026-12-09" no fuso do navegador. */
export const dayKey = (v) => {
  const d = new Date(v);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const keyDate = (key) => new Date(`${key}T12:00:00`);
const addDays = (key, n) => {
  const d = keyDate(key);
  d.setDate(d.getDate() + n);
  return dayKey(d);
};
export const todayKey = () => dayKey(new Date());

/** "Hoje", "Amanhã", "Ontem" ou "sáb., 09/12". */
export function dayLabel(key, { long = false, absolute = false } = {}) {
  const today = todayKey();
  if (!absolute) {
    if (key === today) return "Hoje";
    if (key === addDays(today, 1)) return "Amanhã";
    if (key === addDays(today, -1)) return "Ontem";
  }
  const d = keyDate(key);
  return long ? `${cap(weekdayLong.format(d))}, ${dayMonth.format(d)}` : `${cap(weekday.format(d))} ${dayMonth.format(d)}`;
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export const fmtTime = (v) => timeFmt.format(new Date(v));
export const fmtFull = (v) => (v ? full.format(new Date(v)) : "");
/** "Hoje às 12:00", "Sáb 09/12 às 12:00". */
export const fmtDue = (v) => `${dayLabel(dayKey(v))} às ${fmtTime(v)}`;
/** No papel, sempre a data fixa: "Hoje"/"Amanhã" ficaria errado no dia seguinte. */
const fmtDuePrint = (v) => `${dayLabel(dayKey(v), { absolute: true })} às ${fmtTime(v)}`;

/** Urgência pela hora de entrega: atrasada, em menos de 3 h ou normal. */
export function urgency(order, now = Date.now()) {
  if (["enviado", "cancelado"].includes(order.status)) return "";
  const diff = new Date(order.due_at).getTime() - now;
  if (diff < 0) return "late";
  if (diff < 3 * 3600 * 1000) return "soon";
  return "";
}

export function sinceText(v, now = Date.now()) {
  const min = Math.max(0, Math.round((now - new Date(v).getTime()) / 60000));
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h${min % 60 ? ` ${min % 60} min` : ""}`;
  const d = Math.floor(h / 24);
  return `há ${d} ${d === 1 ? "dia" : "dias"}`;
}

export const itemsSummary = (order) => order.items.map((i) => `${i.quantity}× ${i.product_name}`).join(", ");

/* ---------------- Impressão ---------------- */

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const nl = (s) => esc(s).replace(/\n/g, "<br>");

const PRINT_KEY = "aurora.impressao";
export const printFormat = {
  get() {
    try {
      return localStorage.getItem(PRINT_KEY) === "a4" ? "a4" : "cupom";
    } catch {
      return "cupom";
    }
  },
  set(v) {
    try {
      localStorage.setItem(PRINT_KEY, v);
    } catch {
      /* sem armazenamento: vale só agora */
    }
  },
};

const BASE_CSS = `
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "DM Sans", Arial, sans-serif; color: #000; }
  h1, h2, h3, p { margin: 0; }
  .brand { font-family: Georgia, serif; font-weight: 700; }
  .muted { color: #444; }
  .comanda { page-break-inside: avoid; break-inside: avoid; }
`;
const CUPOM_CSS = `
  @page { size: 80mm auto; margin: 3mm; }
  body { width: 72mm; font-size: 12px; }
  .comanda { padding: 2mm 0 4mm; border-bottom: 1px dashed #000; margin-bottom: 4mm; }
  .comanda:last-child { border-bottom: 0; }
  .c-head { text-align: center; border-bottom: 1px dashed #000; padding-bottom: 2mm; margin-bottom: 2mm; }
  .c-head .brand { font-size: 15px; }
  .c-num { font-size: 22px; font-weight: 800; }
  .c-due { text-align: center; font-size: 17px; font-weight: 800; border: 2px solid #000; padding: 1.5mm; margin: 2mm 0; }
  .c-row { margin: 1mm 0; }
  .c-items { margin: 2mm 0; padding: 0; list-style: none; border-top: 1px dashed #000; border-bottom: 1px dashed #000; }
  .c-items li { padding: 1.5mm 0; font-size: 14px; }
  .c-items b { font-size: 16px; }
  .c-items .obs { display: block; font-size: 12px; padding-left: 6mm; }
  .c-notes { border: 1px solid #000; padding: 1.5mm; margin: 2mm 0; }
  .c-foot { font-size: 10px; text-align: center; margin-top: 2mm; }
  .via { text-align: center; font-weight: 700; letter-spacing: .1em; font-size: 11px; margin-bottom: 1mm; }
`;
const A4_CSS = `
  @page { size: A4; margin: 14mm; }
  body { font-size: 14px; }
  .comanda { border: 2px solid #000; border-radius: 6px; padding: 8mm; margin-bottom: 8mm; max-width: 150mm; }
  .c-head { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1px solid #000; padding-bottom: 3mm; margin-bottom: 3mm; }
  .c-head .brand { font-size: 18px; }
  .c-num { font-size: 28px; font-weight: 800; }
  .c-due { font-size: 22px; font-weight: 800; border: 2px solid #000; padding: 2mm 4mm; margin: 3mm 0; display: inline-block; }
  .c-row { margin: 1.5mm 0; font-size: 15px; }
  .c-items { margin: 4mm 0; padding: 0; list-style: none; border-top: 1px solid #000; }
  .c-items li { padding: 2.5mm 0; border-bottom: 1px solid #999; font-size: 17px; }
  .c-items .obs { display: block; font-size: 14px; padding-left: 10mm; }
  .c-notes { border: 1px solid #000; padding: 3mm; margin: 3mm 0; font-size: 15px; }
  .c-foot { font-size: 11px; margin-top: 3mm; }
  .via { font-weight: 700; letter-spacing: .1em; font-size: 12px; margin-bottom: 2mm; }
`;

function comandaHtml(o, { via } = {}) {
  const items = o.items
    .map((i) => `<li><b>${i.quantity}×</b> ${esc(i.product_name)}${i.notes ? `<span class="obs">↳ ${esc(i.notes)}</span>` : ""}</li>`)
    .join("");
  return `
  <section class="comanda">
    ${via ? `<div class="via">${esc(via)}</div>` : ""}
    <div class="c-head">
      <div class="brand">Café Aurora · Encomenda</div>
      <div class="c-num">#${o.id}</div>
    </div>
    <div class="c-due">ENTREGA: ${esc(fmtDuePrint(o.due_at).toUpperCase())}</div>
    <div class="c-row"><b>Loja:</b> ${esc(o.store_name)}</div>
    <div class="c-row"><b>Cliente:</b> ${esc(o.customer_name)}</div>
    ${o.customer_phone ? `<div class="c-row"><b>Telefone:</b> ${esc(o.customer_phone)}</div>` : ""}
    <ul class="c-items">${items}</ul>
    ${o.notes ? `<div class="c-notes"><b>Obs.:</b> ${nl(o.notes)}</div>` : ""}
    ${o.status === "cancelado" ? `<div class="c-notes"><b>CANCELADA:</b> ${esc(o.cancel_reason)}</div>` : ""}
    <div class="c-foot muted">Registrada por ${esc(o.created_by_name)} em ${esc(fmtFull(o.created_at))}</div>
  </section>`;
}

function daySheetHtml(dayKeyStr, orders) {
  const totals = {};
  orders.forEach((o) => o.items.forEach((i) => (totals[i.product_name] = (totals[i.product_name] || 0) + i.quantity)));
  const totalRows = Object.entries(totals)
    .sort((a, b) => a[0].localeCompare(b[0], "pt-BR"))
    .map(([name, q]) => `<tr><td class="q">${q}</td><td>${esc(name)}</td></tr>`)
    .join("");
  const rows = orders
    .map((o) => `<tr>
      <td class="nowrap"><b>${esc(fmtTime(o.due_at))}</b></td>
      <td>#${o.id}</td>
      <td>${esc(o.customer_name)}${o.customer_phone ? `<br><span class="muted">${esc(o.customer_phone)}</span>` : ""}</td>
      <td>${esc(o.store_name)}</td>
      <td>${o.items.map((i) => `<b>${i.quantity}×</b> ${esc(i.product_name)}${i.notes ? ` <i>(${esc(i.notes)})</i>` : ""}`).join("<br>")}
        ${o.notes ? `<div class="muted">Obs.: ${nl(o.notes)}</div>` : ""}</td>
    </tr>`)
    .join("");
  return `
    <h1 class="brand">Encomendas · ${esc(dayLabel(dayKeyStr, { long: true, absolute: true }))}</h1>
    <p class="muted">${orders.length} ${orders.length === 1 ? "encomenda" : "encomendas"} · impresso em ${esc(fmtFull(new Date()))}</p>
    <h2>Total a produzir</h2>
    <table class="tot">${totalRows}</table>
    <h2>Encomendas</h2>
    <table class="list"><thead><tr><th>Hora</th><th>Nº</th><th>Cliente</th><th>Loja</th><th>Itens</th></tr></thead><tbody>${rows}</tbody></table>`;
}

const DAY_CSS = `
  h1 { font-size: 20px; margin-bottom: 2mm; }
  h2 { font-size: 15px; margin: 5mm 0 2mm; border-bottom: 1px solid #000; padding-bottom: 1mm; }
  table { border-collapse: collapse; width: 100%; }
  td, th { text-align: left; vertical-align: top; padding: 1.5mm 2mm; border-bottom: 1px solid #bbb; }
  .tot td.q { width: 12mm; font-weight: 800; font-size: 1.15em; text-align: right; }
  .nowrap { white-space: nowrap; }
`;
const DAY_CUPOM_CSS = `
  .list thead { display: none; }
  .list tr { display: block; border-bottom: 1px dashed #000; padding: 1mm 0; }
  .list td { display: inline; border: 0; padding: 0 1mm 0 0; }
  .list td:last-child { display: block; padding-top: 1mm; }
`;

function printHtml(title, body, css) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  doc.open();
  doc.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${css}</style></head><body>${body}</body></html>`);
  doc.close();
  const win = frame.contentWindow;
  const cleanup = () => setTimeout(() => frame.remove(), 500);
  win.addEventListener("afterprint", cleanup);
  setTimeout(() => {
    win.focus();
    win.print();
    setTimeout(cleanup, 60000);
  }, 150);
}

/** Imprime uma ou mais comandas. `via` é um rótulo opcional (ex.: "VIA DO CLIENTE"). */
export function printOrders(orders, { via, format = printFormat.get() } = {}) {
  const css = BASE_CSS + (format === "a4" ? A4_CSS : CUPOM_CSS);
  const title = orders.length === 1 ? `Encomenda #${orders[0].id}` : `${orders.length} encomendas`;
  printHtml(title, orders.map((o) => comandaHtml(o, { via })).join(""), css);
}

/** Folha de produção do dia: total por produto + lista das encomendas. */
export function printDay(key, orders, { format = printFormat.get() } = {}) {
  const css = BASE_CSS + (format === "a4" ? A4_CSS : CUPOM_CSS) + DAY_CSS + (format === "a4" ? "" : DAY_CUPOM_CSS);
  printHtml(`Encomendas ${dayLabel(key, { absolute: true })}`, daySheetHtml(key, orders), css);
}

/* ---------------- Aviso sonoro ---------------- */

let audioCtx = null;
/** Precisa ser chamado a partir de um clique (regra dos navegadores). */
export function unlockSound() {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    return true;
  } catch {
    return false;
  }
}

export function playChime() {
  if (!audioCtx) return;
  try {
    const t0 = audioCtx.currentTime;
    [880, 1175, 1568].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t = t0 + i * 0.18;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.55);
    });
  } catch {
    /* sem áudio: o destaque visual continua */
  }
}
