"use client";

// Selo simples da programação: ESCALA CONFIRMADA (gerada do fechamento físico) · AGUARDANDO FECHAMENTO · RECALCULANDO · ERRO. Só aparece com a flag em `ativo`.
import { useEffect, useState } from "react";
import { supabase } from "@/services/supabase-client";
import type { Selo } from "./selo";

const COR: Record<Selo["codigo"], string> = {
  ESCALA_CONFIRMADA: "var(--accent)", ESCALA_CONFIRMADA_PARCIAL: "var(--warning)", AGUARDANDO_FECHAMENTO: "var(--warning)", RECALCULANDO: "var(--text-3)", ERRO_RECALCULO: "var(--danger, #e5484d)",
};

export async function buscarSelo(): Promise<Selo | null> {
  const token = await Promise.race([
    supabase.auth.getSession().then(({ data }) => data.session?.access_token).catch(() => undefined),
    new Promise<undefined>((r) => setTimeout(() => r(undefined), 3000)),
  ]);
  const resp = await fetch("/api/escala/fechamento/selo", { headers: { Authorization: `Bearer ${token ?? ""}` } });
  if (!resp.ok) return null;
  return ((await resp.json()) as { selo: Selo | null }).selo;
}

export default function SeloFechamento({ intervaloMs = 30_000, grande = false }: { intervaloMs?: number; grande?: boolean }) {
  const [selo, setSelo] = useState<Selo | null>(null);
  useEffect(() => {
    let vivo = true;
    const ler = () => { void buscarSelo().then((s) => { if (vivo) setSelo(s); }).catch(() => undefined); };
    ler();
    const t = setInterval(ler, intervaloMs);
    return () => { vivo = false; clearInterval(t); };
  }, [intervaloMs]);
  if (!selo) return null;
  const hora = selo.fechadoEmMs ? new Date(selo.fechadoEmMs).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }) : null;
  return (
    <span role="status" title={`Último período encerrado: ${selo.periodo.rotulo}${hora ? ` · fechado às ${hora}` : ""}`}
      style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: grande ? "8px 16px" : "4px 12px", borderRadius: 999, border: `1.5px solid ${COR[selo.codigo]}`, color: COR[selo.codigo], fontWeight: 700, fontSize: grande ? "1em" : 12.5, letterSpacing: ".04em", whiteSpace: "nowrap" }}>
      {selo.texto}{hora ? ` · ${selo.periodo.rotulo} ${hora}` : ` · após ${selo.periodo.rotulo}`}
    </span>
  );
}
