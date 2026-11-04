// Selo da programação (ESCALA CONFIRMADA / AGUARDANDO FECHAMENTO) para as telas. GET /api/escala/fechamento/selo
import { NextResponse } from "next/server";
import { criarClienteAdmin } from "@/lib/supabase-admin";
import { autenticarRequisicaoIntelligence } from "@/features/intelligence/auth";
import { acaoSelo } from "@/lib/escala/fechamento/http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await autenticarRequisicaoIntelligence(request);
  if (!auth) return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  const r = await acaoSelo(criarClienteAdmin(), auth.usuario);
  return NextResponse.json(r.corpo, { status: r.status });
}
