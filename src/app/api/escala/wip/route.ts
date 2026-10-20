// Estoque intermediário (WIP) — consulta e ações (confirmar, ajustar, criar/ativar controle).
// GET  ?semana=AAAA-MM-DD  -> resumo por produto/etapa (estimado, confirmado, status, inconsistências). Exige ver a Previsão/Escala.
// POST { acao, ... }        -> só administrador ou usuário com `escala_wip_confirmar`. O servidor recalcula o estimado e grava com auditoria.
// O navegador NUNCA escreve nas tabelas wip_*: só o servidor (service_role), depois de checar a permissão.

import { NextResponse } from "next/server";
import { criarClienteAdmin } from "@/lib/supabase-admin";
import { autenticarRequisicaoIntelligence } from "@/features/intelligence/auth";
import { dataNoFusoSP, inicioDaSemana } from "@/features/escala/wipSaldo";
import { criarWipDb } from "@/lib/escala/wipIO";
import { ajustarWip, ativarControleWip, confirmarWip, criarControleWip, verWip, WipErro } from "@/lib/escala/wipServico";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function resposta(e: unknown) {
  if (e instanceof WipErro) return NextResponse.json({ erro: e.message, codigo: e.codigo }, { status: e.codigo === "NAO_AUTORIZADO" ? 403 : e.codigo === "NAO_ENCONTRADO" ? 404 : 400 });
  // erro de regra vindo do banco (RPC): "wip_x: WIP_MOTIVO_OBRIGATORIO: texto" => 400 com o texto
  const m = e instanceof Error ? /WIP_[A-Z_]+: ([^]*)$/.exec(e.message) : null;
  if (m) return NextResponse.json({ erro: m[1].split("\n")[0] }, { status: 400 });
  console.error("escala/wip:", e instanceof Error ? e.message : e);
  return NextResponse.json({ erro: "Falha ao processar o estoque intermediário." }, { status: 500 });
}

export async function GET(request: Request) {
  const auth = await autenticarRequisicaoIntelligence(request);
  if (!auth) return NextResponse.json({ erro: "Não autorizado." }, { status: 403 });
  const hoje = dataNoFusoSP(Date.now());
  const url = new URL(request.url);
  const semana = url.searchParams.get("semana") ?? inicioDaSemana(hoje);
  if (!ISO.test(semana)) return NextResponse.json({ erro: "semana inválida." }, { status: 400 });
  try {
    const admin = criarClienteAdmin();
    const { data: modo } = await admin.rpc("escala_wip_modo");
    const r = await verWip(criarWipDb(admin), auth.usuario, semana, hoje);
    return NextResponse.json({ ok: true, modoWip: modo === "ativo", hoje, semana, ...r });
  } catch (e) {
    return resposta(e);
  }
}

export async function POST(request: Request) {
  const auth = await autenticarRequisicaoIntelligence(request);
  if (!auth) return NextResponse.json({ erro: "Não autorizado." }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body.acao !== "string") return NextResponse.json({ erro: "Corpo inválido." }, { status: 400 });
  const hoje = dataNoFusoSP(Date.now());
  const semanaInicio = typeof body.semana === "string" && ISO.test(body.semana) ? body.semana : inicioDaSemana(hoje);
  const num = (v: unknown) => (typeof v === "number" ? v : Number(v));
  try {
    const db = criarWipDb(criarClienteAdmin());
    switch (body.acao) {
      case "confirmar":
        return NextResponse.json({ ok: true, ...(await confirmarWip(db, auth.usuario, { controleId: String(body.controle_id), quantidade: num(body.quantidade), motivo: body.motivo ?? null, dataReferencia: typeof body.data_referencia === "string" ? body.data_referencia : undefined, chave: typeof body.chave === "string" ? body.chave : null, semanaInicio }, hoje)) });
      case "ajustar":
        return NextResponse.json({ ok: true, ...(await ajustarWip(db, auth.usuario, { controleId: String(body.controle_id), quantidade: num(body.quantidade), motivo: String(body.motivo ?? ""), data: typeof body.data === "string" ? body.data : undefined, chave: typeof body.chave === "string" ? body.chave : null, semanaInicio }, hoje)) });
      case "criar_controle":
        return NextResponse.json({ ok: true, ...(await criarControleWip(db, auth.usuario, { produtoId: String(body.produto_id), etapaOrigemId: String(body.etapa_origem_id), etapaSeguinteId: String(body.etapa_seguinte_id), dataInicio: String(body.data_inicio ?? hoje), saldoInicial: num(body.saldo_inicial ?? 0) })) });
      case "ativar_controle":
        await ativarControleWip(db, auth.usuario, { controleId: String(body.controle_id), ativo: body.ativo !== false });
        return NextResponse.json({ ok: true });
      default:
        return NextResponse.json({ erro: "Ação desconhecida." }, { status: 400 });
    }
  } catch (e) {
    return resposta(e);
  }
}
