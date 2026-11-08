import Icon from "./Icon";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ",", "0", "back"];

/** Teclado numérico grande para uso no tablet da cozinha. */
export default function QuantityPad({ value, onChange }) {
  function press(k) {
    if (k === "back") return onChange(value.slice(0, -1));
    if (k === ",") {
      if (value.includes(",")) return;
      return onChange((value || "0") + ",");
    }
    const [, dec] = value.split(",");
    if (dec !== undefined && dec.length >= 3) return;
    if (value === "0") return onChange(k);
    if (value.replace(",", "").length >= 9) return;
    onChange(value + k);
  }
  return (
    <div className="pad" role="group" aria-label="Teclado numérico">
      {KEYS.map((k) => (
        <button
          key={k}
          type="button"
          className={`pad-key ${k === "back" ? "pad-back" : ""}`}
          onClick={() => press(k)}
          aria-label={k === "back" ? "Apagar" : k}
        >
          {k === "back" ? <Icon name="back" size={26} /> : k}
        </button>
      ))}
    </div>
  );
}
