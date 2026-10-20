// "Tentar novamente" da tela Escala de Produção: devolve à fila os eventos
// que esgotaram as 3 tentativas e drena a outbox na hora. Exige a permissão
// `escala_producao`. Não aceita parâmetros; o recálculo é o mesmo processador
// de sempre (locks e versões inclusos).

import { NextResponse } from "next/server";
import { criarClienteAdmin } from "@/lib/supabase-admin";
import { autenticarRequisicaoIntelligence } from "@/features/intelligence/auth";
import { temPermissao } from "@/lib/permissoes";
import { drenarOutbox } from "@/lib/escala/supabaseIO";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const auth = await autenticarRequisicaoIntelligence(request);
  if (!auth || !temPermissao(auth.usuario, "escala_producao")) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 403 });
  }
  try {
    const admin = criarClienteAdmin();
    const { data, error } = await admin.rpc("escala_reativar_eventos_esgotados");
    if (error) throw new Error(error.message);
    const resumo = await drenarOutbox(admin, Date.now());
    return NextResponse.json({ ok: true, reativados: data ?? 0, ...resumo });
  } catch (e) {
    console.error("escala/reprocessar:", e instanceof Error ? e.message : e);
    return NextResponse.json({ erro: "Falha ao reprocessar a Escala." }, { status: 500 });
  }
}
