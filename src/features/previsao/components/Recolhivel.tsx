"use client";

// Bloco recolhível (accordion) da Previsão Semanal. Só apresentação: o conteúdo continua montado
// quando recolhido (estado, rascunhos e análises não se perdem) e fica inerte — fora do foco e da
// leitura de tela. Aberto/fechado é lembrado só durante a sessão do navegador (sessionStorage); sem
// banco. Começa recolhido.

import { useId, useSyncExternalStore, type ReactNode } from "react";

const ESTILOS = `
.stx-rec-cab { display:flex; align-items:center; gap:10px; width:100%; padding:0; margin:0; background:none; border:0; color:inherit; font:inherit; text-align:left; cursor:pointer; }
.stx-rec-cab:focus-visible { outline:2px solid var(--accent); outline-offset:4px; border-radius:6px; }
.stx-rec-txt { flex:1 1 auto; min-width:0; display:flex; align-items:baseline; gap:6px 10px; flex-wrap:wrap; }
.stx-rec-resumo { font-size:13px; color:var(--text-muted); }
.stx-rec-chevron { flex:0 0 auto; width:16px; height:16px; color:var(--text-muted); transition:transform .2s ease; }
.stx-rec-cab[aria-expanded="true"] .stx-rec-chevron { transform:rotate(180deg); }
.stx-rec-corpo { display:grid; grid-template-rows:0fr; visibility:hidden; transition:grid-template-rows .22s ease, visibility 0s linear .22s; }
.stx-rec-corpo[data-aberto="true"] { grid-template-rows:1fr; visibility:visible; transition:grid-template-rows .22s ease, visibility 0s; }
.stx-rec-interno { overflow:hidden; min-height:0; }
.stx-rec-miolo { padding-top:12px; }
@media (prefers-reduced-motion: reduce) {
  .stx-rec-chevron, .stx-rec-corpo, .stx-rec-corpo[data-aberto="true"] { transition:none; }
}
`;

const CHAVE = (id: string) => `stx-recolhivel:${id}`;

function lerSessao(id: string): boolean {
  try {
    return window.sessionStorage.getItem(CHAVE(id)) === "1";
  } catch {
    return false;
  }
}
// sessionStorage indisponível (modo privado/bloqueado): o bloco ainda abre e fecha, só não lembra;
// por isso o estado também fica em memória (mesma aba, até recarregar).
const emMemoria = new Map<string, boolean>();
const ouvintes = new Set<() => void>();
function gravarSessao(id: string, aberto: boolean) {
  emMemoria.set(id, aberto);
  try {
    window.sessionStorage.setItem(CHAVE(id), aberto ? "1" : "0");
  } catch {
    /* ver acima */
  }
  ouvintes.forEach((f) => f());
}
function assinar(f: () => void) {
  ouvintes.add(f);
  return () => {
    ouvintes.delete(f);
  };
}
function estadoAtual(id: string): boolean {
  return emMemoria.get(id) ?? lerSessao(id);
}

export interface RecolhivelProps {
  id: string; // chave estável para lembrar aberto/fechado na sessão
  titulo: string;
  resumo?: ReactNode; // informação principal, visível mesmo recolhido
  children: ReactNode;
}

export default function Recolhivel({ id, titulo, resumo, children }: RecolhivelProps) {
  // Recolhido no servidor e na 1ª hidratação; depois lê o que a sessão lembra.
  const aberto = useSyncExternalStore(assinar, () => estadoAtual(id), () => false);
  const corpoId = useId();

  function alternar() {
    gravarSessao(id, !estadoAtual(id));
  }

  return (
    <>
      <style>{ESTILOS}</style>
      <button type="button" className="stx-rec-cab" aria-expanded={aberto} aria-controls={corpoId} onClick={alternar}>
        <span className="stx-rec-txt">
          <span className="stx-panel-title">{titulo}</span>
          {resumo != null && <span className="stx-rec-resumo">{resumo}</span>}
        </span>
        <svg className="stx-rec-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3.5 6 8 10.5 12.5 6" />
        </svg>
      </button>
      <div id={corpoId} className="stx-rec-corpo" data-aberto={aberto} role="region" aria-label={titulo} inert={!aberto}>
        <div className="stx-rec-interno">
          <div className="stx-rec-miolo">{children}</div>
        </div>
      </div>
    </>
  );
}
