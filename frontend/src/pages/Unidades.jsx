import { useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import Icon from "../components/Icon";
import { Empty, ErrorBox, Field, Modal, PageHeader, Spinner, useLoad, useToast } from "../components/ui";

export default function Unidades() {
  const { reloadEstablishments } = useAuth();
  const list = useLoad(() => api("/establishments/"), []);
  const [editing, setEditing] = useState(null);

  return (
    <div className="page">
      <PageHeader
        title="Unidades"
        subtitle="Lojas e fábrica da rede."
        help={<>
          <p>Cada unidade tem <b>saldo e estoque mínimo próprios</b>. O cadastro de ingredientes e categorias é o mesmo para todas.</p>
          <p>Os funcionários ficam vinculados a uma unidade. O admin master troca a unidade em uso no seletor do menu.</p>
          <p>O <b>tipo</b> define as encomendas: a <b>loja</b> registra os pedidos dos clientes e a <b>fábrica</b> recebe todos no quadro de produção.</p>
          <p>Uma unidade que já tem movimentações não pode ser excluída, só desativada.</p>
        </>}
        actions={<button className="btn btn-primary" onClick={() => setEditing({})}><Icon name="plus" /> Nova unidade</button>}
      />
      <ErrorBox error={list.error} onRetry={list.reload} />
      {list.loading && !list.data ? <Spinner /> : !list.data?.length ? (
        <Empty icon="store" title="Nenhuma unidade cadastrada" />
      ) : (
        <div className="user-grid">
          {list.data.map((e) => (
            <button key={e.id} className={`user-card card ${e.active ? "" : "reversed"}`} onClick={() => setEditing(e)}>
              <div className="avatar avatar-lg"><Icon name={e.kind === "fabrica" ? "cake" : "store"} /></div>
              <div className="grow">
                <strong>{e.name}</strong>
                <span className="muted small block">{e.kind === "fabrica" ? "Fábrica · recebe as encomendas" : "Loja"}{e.address ? ` · ${e.address}` : ""}</span>
                <span className="muted small block">{e.user_count} {e.user_count === 1 ? "usuário" : "usuários"}</span>
              </div>
              <span className={`badge ${e.active ? "badge-normal" : "badge-zerado"}`}>{e.active ? "Ativa" : "Inativa"}</span>
            </button>
          ))}
        </div>
      )}
      {editing && (
        <UnitForm unit={editing} onClose={() => setEditing(null)}
                  onSaved={() => { setEditing(null); list.reload(); reloadEstablishments(); }} />
      )}
    </div>
  );
}

function UnitForm({ unit, onClose, onSaved }) {
  const toast = useToast();
  const isNew = !unit.id;
  const [form, setForm] = useState({ name: unit.name || "", address: unit.address || "", kind: unit.kind || "loja", active: unit.active ?? true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(isNew ? "/establishments/" : `/establishments/${unit.id}/`, { method: isNew ? "POST" : "PATCH", body: form });
      toast(isNew ? "Unidade criada." : "Unidade atualizada.");
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={isNew ? "Nova unidade" : "Editar unidade"} size="sm"
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary grow" form="unit-form" disabled={busy}>{busy ? "Salvando…" : "Salvar"}</button>
      </>}>
      <form id="unit-form" className="form" onSubmit={submit}>
        <Field label="Nome *"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="Ex.: Sr. Grão Centro" /></Field>
        <div className="field">
          <span className="field-label">Tipo</span>
          <div className="segmented" role="radiogroup" aria-label="Tipo de unidade">
            {[["loja", "Loja"], ["fabrica", "Fábrica"]].map(([v, l]) => (
              <button type="button" key={v} role="radio" aria-checked={form.kind === v} className={form.kind === v ? "on" : ""}
                      onClick={() => setForm({ ...form, kind: v })}>{l}</button>
            ))}
          </div>
          <span className="field-hint">
            {form.kind === "fabrica" ? "Recebe no quadro as encomendas de todas as lojas." : "Registra encomendas de clientes e as envia para a fábrica."}
          </span>
        </div>
        <Field label="Endereço"><input className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
        {!isNew && (
          <label className="check">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
            <span>Unidade ativa</span>
          </label>
        )}
        {error && <div className="alert alert-error"><Icon name="alert" /><span>{error}</span></div>}
      </form>
    </Modal>
  );
}
