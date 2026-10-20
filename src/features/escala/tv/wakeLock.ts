// Screen Wake Lock (API OFICIAL) para a TV da produção não entrar em modo
// soneca. Camada ADICIONAL: não controla o hardware da Smart TV (Sleep /
// economia de energia / desligamento automático continuam precisando ser
// desativados na própria TV) e é totalmente independente de Realtime, polling
// e relógio da tela — qualquer falha aqui é silenciosa e a TV segue normal.
//
// Sem gambiarra: nada de mousemove/clique/teclado simulados nem timers para
// "fingir atividade". Só navigator.wakeLock.request('screen').
//
// Comportamento:
//  - API ausente  => estado "nao_suportado", nada quebra;
//  - ao abrir     => tenta adquirir; ao voltar a ficar visível (visibilitychange)
//                    ou ao recuperar foco => tenta de novo se não houver lock;
//  - lock liberado pelo navegador (ex.: aba oculta, bateria) => uma retentativa
//    com backoff exponencial (nunca em laço apertado), reiniciado a cada sucesso;
//  - nenhuma exceção escapa (request que rejeita ou lança, release que falha).

export type EstadoWakeLock = "ativo" | "inativo" | "nao_suportado" | "erro";

export interface SentinelWakeLockLike {
  released?: boolean;
  release(): Promise<void>;
  addEventListener(tipo: "release", fn: () => void): void;
  removeEventListener?(tipo: "release", fn: () => void): void;
}

export interface NavegadorWakeLockLike {
  wakeLock?: { request(tipo: "screen"): Promise<SentinelWakeLockLike> };
}

export interface AlvoEventosLike {
  addEventListener(tipo: string, fn: () => void): void;
  removeEventListener(tipo: string, fn: () => void): void;
}

export interface DocumentoLike extends AlvoEventosLike {
  visibilityState: string;
}

export interface OpcoesWakeLock {
  janela?: AlvoEventosLike; // recebe "focus"
  agendar?: (fn: () => void, ms: number) => () => void; // injetável (testes); retorna o cancelamento
  atrasoInicialMs?: number;
  atrasoMaximoMs?: number;
}

const ATRASO_INICIAL_MS = 5_000;
const ATRASO_MAXIMO_MS = 5 * 60_000;

function agendarPadrao(fn: () => void, ms: number): () => void {
  const id = setTimeout(fn, ms);
  return () => clearTimeout(id);
}

export function criarControladorWakeLock(
  nav: NavegadorWakeLockLike | undefined,
  doc: DocumentoLike | undefined,
  onEstado: (estado: EstadoWakeLock) => void,
  opcoes: OpcoesWakeLock = {}
) {
  const agendar = opcoes.agendar ?? agendarPadrao;
  const atrasoInicial = opcoes.atrasoInicialMs ?? ATRASO_INICIAL_MS;
  const atrasoMaximo = opcoes.atrasoMaximoMs ?? ATRASO_MAXIMO_MS;

  let rodando = false;
  let sentinel: SentinelWakeLockLike | null = null;
  let adquirindo = false;
  let atraso = atrasoInicial;
  let cancelarRetentativa: (() => void) | null = null;

  const emitir = (e: EstadoWakeLock) => {
    try {
      onEstado(e);
    } catch {
      /* o chamador nunca pode derrubar o controlador */
    }
  };

  const visivel = () => !doc || doc.visibilityState === "visible";

  function limparRetentativa() {
    if (cancelarRetentativa) {
      cancelarRetentativa();
      cancelarRetentativa = null;
    }
  }

  function agendarRetentativa() {
    if (!rodando || cancelarRetentativa) return;
    cancelarRetentativa = agendar(() => {
      cancelarRetentativa = null;
      void adquirir();
    }, atraso);
    atraso = Math.min(atraso * 2, atrasoMaximo); // backoff: sem laço agressivo
  }

  async function adquirir(): Promise<void> {
    if (!rodando || adquirindo) return;
    if (!visivel()) return; // oculto: o navegador não concede; reagimos em visibilitychange
    if (sentinel && sentinel.released !== true) return; // já ativo
    const api = nav?.wakeLock;
    if (!api) {
      emitir("nao_suportado");
      return;
    }
    adquirindo = true;
    try {
      const novo = await api.request("screen");
      if (!rodando) {
        // parado enquanto aguardava: devolve o lock
        void novo.release().catch(() => undefined);
        return;
      }
      sentinel = novo;
      atraso = atrasoInicial; // sucesso: zera o backoff
      limparRetentativa();
      novo.addEventListener("release", () => {
        if (sentinel === novo) sentinel = null;
        if (!rodando) return;
        emitir("inativo");
        if (visivel()) agendarRetentativa(); // o navegador soltou: tenta de novo, com calma
      });
      emitir("ativo");
    } catch {
      emitir("erro");
      agendarRetentativa();
    } finally {
      adquirindo = false;
    }
  }

  const aoMudarVisibilidade = () => {
    if (visivel()) {
      limparRetentativa();
      void adquirir();
    }
  };
  const aoFocar = () => {
    void adquirir();
  };

  return {
    iniciar() {
      if (rodando) return;
      rodando = true;
      if (!nav?.wakeLock) {
        emitir("nao_suportado");
        return; // sem API: nada a observar; a TV segue normal
      }
      try {
        doc?.addEventListener("visibilitychange", aoMudarVisibilidade);
        opcoes.janela?.addEventListener("focus", aoFocar);
      } catch {
        /* ambiente sem eventos: segue só com a aquisição inicial */
      }
      void adquirir();
    },
    parar() {
      rodando = false;
      limparRetentativa();
      try {
        doc?.removeEventListener("visibilitychange", aoMudarVisibilidade);
        opcoes.janela?.removeEventListener("focus", aoFocar);
      } catch {
        /* nada */
      }
      const atual = sentinel;
      sentinel = null;
      if (atual && atual.released !== true) {
        try {
          void atual.release().catch(() => undefined);
        } catch {
          /* nada */
        }
      }
    },
  };
}
