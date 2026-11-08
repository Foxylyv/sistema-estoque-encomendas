import { useMemo, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import Icon from "../components/Icon";
import { profileName } from "../components/Layout";
import { Chips, Empty, ErrorBox, Field, HelpTip, Modal, PageHeader, Spinner, useLoad, useToast } from "../components/ui";
import { fmtDateTime } from "../format";

const PROFILE_INFO = [
  { key: "funcionario", label: "Funcionário", desc: "Dá baixa no consumo e em perdas." },
  { key: "compras", label: "Compras", desc: "Dá baixa e registra as entradas de mercadorias." },
  { key: "gerente", label: "Gerente da unidade", desc: "Tudo dentro da unidade, inclusive cadastrar a equipe." },
  { key: "atendente", label: "Atendente (encomendas)", desc: "Só registra encomendas de clientes na loja." },
  { key: "fabrica", label: "Fábrica", desc: "Quadro de encomendas, impressão e catálogo de produtos; também dá baixa." },
];

export default function Usuarios() {
  const { isMaster, establishments } = useAuth();
  const users = useLoad(() => api("/users/", { params: { page_size: 500 } }), []);
  const [editing, setEditing] = useState(null);
  const [unit, setUnit] = useState("");

  const list = (users.data?.results || []).filter(
    (u) => !unit || (unit === "master" ? u.is_master_user : String(u.establishment) === String(unit))
  );

  return (
    <div className="page">
      <PageHeader
        title={isMaster ? "Usuários" : "Equipe da unidade"}
        subtitle="Quem acessa o sistema, em qual unidade e o que pode fazer."
        help={<>
          <p>Escolha um <b>perfil pronto</b> ao cadastrar:</p>
          <ul>
            {PROFILE_INFO.map((p) => <li key={p.key}><b>{p.label}</b>: {p.desc}</li>)}
            {isMaster && <li><b>Admin master</b>: acesso a todas as unidades e configurações.</li>}
          </ul>
          <p>Se precisar, toque em <b>Personalizar</b> e marque as permissões uma a uma.</p>
          <p>Para tirar o acesso de alguém, desmarque “Usuário ativo”. O histórico dessa pessoa continua guardado.</p>
        </>}
        actions={<button className="btn btn-primary" onClick={() => setEditing({})}><Icon name="plus" /> Novo usuário</button>}
      />

      {isMaster && establishments.length > 1 && (
        <Chips
          options={[...establishments.map((e) => ({ value: e.id, label: e.name })), { value: "master", label: "Admin master" }]}
          value={unit}
          onChange={setUnit}
        />
      )}

      <ErrorBox error={users.error} onRetry={users.reload} />
      {users.loading && !users.data ? <Spinner /> : !list.length ? <Empty icon="users" title="Nenhum usuário" /> : (
        <div className="user-grid">
          {list.map((u) => (
            <button key={u.id} className={`user-card card ${u.is_active ? "" : "reversed"}`} onClick={() => setEditing(u)}>
              <div className="avatar avatar-lg">{u.full_name.slice(0, 1)}</div>
              <div className="grow">
                <strong>{u.full_name}</strong>
                <span className="muted small block">@{u.username}{u.establishment_name ? ` · ${u.establishment_name}` : ""}</span>
                <span className="muted small block">
                  {u.last_login ? `Último acesso: ${fmtDateTime(u.last_login)}` : "Nunca acessou"}
                </span>
              </div>
              <span className={`badge ${u.is_master_user ? "badge-role-admin" : "badge-role-cozinha"}`}>
                {!u.is_active ? "Inativo" : u.is_master_user ? "Admin master" : profileName(u.effective_capabilities)}
              </span>
            </button>
          ))}
        </div>
      )}

      {editing && (
        <UserForm user={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); users.reload(); }} />
      )}
    </div>
  );
}

function detectProfile(caps, profiles) {
  const key = [...caps].sort().join(",");
  return Object.entries(profiles).find(([, list]) => [...list].sort().join(",") === key)?.[0] || "custom";
}

function UserForm({ user, onClose, onSaved }) {
  const toast = useToast();
  const { isMaster, meta, establishments, establishment, user: me } = useAuth();
  const profiles = meta.profiles || { funcionario: ["baixa"], compras: ["baixa", "entrada"], gerente: [] };
  const isNew = !user.id;
  const [form, setForm] = useState({
    first_name: user.first_name || "",
    last_name: user.last_name || "",
    username: user.username || "",
    is_master: !!user.is_master,
    establishment: user.establishment || establishment?.id || "",
    capabilities: user.capabilities || profiles.funcionario,
    is_active: user.is_active ?? true,
    password: "",
  });
  const profile = form.is_master ? "master" : detectProfile(form.capabilities, profiles);
  const [custom, setCustom] = useState(profile === "custom");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isSelf = user.id === me.id;

  const choose = (key) => {
    if (key === "master") setForm({ ...form, is_master: true });
    else setForm({ ...form, is_master: false, capabilities: profiles[key] });
  };
  const toggleCap = (code) =>
    setForm((f) => ({
      ...f,
      capabilities: f.capabilities.includes(code) ? f.capabilities.filter((c) => c !== code) : [...f.capabilities, code],
    }));

  const options = useMemo(
    () => [...PROFILE_INFO, ...(isMaster ? [{ key: "master", label: "Admin master", desc: "Todas as unidades, usuários e configurações." }] : [])],
    [isMaster]
  );

  async function submit(e) {
    e.preventDefault();
    if (!form.is_master && !form.capabilities.length) return setError("Marque ao menos uma permissão.");
    setBusy(true);
    setError("");
    const body = { ...form, establishment: form.establishment ? Number(form.establishment) : null };
    if (!body.password) delete body.password;
    if (!isMaster) { delete body.is_master; delete body.establishment; }
    try {
      await api(isNew ? "/users/" : `/users/${user.id}/`, { method: isNew ? "POST" : "PATCH", body });
      toast(isNew ? "Usuário criado." : "Usuário atualizado.");
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const f = (k) => ({ value: form[k], onChange: (e) => setForm({ ...form, [k]: e.target.value }) });

  return (
    <Modal open onClose={onClose} title={isNew ? "Novo usuário" : "Editar usuário"} size="md"
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary grow" form="user-form" disabled={busy}>{busy ? "Salvando…" : "Salvar"}</button>
      </>}>
      <form id="user-form" className="form" onSubmit={submit}>
        <div className="form-row">
          <Field label="Nome *" className="grow"><input className="input" {...f("first_name")} required /></Field>
          <Field label="Sobrenome" className="grow"><input className="input" {...f("last_name")} /></Field>
        </div>
        <div className="form-row">
          <Field label="Usuário (login) *" className="grow">
            <input className="input" autoCapitalize="none" autoComplete="off" {...f("username")} required />
          </Field>
          <Field label={isNew ? "Senha *" : "Nova senha"} className="grow"
                 hint={isNew ? "Mínimo de 6 caracteres." : "Em branco = manter a atual."}>
            <input className="input" type="password" autoComplete="new-password" {...f("password")} required={isNew} />
          </Field>
        </div>

        <div className="field">
          <span className="field-label">
            Perfil de acesso
            <HelpTip title="Perfil de acesso">
              Os perfis já marcam as permissões certas. Use <b>Personalizar</b> só se precisar de uma combinação diferente.
            </HelpTip>
          </span>
          <div className="profile-grid" role="radiogroup">
            {options.map((p) => (
              <button type="button" key={p.key} role="radio" aria-checked={profile === p.key} disabled={isSelf}
                      className={`profile-opt ${profile === p.key ? "on" : ""}`} onClick={() => choose(p.key)}>
                <span className="profile-check"><Icon name="check" size={16} /></span>
                <strong>{p.label}</strong>
                <span className="small muted">{p.desc}</span>
              </button>
            ))}
          </div>
          {profile === "custom" && <span className="field-hint">Permissões personalizadas.</span>}
        </div>

        {!form.is_master && isMaster && (
          <Field label="Unidade *" help="O funcionário só enxerga e movimenta o estoque desta unidade.">
            <select className="input" value={form.establishment} onChange={(e) => setForm({ ...form, establishment: e.target.value })} required>
              <option value="" disabled>Selecione…</option>
              {establishments.map((e) => <option key={e.id} value={e.id}>{e.name}{e.active ? "" : " (inativa)"}</option>)}
            </select>
          </Field>
        )}

        {!form.is_master && (
          <div className="perm-box">
            <button type="button" className="perm-toggle" onClick={() => setCustom((v) => !v)} aria-expanded={custom}>
              <Icon name="shield" size={18} />
              <span className="grow">Personalizar permissões ({form.capabilities.length})</span>
              <Icon name={custom ? "sortUp" : "sortDown"} size={18} />
            </button>
            {custom && (
              <ul className="perm-list">
                {meta.capabilities.map((c) => (
                  <li key={c.code}>
                    <label className="check">
                      <input type="checkbox" checked={form.capabilities.includes(c.code)} onChange={() => toggleCap(c.code)}
                             disabled={isSelf && c.code === "usuarios"} />
                      <span>
                        <strong className="block">{c.label}</strong>
                        <span className="small muted">{c.help}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {!isNew && !isSelf && (
          <label className="check">
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
            <span>Usuário ativo (desmarque para bloquear o acesso)</span>
          </label>
        )}
        {error && <div className="alert alert-error"><Icon name="alert" /><span>{error}</span></div>}
      </form>
    </Modal>
  );
}
