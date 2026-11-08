import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import Icon from "../components/Icon";
import { OrderCard, OrderDetail } from "../components/OrderParts";
import { Chips, ErrorBox, HelpTip, SearchBox, Spinner, useToast } from "../components/ui";
import {
  BOARD_COLUMNS, dayKey, dayLabel, playChime, printDay, printFormat, printOrders, STATUS, todayKey, unlockSound,
} from "../orders";

const POLL_MS = 15000;
const SOUND_KEY = "srgrao.som";
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const readSound = () => {
  try {
    return localStorage.getItem(SOUND_KEY) !== "0";
  } catch {
    return true;
  }
};

export default function Quadro() {
  const { establishments } = useAuth();
  const toast = useToast();
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [store, setStore] = useState("");
  const [search, setSearch] = useState("");
  const [newIds, setNewIds] = useState(() => new Set());
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [sound, setSound] = useState(readSound);
  const [soundReady, setSoundReady] = useState(false);
  const [format, setFormat] = useState(printFormat.get);
  const [open, setOpen] = useState(null);
  const [busyIds, setBusyIds] = useState(() => new Set());
  const [mobileCol, setMobileCol] = useState("agendado");
  const seen = useRef(null);
  const soundRef = useRef(sound);
  soundRef.current = sound && soundReady;

  const load = useCallback(async () => {
    try {
      const list = await api("/orders/", { params: { quadro: 1 } });
      if (seen.current) {
        const fresh = list.filter((o) => !seen.current.has(o.id) && o.status === "agendado");
        if (fresh.length) {
          setNewIds((s) => new Set([...s, ...fresh.map((o) => o.id)]));
          if (soundRef.current) playChime();
          toast(fresh.length === 1
            ? `Nova encomenda #${fresh[0].id} · ${fresh[0].store_name}`
            : `${fresh.length} novas encomendas`, { duration: 8000 });
        }
      }
      seen.current = new Set([...(seen.current || []), ...list.map((o) => o.id)]);
      setOrders(list);
      setError(null);
      setUpdatedAt(Date.now());
    } catch (e) {
      setError(e);
    }
  }, [toast]);

  useEffect(() => {
    load();
    const poll = setInterval(load, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 30000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  // Contador de novas no título da aba (ajuda quando a tela está em outra janela).
  useEffect(() => {
    const base = "Sr. Grão";
    document.title = newIds.size ? `(${newIds.size}) Novas encomendas · ${base}` : `Encomendas · ${base}`;
    return () => { document.title = base; };
  }, [newIds]);

  const stores = useMemo(() => establishments.filter((e) => e.active && e.kind !== "fabrica"), [establishments]);

  const filtered = useMemo(() => {
    const q = norm(search.trim());
    return (orders || []).filter((o) =>
      (!store || String(o.store) === String(store)) &&
      (!q || norm(o.customer_name).includes(q) || norm(o.customer_phone).replace(/\D/g, "").includes(q.replace(/\D/g, "") || "§") || String(o.id) === q.replace("#", "")));
  }, [orders, store, search]);

  const columns = useMemo(() => {
    const cols = Object.fromEntries(BOARD_COLUMNS.map((c) => [c, []]));
    filtered.forEach((o) => cols[o.status]?.push(o));
    cols.enviado.sort((a, b) => new Date(b.status_changed_at) - new Date(a.status_changed_at));
    return cols;
  }, [filtered]);

  const days = useMemo(() => {
    const map = new Map();
    columns.agendado.forEach((o) => {
      const k = dayKey(o.due_at);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(o);
    });
    return [...map.entries()];
  }, [columns]);

  const unprinted = filtered.filter((o) => !o.printed_at && o.status !== "enviado");

  const replace = (updated) => {
    setOrders((list) => (list || []).map((o) => (o.id === updated.id ? updated : o)).filter((o) => o.status !== "cancelado"));
    clearNew([updated.id]);
  };
  const clearNew = (ids) => setNewIds((s) => {
    const next = new Set(s);
    ids.forEach((id) => next.delete(id));
    return next;
  });

  async function markPrinted(list) {
    const ids = list.filter((o) => !o.printed_at).map((o) => o.id);
    clearNew(list.map((o) => o.id));
    if (!ids.length) return;
    try {
      await api("/orders/impressas/", { method: "POST", body: { ids } });
      const stamp = new Date().toISOString();
      setOrders((all) => (all || []).map((o) => (ids.includes(o.id) ? { ...o, printed_at: stamp } : o)));
    } catch {
      /* a marcação é só um lembrete; a impressão já saiu */
    }
  }
  function print(list) {
    printOrders(list, { format });
    markPrinted(list);
  }

  async function move(o, status) {
    setBusyIds((s) => new Set(s).add(o.id));
    try {
      replace(await api(`/orders/${o.id}/andamento/`, { method: "POST", body: { status } }));
    } catch (e) {
      toast(e.message, { tone: "error" });
      load();
    } finally {
      setBusyIds((s) => {
        const next = new Set(s);
        next.delete(o.id);
        return next;
      });
    }
  }

  async function printDaySheet(k) {
    try {
      const list = await api("/orders/", { params: { todas: 1, de: k, ate: k, status: ["agendado", "producao", "pronto", "enviado"] } });
      const scoped = list.filter((o) => !store || String(o.store) === String(store));
      if (!scoped.length) return toast("Nenhuma encomenda nesse dia.", { tone: "error" });
      printDay(k, scoped, { format });
    } catch (e) {
      toast(e.message, { tone: "error" });
    }
  }

  function toggleSound() {
    if (!sound || !soundReady) {
      const ok = unlockSound();
      setSoundReady(ok);
      setSound(true);
      try { localStorage.setItem(SOUND_KEY, "1"); } catch { /* ok */ }
      if (ok) playChime();
    } else {
      setSound(false);
      try { localStorage.setItem(SOUND_KEY, "0"); } catch { /* ok */ }
    }
  }
  const soundOn = sound && soundReady;

  const changeFormat = (v) => { setFormat(v); printFormat.set(v); };
  const toggleDay = (k) => setCollapsed((s) => {
    const next = new Set(s);
    next.has(k) ? next.delete(k) : next.add(k);
    return next;
  });

  const renderCard = (o) => {
    const st = STATUS[o.status];
    const flags = [];
    if (newIds.has(o.id)) flags.push("nova");
    if (!o.printed_at && o.status !== "enviado") flags.push("naoimpressa");
    return (
      <OrderCard key={o.id} order={o} now={now} flags={flags} onOpen={() => { setOpen(o.id); clearNew([o.id]); }}
        footer={<>
          <button className="icon-btn" title="Imprimir comanda" aria-label={`Imprimir comanda #${o.id}`} onClick={() => print([o])}>
            <Icon name="printer" size={20} />
          </button>
          {st.prev && o.status === "enviado" && (
            <button className="btn btn-ghost btn-sm" disabled={busyIds.has(o.id)} onClick={() => move(o, st.prev)}>
              <Icon name="undo" size={16} /> Desfazer
            </button>
          )}
          {st.next && (
            <button className={`btn btn-sm grow ${o.status === "pronto" ? "btn-ok" : "btn-primary"}`}
                    disabled={busyIds.has(o.id)} onClick={() => move(o, st.next)}>
              {st.action} <Icon name="chevron" size={16} />
            </button>
          )}
        </>}
      />
    );
  };

  const counts = Object.fromEntries(BOARD_COLUMNS.map((c) => [c, columns[c].length]));
  const today = todayKey();

  return (
    <div className="page page-board">
      <div className="board-head">
        <div>
          <h1 className="title-help">
            Encomendas
            <HelpTip title="Quadro da fábrica">
              <p>As encomendas das lojas chegam aqui sozinhas (a tela atualiza a cada 15 segundos). Encomenda nova toca um aviso e aparece com a etiqueta <b>Nova</b>.</p>
              <p><b>Imprimir</b>: imprime a comanda. Use <b>Imprimir novas</b> para soltar todas as que ainda não saíram de uma vez.</p>
              <p>Avance cada cartão: <b>Agendado → Em produção → Pronto → Enviado à loja</b>. Abra o cartão para voltar uma etapa ou cancelar.</p>
              <p><b>Folha do dia</b>: total por produto e a lista de encomendas daquele dia.</p>
              <p>As enviadas ficam visíveis por 24 horas. Para o som funcionar, clique em <b>Ativar som</b> uma vez ao abrir a tela.</p>
            </HelpTip>
          </h1>
          <p className="muted small">
            {updatedAt ? <>Atualizado às {new Date(updatedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</> : "Carregando…"}
            {error && <span className="text-error"> · sem conexão, tentando de novo…</span>}
          </p>
        </div>
        <div className="board-actions">
          <button className={`btn ${soundOn ? "btn-ghost" : "btn-warn"}`} onClick={toggleSound} aria-pressed={soundOn}>
            <Icon name={soundOn ? "bell" : "bellOff"} /> {soundOn ? "Som ligado" : "Ativar som"}
          </button>
          <div className="segmented seg-sm" role="radiogroup" aria-label="Formato de impressão">
            <button type="button" className={format === "cupom" ? "on" : ""} onClick={() => changeFormat("cupom")} aria-pressed={format === "cupom"}>Cupom 80 mm</button>
            <button type="button" className={format === "a4" ? "on" : ""} onClick={() => changeFormat("a4")} aria-pressed={format === "a4"}>Folha A4</button>
          </div>
          <button className="btn btn-primary" disabled={!unprinted.length} onClick={() => print(unprinted)}>
            <Icon name="printer" /> Imprimir novas{unprinted.length ? ` (${unprinted.length})` : ""}
          </button>
        </div>
      </div>

      <div className="toolbar">
        <SearchBox value={search} onChange={setSearch} placeholder="Buscar cliente, telefone ou nº…" />
        {stores.length > 1 && (
          <Chips options={stores.map((s) => ({ value: s.id, label: s.name.replace(/^Sr\.? Grão\s*/i, "") || s.name }))}
                 value={store} onChange={setStore} allLabel="Todas as lojas" />
        )}
      </div>

      {error && !orders && <ErrorBox error={error} onRetry={load} />}
      {!orders ? <Spinner /> : (
        <>
          <div className="board-tabs" role="tablist">
            {BOARD_COLUMNS.map((c) => (
              <button key={c} role="tab" aria-selected={mobileCol === c} className={`chip ${mobileCol === c ? "on" : ""}`} onClick={() => setMobileCol(c)}>
                {STATUS[c].label} <span className="chip-count">{counts[c]}</span>
              </button>
            ))}
          </div>
          <div className="board">
            <section className={`board-col col-agendado ${mobileCol === "agendado" ? "m-on" : ""}`}>
              <header className="board-col-head"><h2>Agendados</h2><span className="board-count">{counts.agendado}</span></header>
              <div className="board-col-body">
                {days.length === 0 && <p className="board-empty">Nenhuma encomenda agendada.</p>}
                {days.map(([k, list], idx) => {
                  const isCollapsed = collapsed.has(k) !== (idx >= 3);
                  return (
                    <div key={k} className={`day-group ${k < today ? "past" : ""}`}>
                      <div className="day-head">
                        <button type="button" className="day-toggle" onClick={() => toggleDay(k)} aria-expanded={!isCollapsed}>
                          <Icon name={isCollapsed ? "chevron" : "sortDown"} size={18} />
                          <strong>{dayLabel(k)}</strong>
                          <span className="board-count">{list.length}</span>
                        </button>
                        <button type="button" className="icon-btn" title="Folha do dia (total por produto)" aria-label={`Imprimir folha de ${dayLabel(k)}`}
                                onClick={() => printDaySheet(k)}>
                          <Icon name="list" size={18} />
                        </button>
                      </div>
                      {!isCollapsed && <div className="day-cards">{list.map(renderCard)}</div>}
                    </div>
                  );
                })}
              </div>
            </section>
            {["producao", "pronto", "enviado"].map((c) => (
              <section key={c} className={`board-col col-${c} ${mobileCol === c ? "m-on" : ""}`}>
                <header className="board-col-head">
                  <h2>{STATUS[c].label}</h2><span className="board-count">{counts[c]}</span>
                </header>
                <div className="board-col-body">
                  {columns[c].length === 0 && <p className="board-empty">{c === "enviado" ? "Nada enviado nas últimas 24 h." : "Vazio."}</p>}
                  {columns[c].map(renderCard)}
                </div>
              </section>
            ))}
          </div>
        </>
      )}

      {open && (
        <OrderDetail orderId={open} factory onClose={() => setOpen(null)}
                     onPrint={(o) => print([o])}
                     onChanged={(u) => { replace(u); if (u.status === "cancelado") setOpen(null); }} />
      )}
    </div>
  );
}
