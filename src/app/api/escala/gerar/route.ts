// Geração manual / regeração da Escala de uma semana. Exige a permissão
// `escala_producao`. Regenera a partir do primeiro período ainda não
// iniciado (o em andamento e os concluídos ficam congelados).

import { NextResponse } from "next/server";
import { criarClienteAdmin } from "@/lib/supabase-admin";
import { autenticarRequisicaoIntelligence } from "@/features/intelligence/auth";
import { temPermissao } from "@/lib/permissoes";
import { gerarEscalaDaSemana } from "@/lib/escala/supabaseIO";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await autenticarRequisicaoIntelligence(request);
  if (!auth || !temPermissao(auth.usuario, "escala_producao")) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const semana = typeof body?.semana_inicio === "string" ? body.semana_inicio : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(semana)) {
    return NextResponse.json({ erro: "semana_inicio inválida." }, { status: 400 });
  }

  try {
    const resultado = await gerarEscalaDaSemana(criarClienteAdmin(), semana, auth.usuario.id, Date.now());
    return NextResponse.json({ ok: true, ...resultado });
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : "Falha ao gerar a Escala.";
    console.error("escala/gerar:", mensagem);
    return NextResponse.json({ erro: mensagem }, { status: 500 });
  }
}
