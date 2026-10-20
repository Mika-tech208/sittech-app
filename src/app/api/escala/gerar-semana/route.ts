// Geração automática da Escala da semana (toda segunda 06:30, America/Sao_Paulo).
// Chamado pelo GitHub Actions (.github/workflows/escala-gerar-semana.yml) com
// `Authorization: Bearer $CRON_SECRET` — mesmo padrão de /api/escala/drenar.
// Sem o segredo configurado a rota se recusa a executar (fail closed).
//
// O horário do GitHub (UTC) NÃO é confiado: o servidor calcula "agora" em
// America/Sao_Paulo e só gera em segunda-feira. Idempotente: se a escala da
// semana já existe, responde sem alterar nada. Sem Previsão Semanal: NÃO
// inventa escala — registra um evento de erro (visível na tela Escala de
// Produção) e responde 422 para o workflow falhar e avisar.
//
// Fora de produção (VERCEL_ENV !== "production") aceita ?agora=AAAA-MM-DDTHH:MM
// (horário de São Paulo) apenas para validar em DEV/Preview. Em produção o
// parâmetro é ignorado.

import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { criarClienteAdmin } from "@/lib/supabase-admin";
import { epochMsNoFuso } from "@/features/escala/tempo";
import { gerarEscalaSemanalDoServidor } from "@/lib/escala/supabaseIO";
import type { TentativaGeracao } from "@/lib/escala/geracaoSemanal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function segredoValido(request: Request): boolean | null {
  const segredo = process.env.CRON_SECRET;
  if (!segredo || segredo.length < 16) return null;
  const recebido = Buffer.from(request.headers.get("authorization") ?? "");
  const esperado = Buffer.from(`Bearer ${segredo}`);
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
}

// Segunda-feira tem 3 execuções: 06:30 (principal) e 07:30/09:30 (recuperação). O workflow
// informa qual delas disparou (?tentativa=principal|recuperacao); o histórico diferencia
// "geração principal", "geração por recuperação" e "já existia". Valor inválido/ausente = principal.
function tentativaDaRequisicao(request: Request): TentativaGeracao {
  return new URL(request.url).searchParams.get("tentativa") === "recuperacao" ? "recuperacao" : "principal";
}

function agoraDaRequisicao(request: Request): number {
  if (process.env.VERCEL_ENV === "production") return Date.now();
  const v = new URL(request.url).searchParams.get("agora");
  const m = v?.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/);
  return m ? epochMsNoFuso(m[1], m[2]) : Date.now();
}

async function gerarSemana(request: Request) {
  const ok = segredoValido(request);
  if (ok === null) return NextResponse.json({ erro: "Worker não configurado." }, { status: 503 });
  if (!ok) return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });

  try {
    const r = await gerarEscalaSemanalDoServidor(criarClienteAdmin(), agoraDaRequisicao(request), { tentativa: tentativaDaRequisicao(request) });
    const falha = r.status === "sem_previsao" || r.status === "previsao_invalida";
    if (falha) console.error(`escala/gerar-semana: ${r.mensagem}`);
    else console.info(JSON.stringify({ evento: "escala/gerar-semana", status: r.status, tentativa: tentativaDaRequisicao(request), classificacao: "classificacao" in r ? r.classificacao : null }));
    return NextResponse.json({ ok: !falha, ...r }, { status: falha ? 422 : 200 });
  } catch (e) {
    console.error("escala/gerar-semana:", e instanceof Error ? e.message : e);
    return NextResponse.json({ erro: "Falha ao gerar a Escala da semana." }, { status: 500 });
  }
}

export const GET = gerarSemana;
export const POST = gerarSemana;
