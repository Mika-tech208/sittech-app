// Processador server-side da Escala de Produção. O navegador chama este
// endpoint DEPOIS que uma ação relevante já foi concluída no banco
// (ausência criada/editada/removida, recurso bloqueado/liberado, alteração
// na Previsão) — mesmo padrão fire-and-forget de /api/push/notify-ocorrencia.
//
// O endpoint não recebe NENHUM dado de negócio: só drena a fila de eventos
// (escala_producao_eventos) e recalcula, no servidor, a partir do estado
// real do banco. Qualquer usuário ATIVO pode acioná-lo (quem registra uma
// ausência, por exemplo, não tem permissão da Escala) — é idempotente e
// não aceita parâmetros, então acionar a mais não muda resultado nenhum.
// Se esta chamada falhar, o evento continua pendente e é retomado na
// próxima chamada ou na próxima execução do worker /api/escala/drenar
// (retry simples, até 3 tentativas no banco). Esta chamada serve só para
// baixa latência — a garantia de processamento vem do worker.

import { NextResponse } from "next/server";
import { criarClienteAdmin } from "@/lib/supabase-admin";
import { autenticarRequisicaoIntelligence } from "@/features/intelligence/auth";
import { processarEventosPendentes } from "@/lib/escala/supabaseIO";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await autenticarRequisicaoIntelligence(request);
  if (!auth) return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });

  try {
    const resumo = await processarEventosPendentes(criarClienteAdmin(), Date.now());
    return NextResponse.json({ ok: true, ...resumo });
  } catch (e) {
    console.error("escala/processar:", e instanceof Error ? e.message : e);
    return NextResponse.json({ erro: "Falha ao processar a Escala." }, { status: 500 });
  }
}
