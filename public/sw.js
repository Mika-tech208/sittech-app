// Service worker do Sittech — SOMENTE Web Push. Nenhum cache, nenhum
// precache, nenhum handler de `fetch`/`install` de asset, nenhuma lógica
// offline. Não altera o comportamento atual do PWA (standalone/manifest já
// configurados em src/app/manifest.ts e src/app/layout.tsx) — só adiciona
// a capacidade de receber notificação push e reagir ao clique nela.
// Registrado manualmente pelo cliente (src/lib/push/browserPush.ts), nunca
// automaticamente — só quando o usuário clica em "Ativar notificações".

self.addEventListener("install", () => {
  // Ativa a nova versão imediatamente, sem esperar todas as abas fecharem
  // (não há nada pra "migrar" de uma versão anterior — sem cache aqui).
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let dados = {};
  try {
    dados = event.data ? event.data.json() : {};
  } catch {
    dados = {};
  }

  const titulo = dados.title || "Sittech";
  const opcoes = {
    body: dados.body || "",
    icon: "/sittech-icon-192.png",
    badge: "/sittech-icon-192.png",
    tag: dados.tag,
    data: { url: dados.url || "/producao-real/paradas" },
  };

  event.waitUntil(self.registration.showNotification(titulo, opcoes));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/producao-real/paradas";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((listaClientes) => {
      for (const cliente of listaClientes) {
        if ("focus" in cliente) {
          if ("navigate" in cliente) {
            try {
              cliente.navigate(url);
            } catch {
              // navigate pode falhar em alguns navegadores — foca mesmo
              // assim, é melhor que não fazer nada.
            }
          }
          return cliente.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
