"use client";

// Barra dos 6 passos do fechamento (só visual; o estado vem de passos.ts).
import { ROTULOS_PASSOS, type EstadoPasso } from "./passos";

export default function PassosFechamento({ estados }: { estados: EstadoPasso[] }) {
  return (
    <ol className="stx-apx-passos" aria-label="Passos do fechamento">
      <style>{`
        .stx-apx-passos{display:flex;gap:6px;list-style:none;margin:14px 0 0;padding:0;flex-wrap:wrap}
        .stx-apx-passos li{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-3);padding:5px 9px;border-radius:999px;border:1px solid var(--border,rgba(128,128,128,.3))}
        .stx-apx-passos li b{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;font-size:11px;background:rgba(128,128,128,.25);color:var(--text)}
        .stx-apx-passos li.ativo{color:var(--text);border-color:var(--accent);font-weight:600}.stx-apx-passos li.ativo b{background:var(--accent);color:var(--on-accent)}
        .stx-apx-passos li.feito{color:var(--accent)}.stx-apx-passos li.feito b{background:var(--accent);color:var(--on-accent)}
      `}</style>
      {ROTULOS_PASSOS.map((r, i) => <li key={r} className={estados[i]} aria-current={estados[i] === "ativo" ? "step" : undefined}><b>{estados[i] === "feito" ? "✓" : i + 1}</b>{r}</li>)}
    </ol>
  );
}
