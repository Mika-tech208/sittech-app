"use client";

// Fluxo de "Ativar/Desativar notificações" — Web Push padrão (sem
// Firebase, sem serviço externo). Nada aqui roda automaticamente: só é
// chamado a partir de um clique explícito do usuário (ver AccountModal),
// nunca no carregamento da página. Registra o service worker só na hora
// de ativar (public/sw.js — só push/notificationclick, sem cache).

import { supabase } from "@/services/supabase-client";

export function suportaPush(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function permissaoAtual(): NotificationPermission | "indisponivel" {
  if (typeof window === "undefined" || !("Notification" in window)) return "indisponivel";
  return Notification.permission;
}

function urlBase64ParaUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Normalizado = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64Normalizado);
  const outputArray = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) outputArray[i] = raw.charCodeAt(i);
  return outputArray;
}

// Existe uma subscription ativa NESTE navegador/dispositivo (independente
// de estar salva no banco) — usado pra decidir o estado inicial do toggle.
export async function subscriptionLocalExiste(): Promise<boolean> {
  if (!suportaPush()) return false;
  const registro = await navigator.serviceWorker.getRegistration();
  if (!registro) return false;
  const sub = await registro.pushManager.getSubscription();
  return !!sub;
}

// Passo único: pede permissão (só se ainda não decidida), registra o SW,
// cria a subscription no navegador e salva no Supabase (RLS: só a própria
// linha do usuário). Lança erro com mensagem amigável em qualquer etapa —
// quem chama decide como exibir.
export async function ativarNotificacoes(usuarioId: string): Promise<void> {
  if (!suportaPush()) {
    throw new Error("Este navegador não suporta notificações push.");
  }

  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidPublicKey) {
    throw new Error("Notificações push não estão configuradas neste ambiente.");
  }

  if (Notification.permission === "denied") {
    throw new Error("Permissão de notificação foi negada. Ative manualmente nas configurações do navegador/dispositivo.");
  }

  if (Notification.permission !== "granted") {
    const resposta = await Notification.requestPermission();
    if (resposta !== "granted") {
      throw new Error("Permissão de notificação não concedida.");
    }
  }

  const registro = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;

  let subscription = await registro.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registro.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ParaUint8Array(vapidPublicKey) as BufferSource,
    });
  }

  const chaves = subscription.toJSON().keys;
  if (!chaves?.p256dh || !chaves?.auth) {
    throw new Error("Não foi possível obter as chaves da subscription.");
  }

  // DIAGNÓSTICO TEMPORÁRIO (remover depois de confirmar a causa do
  // VapidPkHashMismatch) — grava no próprio user_agent um fingerprint da
  // vapidPublicKey que ESTE navegador realmente usou no subscribe(),
  // pra comparar com o valor atual do servidor sem precisar de acesso
  // remoto ao Safari do iPhone.
  const fingerprintChave = `${vapidPublicKey.slice(0, 10)}...${vapidPublicKey.slice(-10)}`;

  // upsert por endpoint (unique global) — se este MESMO navegador já tinha
  // uma linha, só renova; se o endpoint hoje pertence a outro usuário, a
  // policy de update (usuario_id = self) bloqueia sob RLS e o erro sobe
  // pra quem chamou (ver migration push_subscriptions, comentário da
  // policy de update).
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      usuario_id: usuarioId,
      endpoint: subscription.endpoint,
      p256dh: chaves.p256dh,
      auth: chaves.auth,
      user_agent: `${navigator.userAgent} | vapid:${fingerprintChave}`,
    },
    { onConflict: "endpoint" }
  );

  if (error) {
    throw new Error("Não foi possível salvar a inscrição de notificações. Tente novamente.");
  }
}

// Remove a subscription tanto do navegador quanto do banco (só a própria
// linha — RLS). Não falha se já não existir nenhuma das duas.
export async function desativarNotificacoes(): Promise<void> {
  if (!suportaPush()) return;

  const registro = await navigator.serviceWorker.getRegistration();
  const subscription = await registro?.pushManager.getSubscription();

  if (subscription) {
    await supabase.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint);
    await subscription.unsubscribe();
  }
}
