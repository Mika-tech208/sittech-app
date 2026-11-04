"use client";

// Liberação da programação para a TV: lê /api/escala/fechamento/selo (liberação por período de hoje) e guarda o ÚLTIMO estado conhecido.
// Fail-safe: se a API falhar, vale o último estado conhecido (o status só evolui de "aguardando" para "liberado"); sem nenhum estado conhecido, nada é escondido.
import { useEffect, useState } from "react";
import { supabase } from "@/services/supabase-client";
import type { Selo, StatusLiberacao } from "./selo";

export interface LiberacaoTv { modo: "desligado" | "sombra" | "ativo"; selo: Selo | null; liberacao: Record<string, StatusLiberacao> }

export async function buscarLiberacao(): Promise<LiberacaoTv | null> {
  const token = await Promise.race([
    supabase.auth.getSession().then(({ data }) => data.session?.access_token).catch(() => undefined),
    new Promise<undefined>((r) => setTimeout(() => r(undefined), 3000)),
  ]);
  const resp = await fetch("/api/escala/fechamento/selo", { headers: { Authorization: `Bearer ${token ?? ""}` }, cache: "no-store" });
  if (!resp.ok) return null;
  const c = (await resp.json()) as Partial<LiberacaoTv>;
  return { modo: c.modo ?? "desligado", selo: c.selo ?? null, liberacao: c.liberacao ?? {} };
}

export function useLiberacaoTv(ligado: boolean, intervaloMs = 8_000): LiberacaoTv | null {
  const [estado, setEstado] = useState<LiberacaoTv | null>(null);
  useEffect(() => {
    if (!ligado) return;
    let vivo = true;
    const ler = () => { void buscarLiberacao().then((r) => { if (vivo && r) setEstado(r); }).catch(() => undefined); };
    ler();
    const t = setInterval(ler, intervaloMs);
    return () => { vivo = false; clearInterval(t); };
  }, [ligado, intervaloMs]);
  return estado;
}
