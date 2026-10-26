// Arquivo histórico dos relatórios (aba Relatórios) — SOMENTE LEITURA. Exige `escala_relatorios` (admin sempre). Lê escala_relatorios pela RPC (uma linha por família, versão mais recente);
// nunca gera nem altera PDF. Filtros: ano, tipo, status, q (código/semana), pagina.
import { NextResponse } from "next/server";
import { criarClienteAdmin } from "@/lib/supabase-admin";
import { autenticarRequisicaoIntelligence } from "@/features/intelligence/auth";
import { temPermissao } from "@/lib/permissoes";
import { listarArquivo } from "@/lib/escala-relatorio/servico";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const auth = await autenticarRequisicaoIntelligence(request);
  if (!auth || !temPermissao(auth.usuario, "escala_relatorios")) return NextResponse.json({ erro: "Não autorizado." }, { status: 403 });
  const q = new URL(request.url).searchParams;
  const ano = q.get("ano") ? Number(q.get("ano")) : null;
  const tipo = q.get("tipo"), status = q.get("status");
  if ((ano !== null && !Number.isInteger(ano)) || (tipo && tipo !== "executada" && tipo !== "planejada") || (status && status !== "parcial" && status !== "final")) return NextResponse.json({ erro: "Filtro inválido." }, { status: 400 });
  try {
    const dados = await listarArquivo(criarClienteAdmin(), auth.supabaseAsUser, { ano, tipo, status, busca: (q.get("q") ?? "").slice(0, 60), pagina: Number(q.get("pagina") ?? 1) || 1 });
    return NextResponse.json({ ok: true, ...dados });
  } catch (e) {
    console.error("escala/relatorios/arquivo:", e instanceof Error ? e.message : e);
    return NextResponse.json({ erro: "Falha ao consultar o arquivo de relatórios." }, { status: 500 });
  }
}
