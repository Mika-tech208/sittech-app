// POST /api/escala/fechamento/reabrir — REABRIR PERÍODO (janela de correção de lançamentos). Exige `escala_fechamento`. Regra em src/lib/escala/fechamento/http.ts.
import { NextResponse } from "next/server";
import { criarClienteAdmin } from "@/lib/supabase-admin";
import { autenticarRequisicaoIntelligence } from "@/features/intelligence/auth";
import { acaoReabrir } from "@/lib/escala/fechamento/http";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  const auth = await autenticarRequisicaoIntelligence(request);
  if (!auth) return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const r = await acaoReabrir(criarClienteAdmin(), auth.usuario, body);
  return NextResponse.json(r.corpo, { status: r.status });
}
