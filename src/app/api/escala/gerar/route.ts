// Geração manual / regeração da Escala de uma semana. Exige a permissão
// `escala_producao`. Regenera a partir do primeiro período ainda não
// iniciado (o em andamento e os concluídos ficam congelados).

import { NextResponse } from "next/server";
import { criarClienteAdmin } from "@/lib/supabase-admin";
import { autenticarRequisicaoIntelligence } from "@/features/intelligence/auth";
import { temPermissao } from "@/lib/permissoes";
import { gerarEscalaDaSemana } from "@/lib/escala/supabaseIO";
import { MOTIVO_OPERACAO_MANUAL } from "@/lib/escala/modoManual";

export const runtime = "nodejs";
export const maxDuration = 60; // recálculo da semana (planejador de corte ~3–6 s + consultas); sem isto a rota herdaria o teto curto do plano

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
    // FECHAMENTO FÍSICO ATIVO: a programação dos períodos seguintes nasce do fechamento do período. A regeração manual por relógio, sem fechamento nem portão HARD, fica bloqueada
    // (a semana sem plano ainda pode ser criada).
    const admin = criarClienteAdmin();
    const modo = await admin.from("escala_parametros").select("valor").eq("chave", "escala_fechamento_fisico_modo").maybeSingle();
    if (modo.error) throw new Error(`escala_parametros: ${modo.error.message}`);
    if (modo.data?.valor === "ativo") {
      const fim = new Date(`${semana}T12:00:00Z`); fim.setUTCDate(fim.getUTCDate() + 6);
      const dias = await admin.from("escala_producao_dias").select("data", { count: "exact", head: true }).gte("data", semana).lte("data", fim.toISOString().slice(0, 10));
      if (dias.error) throw new Error(`escala_producao_dias: ${dias.error.message}`);
      if ((dias.count ?? 0) > 0) return NextResponse.json({ erro: "Com o Fechamento Físico ativo, a programação dos próximos períodos é gerada pelo fechamento do período (tablet). A regeração manual está bloqueada." }, { status: 409 });
    }
    const resultado = await gerarEscalaDaSemana(admin, semana, auth.usuario.id, Date.now());
    // MODO MANUAL: resposta explícita (nada de "ok" silencioso). Semana em PLANEJAMENTO do produto único continua gerável (plano futuro, nunca vai ao chão).
    if (resultado.status === "ignorado" && resultado.motivoIgnorado === MOTIVO_OPERACAO_MANUAL) {
      return NextResponse.json({ erro: `${MOTIVO_OPERACAO_MANUAL} Para gerar programação, a escala automática precisa ser religada por configuração.` }, { status: 409 });
    }
    return NextResponse.json({ ok: true, ...resultado });
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : "Falha ao gerar a Escala.";
    console.error("escala/gerar:", mensagem);
    return NextResponse.json({ erro: mensagem }, { status: 500 });
  }
}
