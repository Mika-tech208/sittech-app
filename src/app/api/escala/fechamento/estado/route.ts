// Estado do fechamento de um período (polling da tela do tablet). GET /api/escala/fechamento/estado?data=YYYY-MM-DD&periodo_id=m2
import { NextResponse } from "next/server";
import { criarClienteAdmin } from "@/lib/supabase-admin";
import { autenticarRequisicaoIntelligence } from "@/features/intelligence/auth";
import { acaoEstado } from "@/lib/escala/fechamento/http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await autenticarRequisicaoIntelligence(request);
  if (!auth) return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  const url = new URL(request.url);
  const r = await acaoEstado(criarClienteAdmin(), auth.usuario, url.searchParams.get("data") ?? "", url.searchParams.get("periodo_id") ?? "");
  return NextResponse.json(r.corpo, { status: r.status });
}
