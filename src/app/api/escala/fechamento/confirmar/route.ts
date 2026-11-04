// Fechamento físico atômico — POST /api/escala/fechamento/confirmar. Exige a permissão `escala_fechamento`. Toda a regra está em src/lib/escala/fechamento.
import { NextResponse } from "next/server";
import { criarClienteAdmin } from "@/lib/supabase-admin";
import { autenticarRequisicaoIntelligence } from "@/features/intelligence/auth";
import { programacaoDoPeriodo, acaoConfirmar, ioDoUsuario } from "@/lib/escala/fechamento/http";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const auth = await autenticarRequisicaoIntelligence(request);
  if (!auth) return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const admin = criarClienteAdmin();
  const r = await acaoConfirmar(ioDoUsuario(admin, auth.usuario), auth.usuario, body);
  const prox = r.corpo.proximo as { data: string; periodoId: string } | null | undefined;
  const programacao = r.corpo.estado === "CONFIRMADO" && prox ? await programacaoDoPeriodo(admin, prox.data, prox.periodoId).catch(() => []) : undefined;
  return NextResponse.json(programacao ? { ...r.corpo, programacao } : r.corpo, { status: r.status });
}
