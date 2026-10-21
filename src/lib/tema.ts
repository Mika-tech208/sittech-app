// TEMA GLOBAL (claro/escuro) — fonte única de verdade, sem React: um store pequeno com persistência em localStorage.
// Antes, cada página guardava um estado local de tema iniciado em escuro; ao trocar de rota o estado era recriado e o tema voltava para escuro.
// Agora a preferência vive aqui (módulo único), é gravada em `sittech-theme` e lida de novo a cada carga do app.

export type Tema = "dark" | "light";
export const CHAVE_TEMA = "sittech-theme";
export const TEMA_PADRAO: Tema = "dark"; // padrão atual do sistema quando não há preferência salva

export interface ArmazenamentoMinimo { getItem(chave: string): string | null; setItem(chave: string, valor: string): void }

export const temaValido = (v: unknown): v is Tema => v === "light" || v === "dark";

// valor salvo (ou o padrão se ausente/inválido/armazenamento indisponível)
export function lerTemaSalvo(armazenamento: ArmazenamentoMinimo | null): Tema {
  try {
    const v = armazenamento?.getItem(CHAVE_TEMA);
    return temaValido(v) ? v : TEMA_PADRAO;
  } catch {
    return TEMA_PADRAO;
  }
}

export interface StoreTema {
  obter(): Tema;
  definir(proximo: Tema | ((atual: Tema) => Tema)): void;
  assinar(ouvinte: () => void): () => void;
  /** relê o armazenamento (ex.: evento `storage` de outra aba) */
  sincronizar(): void;
}

export function criarStoreTema(armazenamento: ArmazenamentoMinimo | null): StoreTema {
  let atual: Tema = lerTemaSalvo(armazenamento);
  const ouvintes = new Set<() => void>();
  const avisar = () => ouvintes.forEach((o) => o());
  return {
    obter: () => atual,
    definir(proximo) {
      const novo = typeof proximo === "function" ? proximo(atual) : proximo;
      if (!temaValido(novo)) return;
      try { armazenamento?.setItem(CHAVE_TEMA, novo); } catch { /* sem armazenamento: vale só nesta sessão */ }
      if (novo === atual) return;
      atual = novo;
      avisar();
    },
    assinar(ouvinte) {
      ouvintes.add(ouvinte);
      return () => { ouvintes.delete(ouvinte); };
    },
    sincronizar() {
      const lido = lerTemaSalvo(armazenamento);
      if (lido !== atual) { atual = lido; avisar(); }
    },
  };
}

// Script que roda ANTES da hidratação (inline no <head> do layout raiz): aplica a preferência salva em <html data-tema> para o CSS
// esconder o conteúdo "escuro" do HTML do servidor até o React aplicar o tema certo (sem piscar o tema errado).
export const SCRIPT_TEMA_INICIAL = `try{var t=localStorage.getItem(${JSON.stringify(CHAVE_TEMA)});if(t==="light"||t==="dark")document.documentElement.setAttribute("data-tema",t)}catch(e){}`;
