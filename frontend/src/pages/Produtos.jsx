import { useMemo, useState } from "react";
import { api } from "../api";
import Icon from "../components/Icon";
import { Chips, Empty, ErrorBox, Field, Modal, PageHeader, SearchBox, Spinner, useLoad, useToast } from "../components/ui";

const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export default function Produtos() {
  const [search, setSearch] = useState("");
  const [inactive, setInactive] = useState("");
  const [editing, setEditing] = useState(null);
  const products = useLoad(() => api("/products/", { params: { active: inactive ? "false" : "true" } }), [inactive]);

  const groups = useMemo(() => {
    const q = norm(search.trim());
    const map = new Map();
    (products.data || [])
      .filter((p) => !q || norm(p.name).includes(q) || norm(p.group).includes(q))
      .forEach((p) => {
        const g = p.group || "Sem grupo";
        if (!map.has(g)) map.set(g, []);
        map.get(g).push(p);
      });
    return [...map.entries()];
  }, [products.data, search]);

  return (
    <div className="page">
      <PageHeader
        title="Produtos"
        subtitle="Catálogo da fábrica. É o que as lojas podem encomendar."
        help={<>
          <p>Cadastre aqui os produtos que a fábrica produz sob encomenda. As lojas escolhem desta lista.</p>
          <p>O <b>grupo</b> (Tortas, Bolos, Doces…) organiza os produtos na tela da loja.</p>
          <p>Produto que saiu do cardápio: desmarque <b>Ativo</b>. Ele some da tela das lojas, mas as encomendas antigas continuam com o nome certo.</p>
        </>}
        actions={<button className="btn btn-primary" onClick={() => setEditing({})}><Icon name="plus" /> Novo produto</button>}
      />
      <div className="toolbar">
        <SearchBox value={search} onChange={setSearch} placeholder="Buscar produto ou grupo…" />
        <Chips options={[{ value: "1", label: "Inativos" }]} value={inactive} onChange={setInactive} allLabel="Ativos" />
      </div>
      <ErrorBox error={products.error} onRetry={products.reload} />
      {products.loading && !products.data ? <Spinner /> : groups.length === 0 ? (
        <Empty icon="cake" title="Nenhum produto">{inactive ? "Nenhum produto inativo." : "Cadastre o primeiro produto do catálogo."}</Empty>
      ) : (
        groups.map(([g, list]) => (
          <section key={g} className="section section-tight">
            <h2 className="section-title">{g} <span className="muted small">· {list.length}</span></h2>
            <div className="card table-card">
              <table className="table">
                <tbody>
                  {list.map((p) => (
                    <tr key={p.id} className={`clickable ${p.active ? "" : "reversed"}`} onClick={() => setEditing(p)}>
                      <td><strong>{p.name}</strong>{p.description && <span className="muted small block">{p.description}</span>}</td>
                      <td className="actions"><Icon name="edit" size={18} className="muted" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
      {editing && <ProductForm product={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); products.reload(); }} />}
    </div>
  );
}

function ProductForm({ product, onClose, onSaved }) {
  const toast = useToast();
  const isNew = !product.id;
  const groups = useLoad(() => api("/products/grupos/"), []);
  const [form, setForm] = useState({
    name: product.name || "", group: product.group || "", description: product.description || "", active: product.active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const f = (k) => ({ value: form[k], onChange: (e) => setForm({ ...form, [k]: e.target.value }) });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(isNew ? "/products/" : `/products/${product.id}/`, { method: isNew ? "POST" : "PATCH", body: form });
      toast(isNew ? "Produto cadastrado." : "Produto atualizado.");
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={isNew ? "Novo produto" : "Editar produto"} size="sm"
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary grow" form="product-form" disabled={busy}>{busy ? "Salvando…" : "Salvar"}</button>
      </>}>
      <form id="product-form" className="form" onSubmit={submit}>
        <Field label="Nome *"><input className="input" {...f("name")} required maxLength={120} placeholder="Ex.: Torta de nozes" /></Field>
        <Field label="Grupo" hint="Escolha um existente ou digite um novo.">
          <input className="input" list="product-groups" {...f("group")} maxLength={60} placeholder="Ex.: Tortas" />
          <datalist id="product-groups">{(groups.data || []).map((g) => <option key={g} value={g} />)}</datalist>
        </Field>
        <Field label="Descrição"><input className="input" {...f("description")} maxLength={255} placeholder="Opcional. Ex.: serve 12 fatias" /></Field>
        {!isNew && (
          <label className="check">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
            <span>Ativo (aparece para as lojas)</span>
          </label>
        )}
        {error && <div className="alert alert-error"><Icon name="alert" /><span>{error}</span></div>}
      </form>
    </Modal>
  );
}
