// Apontamento simplificado no fechamento do período — GET (estado: postos programados + catálogos + o que já foi lançado) e POST (grava as linhas numa transação).
// Exige a permissão `escala_fechamento` e a flag `apontamento_simplificado_modo` = ativo. Toda a regra está em src/lib/escala/fechamento e src/features/producao-real/apontamento-simplificado.
import { NextResponse } from "next/server";
import { criarClienteAdmin } from "@/lib/supabase-admin";
import { autenticarRequisicaoIntelligence } from "@/features/intelligence/auth";
import { criarApontamentosIO } from "@/lib/escala/fechamento/apontamentoSimplificado";
import { acaoApontamentosEstado, acaoApontamentosSalvar } from "@/lib/escala/fechamento/httpApontamentos";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const auth = await autenticarRequisicaoIntelligence(request);
  if (!auth) return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  const url = new URL(request.url);
  const r = await acaoApontamentosEstado(criarApontamentosIO(criarClienteAdmin(), auth.supabaseAsUser), auth.usuario, url.searchParams.get("data") ?? "", url.searchParams.get("periodo_id") ?? "");
  return NextResponse.json(r.corpo, { status: r.status });
}

export async function POST(request: Request) {
  const auth = await autenticarRequisicaoIntelligence(request);
  if (!auth) return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const r = await acaoApontamentosSalvar(criarApontamentosIO(criarClienteAdmin(), auth.supabaseAsUser), auth.usuario, body);
  return NextResponse.json(r.corpo, { status: r.status });
}
