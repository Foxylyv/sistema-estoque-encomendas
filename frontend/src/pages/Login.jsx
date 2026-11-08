import { useState } from "react";
import { useAuth } from "../auth";
import Icon from "../components/Icon";

export default function Login() {
  const { login } = useAuth();
  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(form.username.trim(), form.password);
    } catch (err) {
      setError(err.status === 401 ? "Usuário ou senha incorretos." : err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <div className="login-hero" style={{ backgroundImage: "url(/capa.jpg)" }}>
        <div className="login-hero-text">
          <p className="eyebrow">Cafeteria &amp; Doceria</p>
          <h2>Qualidade começa no que está na despensa.</h2>
        </div>
      </div>
      <div className="login-panel">
        <form className="login-card" onSubmit={submit}>
          <img className="login-logo" src="/logo.jpg" alt="Sr. Grão Cafeteria & Doceria" />
          <h1>Controle de estoque</h1>
          <p className="muted">Entre com seu usuário para continuar.</p>

          {error && (
            <div className="alert alert-error">
              <Icon name="alert" />
              <span>{error}</span>
            </div>
          )}

          <label className="field">
            <span className="field-label">Usuário</span>
            <input
              className="input input-lg"
              autoComplete="username"
              autoCapitalize="none"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              required
            />
          </label>
          <label className="field">
            <span className="field-label">Senha</span>
            <input
              className="input input-lg"
              type="password"
              autoComplete="current-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
            />
          </label>
          <button className="btn btn-primary btn-lg btn-block" disabled={busy}>
            {busy ? "Entrando…" : "Entrar"}
          </button>
        </form>
      </div>
    </div>
  );
}
