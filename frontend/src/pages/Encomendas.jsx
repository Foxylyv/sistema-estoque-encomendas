import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import Icon from "../components/Icon";
import { OrderCard, OrderDetail, StatusTag } from "../components/OrderParts";
import { Chips, Empty, ErrorBox, PageHeader, SearchBox, Spinner, useLoad } from "../components/ui";
import { dayKey, dayLabel, ordersMode } from "../orders";
import Quadro from "./Quadro";

export default function Encomendas() {
  const auth = useAuth();
  return ordersMode(auth) === "fabrica" ? <Quadro /> : <EncomendasLoja />;
}

const VIEWS = [
  { value: "abertas", label: "Em aberto" },
  { value: "enviado", label: "Enviadas" },
  { value: "cancelado", label: "Canceladas" },
  { value: "todas", label: "Todas" },
];

function EncomendasLoja() {
  const { establishment } = useAuth();
  const navigate = useNavigate();
  const [view, setView] = useState("abertas");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(null);

  const params = useMemo(() => {
    const p = { page_size: 200, search: search.trim() || undefined };
    if (view === "abertas") return { ...p, ativas: 1, ordering: "due_at" };
    if (view === "todas") return { ...p, ordering: "-due_at" };
    return { ...p, status: view, ordering: "-due_at" };
  }, [view, search]);
  const list = useLoad(() => api("/orders/", { params }), [params]);
  const orders = list.data?.results || [];

  const groups = useMemo(() => {
    const map = new Map();
    orders.forEach((o) => {
      const k = dayKey(o.due_at);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(o);
    });
    return [...map.entries()];
  }, [orders]);

  return (
    <div className="page">
      <PageHeader
        title="Encomendas"
        subtitle={`${establishment.name} · as encomendas vão direto para o quadro da fábrica.`}
        help={<>
          <p><b>1.</b> Toque em <b>Nova encomenda</b>, escolha os produtos e preencha os dados do cliente e a data de entrega.</p>
          <p><b>2.</b> Confira o resumo antes de enviar: <b>depois de enviada, a encomenda não pode ser editada</b>.</p>
          <p><b>3.</b> A encomenda aparece na hora na tela da fábrica. Aqui você acompanha o andamento: Agendado, Em produção, Pronto e Enviado à loja.</p>
          <p>Precisa cancelar ou corrigir? Fale com a fábrica: só ela pode cancelar.</p>
        </>}
        actions={
          <button className="btn btn-primary btn-lg" onClick={() => navigate("/encomendas/nova")}>
            <Icon name="plus" /> Nova encomenda
          </button>
        }
      />
      <div className="toolbar">
        <SearchBox value={search} onChange={setSearch} placeholder="Buscar por cliente, telefone ou número…" />
      </div>
      <Chips options={VIEWS.slice(1)} value={view === "abertas" ? "" : view}
             onChange={(v) => setView(v || "abertas")} allLabel={VIEWS[0].label} />

      <ErrorBox error={list.error} onRetry={list.reload} />
      {list.loading && !list.data ? <Spinner /> : orders.length === 0 ? (
        <Empty icon="cake" title={search ? "Nenhuma encomenda encontrada" : "Nenhuma encomenda aqui"}>
          {view === "abertas" && !search ? "Toque em “Nova encomenda” para registrar o pedido de um cliente." : null}
        </Empty>
      ) : (
        groups.map(([k, items]) => (
          <section key={k} className="section section-tight">
            <h2 className="section-title">{dayLabel(k, { long: true })} <span className="muted small">· {items.length}</span></h2>
            <div className="ord-list">
              {items.map((o) => (
                <OrderCard key={o.id} order={o} onOpen={() => setOpen(o)} showStore={false}
                           footer={<StatusTag status={o.status} />} />
              ))}
            </div>
          </section>
        ))
      )}
      {open && <OrderDetail orderId={open.id} onClose={() => setOpen(null)} />}
    </div>
  );
}
