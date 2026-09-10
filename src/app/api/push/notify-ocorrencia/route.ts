// Route Handler — chamado pelo navegador logo depois que
// abrir_ocorrencia_maquina retorna sucesso (ver AbrirOcorrenciaModal.tsx),
// fire-and-forget: a ocorrência já foi salva antes disso, e nada aqui pode
// fazer essa abertura falhar ou ser revertida — só efeito colateral.
//
// V1 simplificada (sem trigger de banco/pg_net/Vault) — autenticado pela
// sessão normal do usuário (Bearer token do Supabase Auth), igual toda
// outra rota autenticada do app. Exige usuário ativo com a permissão
// 'producao_real_ocorrencias' (a mesma que já governa quem pode abrir
// ocorrência) — nunca aceita chamada anônima/pública.
//
// Recebe só `{ ocorrencia_id }` — todo o resto (máquina, motivo, descrição)
// é buscado aqui dentro com o cliente service_role, nunca confiado do
// payload recebido. Isso fecha a possibilidade de alguém autenticado mas
// sem a ocorrência real mandar notificação com conteúdo arbitrário.
//
// Push é efeito colateral: uma requisição autorizada sempre responde 200,
// mesmo com falhas parciais/totais de ENVIO — cada falha já fica
// registrada por subscription em push_notificacoes_ocorrencia
// (status/ultimo_erro), então "200 com falhas" não é "silenciar erro", é
// "o estado individual está no banco, não precisa virar erro HTTP".
//
// runtime nodejs (não edge): a lib `web-push` usa `crypto` do Node.

import { NextResponse } from "next/server";
import webpush from "web-push";
import { criarClienteAdmin } from "@/lib/supabase-admin";
import { autenticarRequisicaoIntelligence } from "@/features/intelligence/auth";
import { temPermissao } from "@/lib/permissoes";

export const runtime = "nodejs";

// Uma tentativa é considerada "presa" (worker anterior morreu sem concluir)
// depois desse tempo — só então pode ser reivindicada de novo. Gera folga
// suficiente pra qualquer chamada real de sendNotification (que tem seu
// próprio timeout de rede bem menor que isso).
const PROCESSANDO_STALE_MS = 5 * 60 * 1000;

interface OcorrenciaRow {
  id: string;
  descricao: string;
  aberta_em: string;
  maquinas: { nome: string } | { nome: string }[] | null;
  motivos_parada: { nome: string } | { nome: string }[] | null;
}

function primeiro<T>(v: T | T[] | null): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

export async function POST(request: Request) {
  // Reaproveita o mesmo auth de src/features/intelligence/auth.ts (valida
  // o Bearer token, resolve usuarios.ativo e as permissões concedidas) —
  // é genérico o bastante, evita duplicar a lógica de "usuário
  // autenticado e ativo" numa terceira versão.
  const auth = await autenticarRequisicaoIntelligence(request);
  if (!auth || !temPermissao(auth.usuario, "producao_real_ocorrencias")) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const ocorrenciaId = typeof body?.ocorrencia_id === "string" ? body.ocorrencia_id : "";
  if (!ocorrenciaId) {
    return NextResponse.json({ erro: "ocorrencia_id ausente." }, { status: 400 });
  }

  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.PUSH_VAPID_SUBJECT;
  if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    console.error("push/notify-ocorrencia: VAPID não configurado — abortando envio (ocorrência já existe normalmente).");
    return NextResponse.json({ erro: "Push não configurado." }, { status: 200 });
  }
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

  const admin = criarClienteAdmin();

  const { data: ocorrencia, error: erroOcorrencia } = await admin
    .from("ocorrencias_maquina")
    .select("id, descricao, aberta_em, maquinas(nome), motivos_parada(nome)")
    .eq("id", ocorrenciaId)
    .maybeSingle<OcorrenciaRow>();

  if (erroOcorrencia || !ocorrencia) {
    console.error("push/notify-ocorrencia: ocorrência não encontrada", ocorrenciaId, erroOcorrencia?.message);
    return NextResponse.json({ erro: "Ocorrência não encontrada." }, { status: 200 });
  }

  const maquinaNome = primeiro(ocorrencia.maquinas)?.nome || "Máquina";
  const motivoNome = primeiro(ocorrencia.motivos_parada)?.nome || "Parada";
  const descricao = ocorrencia.descricao?.trim();

  const titulo = `${maquinaNome} parou`;
  const corpo = descricao ? `${motivoNome} — ${descricao}` : motivoNome;
  const payload = JSON.stringify({
    title: titulo,
    body: corpo,
    url: "/producao-real/paradas",
    tag: `ocorrencia-${ocorrenciaId}`,
  });

  const { data: subscriptions, error: erroSubs } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth");

  if (erroSubs) {
    console.error("push/notify-ocorrencia: falha ao listar subscriptions", erroSubs.message);
    return NextResponse.json({ erro: "Falha ao listar subscriptions." }, { status: 200 });
  }
  if (!subscriptions || subscriptions.length === 0) {
    return NextResponse.json({ ocorrencia_id: ocorrenciaId, enviados: 0, ja_processados: 0, falhas: 0 }, { status: 200 });
  }

  let enviados = 0;
  let jaProcessados = 0;
  let falhas = 0;

  for (const sub of subscriptions) {
    // Reivindicação atômica: só prossegue se não houver linha ainda, ou se
    // a linha existente estiver 'falha_transitoria' (retry legítimo), ou
    // 'processando' há tempo demais (worker anterior morreu no meio).
    // 'enviado' e 'processando' recentes nunca são reivindicados de novo —
    // é isso que garante no máximo 1 envio de sucesso por par. A MESMA
    // função decide isso tanto na 1ª tentativa quanto num reprocessamento
    // manual futuro — nunca duas fontes de verdade pra "já foi enviado?".
    const staleAntes = new Date(Date.now() - PROCESSANDO_STALE_MS).toISOString();
    const { data: reivindicada } = await admin.rpc("reivindicar_notificacao_ocorrencia", {
      p_ocorrencia_id: ocorrenciaId,
      p_subscription_id: sub.id,
      p_processando_stale_antes: staleAntes,
    });

    if (!reivindicada) {
      jaProcessados++;
      continue;
    }

    const resultado = await enviarComUmRetry(sub, payload);

    if (resultado.status === "enviado") {
      await admin
        .from("push_notificacoes_ocorrencia")
        .update({ status: "enviado", atualizado_em: new Date().toISOString() })
        .eq("ocorrencia_id", ocorrenciaId)
        .eq("subscription_id", sub.id);
      await admin.from("push_subscriptions").update({ ultimo_uso_em: new Date().toISOString() }).eq("id", sub.id);
      enviados++;
      continue;
    }

    falhas++;
    if (resultado.status === "subscription_invalida") {
      // Provider confirmou (404/410) que a subscription não existe mais —
      // terminal, sem retry. Remove daqui também (cascata apaga a linha de
      // idempotência junto).
      await admin
        .from("push_notificacoes_ocorrencia")
        .update({ status: "subscription_invalida", ultimo_erro: resultado.mensagem, atualizado_em: new Date().toISOString() })
        .eq("ocorrencia_id", ocorrenciaId)
        .eq("subscription_id", sub.id);
      await admin.from("push_subscriptions").delete().eq("id", sub.id);
    } else {
      // Falhou nas 2 tentativas (imediata + 1 retry) por erro não-terminal
      // (rede/5xx/timeout). V1: falha_transitoria não tem retry automático
      // posterior — só reprocessamento manual do mesmo endpoint mais tarde
      // (a reivindicação atômica acima permite isso com segurança).
      await admin
        .from("push_notificacoes_ocorrencia")
        .update({ status: "falha_transitoria", ultimo_erro: resultado.mensagem, atualizado_em: new Date().toISOString() })
        .eq("ocorrencia_id", ocorrenciaId)
        .eq("subscription_id", sub.id);
    }
    console.error("push/notify-ocorrencia: falha ao enviar para subscription", sub.id, resultado.status, resultado.mensagem);
  }

  return NextResponse.json({ ocorrencia_id: ocorrenciaId, enviados, ja_processados: jaProcessados, falhas }, { status: 200 });
}

interface SubscriptionAlvo {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

type ResultadoEnvio =
  | { status: "enviado" }
  | { status: "subscription_invalida"; mensagem: string }
  | { status: "falha_transitoria"; mensagem: string };

const ATRASO_RETRY_MS = 1000;

async function tentarEnviar(sub: SubscriptionAlvo, payload: string): Promise<{ ok: true } | { ok: false; statusCode?: number; mensagem: string }> {
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { TTL: 300 });
    return { ok: true };
  } catch (err: unknown) {
    const statusCode = (err as { statusCode?: number })?.statusCode;
    const mensagem = err instanceof Error ? err.message : String(err);
    return { ok: false, statusCode, mensagem };
  }
}

// Tentativa normal + (se a falha não for definitiva) UMA tentativa extra
// depois de ~1s. 404/410 é terminal e nunca gera retry — o provider já
// confirmou que a subscription não existe mais. Qualquer outra falha
// (rede/5xx/timeout) tenta mais uma vez; se falhar de novo, vira
// falha_transitoria (sem mais retry dentro desta invocação).
async function enviarComUmRetry(sub: SubscriptionAlvo, payload: string): Promise<ResultadoEnvio> {
  const primeira = await tentarEnviar(sub, payload);
  if (primeira.ok) return { status: "enviado" };
  if (primeira.statusCode === 404 || primeira.statusCode === 410) {
    return { status: "subscription_invalida", mensagem: primeira.mensagem };
  }

  await new Promise((resolve) => setTimeout(resolve, ATRASO_RETRY_MS));

  const segunda = await tentarEnviar(sub, payload);
  if (segunda.ok) return { status: "enviado" };
  if (segunda.statusCode === 404 || segunda.statusCode === 410) {
    return { status: "subscription_invalida", mensagem: segunda.mensagem };
  }
  return { status: "falha_transitoria", mensagem: segunda.mensagem };
}
