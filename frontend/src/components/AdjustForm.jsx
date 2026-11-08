import { useState } from "react";
import { api } from "../api";
import { fmtQty, parseQty } from "../format";
import Icon from "./Icon";
import { Field, useToast } from "./ui";

const REASONS = ["Inventário físico", "Correção de lançamento", "Doação / uso interno", "Outro"];

/** Ajuste manual do saldo: informa o saldo real; a diferença vira um lançamento no histórico. */
export default function AdjustForm({ ingredient, onCancel, onDone }) {
  const toast = useToast();
  const [counted, setCounted] = useState("");
  const [unit, setUnit] = useState(ingredient.unit);
  const [reason, setReason] = useState(REASONS[0]);
  const [other, setOther] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const FACTOR = { kg: 1000, g: 1, L: 1000, ml: 1, un: 1 };
  const q = parseQty(counted);
  const inBase = q >= 0 ? (q * FACTOR[unit]) / FACTOR[ingredient.unit] : NaN;
  const diff = inBase - Number(ingredient.stock);
  const notes = reason === "Outro" ? other.trim() : reason;

  async function submit(e) {
    e.preventDefault();
    if (!(q >= 0)) return setError("Informe o saldo real.");
    if (!notes) return setError("Descreva o motivo.");
    setBusy(true);
    setError("");
    try {
      await api("/movements/ajuste/", {
        method: "POST",
        body: { ingredient: ingredient.id, counted_quantity: q.toFixed(3), unit, notes },
      });
      toast(`Saldo de ${ingredient.name} ajustado. O ajuste ficou registrado no histórico.`);
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form className="adjust card-inset" onSubmit={submit}>
      <p className="small muted">
        Saldo no sistema: <strong>{fmtQty(ingredient.stock)} {ingredient.unit}</strong>. Informe quanto existe de
        verdade; a diferença é lançada como <b>ajuste manual</b>, com seu nome e o motivo.
      </p>
      <div className="form-row">
        <Field label="Saldo real" className="grow">
          <input className="input" inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} autoFocus placeholder="0" />
        </Field>
        {ingredient.compatible_units.length > 1 && (
          <Field label="Unidade">
            <select className="input" value={unit} onChange={(e) => setUnit(e.target.value)}>
              {ingredient.compatible_units.map((u) => <option key={u}>{u}</option>)}
            </select>
          </Field>
        )}
      </div>
      {q >= 0 && Math.abs(diff) > 1e-9 && (
        <p className={`adjust-diff ${diff > 0 ? "pos" : "neg"}`}>
          Diferença: {diff > 0 ? "+" : "−"}{fmtQty(Math.abs(diff))} {ingredient.unit}
        </p>
      )}
      <Field label="Motivo">
        <select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
          {REASONS.map((r) => <option key={r}>{r}</option>)}
        </select>
      </Field>
      {reason === "Outro" && (
        <input className="input" value={other} onChange={(e) => setOther(e.target.value)} placeholder="Descreva o motivo" aria-label="Motivo" />
      )}
      {error && <div className="alert alert-error"><Icon name="alert" /><span>{error}</span></div>}
      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancelar</button>
        <button className="btn btn-primary" disabled={busy}>{busy ? "Salvando…" : "Salvar ajuste"}</button>
      </div>
    </form>
  );
}
