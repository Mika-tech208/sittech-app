// "Funcionários necessários para executar esta programação" — SOMENTE LEITURA (nada é gravado).
// Exige a permissão `previsao` (ou `escala_producao`). Usa o MESMO motor que gera a Escala (src/lib/escala/funcionariosNecessarios.ts),
// com equipe virtual: o número é da programação, não da equipe real.
//
// Corpo: { semana_inicio: "AAAA-MM-DD", itens?: [{ produto_id, quantidade?, valor_unitario?, maquinas_por_etapa? }] }
// `itens` (opcional) substitui os itens previstos salvos — o MESMO rascunho que a tela usa (a carga adicional é ignorada: só o previsto
// dimensiona a equipe). Sem Previsão salva para a semana: 404.

import { NextResponse } from "next/server";
import { criarClienteAdmin } from "@/lib/supabase-admin";
import { autenticarRequisicaoIntelligence } from "@/features/intelligence/auth";
import { temPermissao } from "@/lib/permissoes";
import { criarEscalaIO, resolverPrevisaoPorSemana } from "@/lib/escala/supabaseIO";
import { aplicarRascunhoItens, RascunhoInvalidoError } from "@/lib/escala/simularCobertura";
import { calcularFuncionariosNecessariosDaSemana } from "@/lib/escala/funcionariosNecessarios";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  const auth = await autenticarRequisicaoIntelligence(request);
  if (!auth || !(temPermissao(auth.usuario, "previsao") || temPermissao(auth.usuario, "escala_producao"))) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  const semana = typeof body?.semana_inicio === "string" ? body.semana_inicio : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(semana)) return NextResponse.json({ erro: "semana_inicio inválida." }, { status: 400 });

  try {
    const admin = criarClienteAdmin();
    const previsaoId = await resolverPrevisaoPorSemana(admin, semana);
    if (!previsaoId) return NextResponse.json({ erro: "Salve a Previsão desta semana para calcular os funcionários necessários." }, { status: 404 });

    const agoraMs = Date.now();
    const estadoBase = await criarEscalaIO(admin, previsaoId).carregarEstado(agoraMs);
    let estado = estadoBase;
    if (Array.isArray(body.itens)) {
      try {
        estado = aplicarRascunhoItens(estadoBase, body.itens);
      } catch (e) {
        if (e instanceof RascunhoInvalidoError) return NextResponse.json({ erro: e.message }, { status: 400 });
        throw e;
      }
    }
    return NextResponse.json({ ok: true, ...calcularFuncionariosNecessariosDaSemana(estado, agoraMs) });
  } catch (e) {
    console.error("escala/funcionarios-necessarios:", e instanceof Error ? e.message : e);
    return NextResponse.json({ erro: "Falha ao calcular os funcionários necessários." }, { status: 500 });
  }
}
