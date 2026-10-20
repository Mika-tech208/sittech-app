// Textos da ATINGIBILIDADE DO PREVISTO e da recomendação de máquina — funções PURAS (a tela só mostra).
// Cobertura da equipe ("estamos ocupando as pessoas?") e Atingibilidade do previsto ("conseguimos concluir a programação?")
// são perguntas diferentes: uma semana pode ter cobertura 100% e previsto impossível, e isso NÃO é contradição.

import type { AcaoRecomendada, AtingibilidadeProduto, CausaAtingibilidade, StatusAtingibilidade } from "@/features/escala/atingibilidade";
import type { RecomendacaoGlobal } from "@/features/escala/recomendacaoMaquina";

export const PERGUNTA_COBERTURA = "Estamos conseguindo ocupar as pessoas?";
export const PERGUNTA_ATINGIBILIDADE = "Com a capacidade e os gargalos atuais, conseguimos concluir a programação?";
export const NOTA_INDEPENDENTES =
  "São perguntas diferentes e independentes: a equipe pode estar 100% ocupada e, ainda assim, o previsto não fechar (as máquinas do gargalo não dão conta). Isso não é contradição.";

export const ROTULO_STATUS: Record<StatusAtingibilidade, string> = {
  atingivel: "Atingível",
  em_risco: "Em risco",
  impossivel: "Impossível com a capacidade atual",
};

export const TEXTO_CAUSA: Record<CausaAtingibilidade, string> = {
  sem_maquina: "A etapa não tem máquina selecionada.",
  capacidade_maquinas: "As máquinas selecionadas da etapa não produzem o necessário nos períodos restantes, mesmo rodando o tempo todo.",
  capacidade_conjunta: "As máquinas compartilhadas com outros produtos não dão conta do conjunto da programação.",
  equipe_insuficiente: "Não há pessoas-período suficientes para a programação inteira, mesmo no melhor ritmo.",
  maquina_livre_nao_priorizada: "A máquina ficou livre enquanto faltavam peças desta etapa — a equipe estava em outro produto.",
  recurso_compartilhado: "As máquinas da etapa estiveram ocupadas por outros produtos.",
  folga_curta: "Fecha, mas com folga menor que a margem: qualquer parada no gargalo faz faltar peças.",
};

const fmt = (v: number, casas = 0) => v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

export function faltaDoProduto(p: Pick<AtingibilidadeProduto, "faltaPlano" | "faltaMinima">): number {
  return Math.max(p.faltaPlano, p.faltaMinima);
}

// "Em risco de faltar 8.400 peças" / "Impossível com a capacidade atual — faltam 8.400 peças" / "Fecha, mas sem folga"
export function manchete(p: AtingibilidadeProduto): string {
  const falta = faltaDoProduto(p);
  if (p.status === "impossivel") return falta > 0 ? `Impossível com a capacidade atual — faltam ${fmt(falta)} peças` : "Impossível com a capacidade atual";
  if (p.status === "em_risco") {
    if (falta > 0) return `Em risco de faltar ${fmt(falta)} peças`;
    const folga = p.etapas.length > 0 ? Math.min(...p.etapas.map((e) => e.folgaPercentual)) : 0;
    return `Em risco — fecha, mas com folga de só ${fmt(Math.max(0, folga), 1)}% no gargalo`;
  }
  return "Atingível";
}

export function textoAcao(acao: AcaoRecomendada | null, nomeMaquina: (id: string) => string): string | null {
  if (!acao) return null;
  switch (acao.tipo) {
    case "priorizar_maquina": {
      const n = acao.periodos ?? 1;
      return `Priorizar ${nomeMaquina(acao.maquinaId as string)} nos próximos ${n} ${n === 1 ? "período" : "períodos"}.`;
    }
    case "selecionar_maquina": {
      const lista = (acao.compativeis ?? []).slice(0, 3).map(nomeMaquina).join(", ");
      return `Máquinas compatíveis que podem ajudar: ${lista}. Só vale a que aparecer na recomendação validada abaixo.`;
    }
    case "reduzir_quantidade":
      return `Reduzir o previsto para cerca de ${fmt(acao.quantidade ?? 0)} peças (o que as máquinas atuais comportam).`;
    case "aumentar_equipe":
      return "Aumentar a equipe produtiva ou reduzir a programação.";
    default:
      return "Acompanhar o gargalo.";
  }
}

export function periodosTexto(n: number): string | null {
  return n > 0 ? `Faltam cerca de ${n} ${n === 1 ? "período" : "períodos"} a mais nas máquinas atuais do gargalo.` : null;
}

export interface LinhaRecomendacao {
  titulo: string;
  efeitos: string[];
}

// Linhas da recomendação de máquina validada pelo cenário COMPLETO.
export function linhasRecomendacao(
  g: RecomendacaoGlobal,
  nome: { maquina: (id: string) => string; produto: (id: string) => string; etapa: (id: string) => string }
): { passos: LinhaRecomendacao[]; resumo: string[] } {
  const passos = g.passos.map((p) => ({
    titulo: `Selecionar ${nome.maquina(p.maquinaId)}${p.alternativas.length > 0 ? ` (ou ${p.alternativas.map(nome.maquina).join(", ")})` : ""} em ${p.poolsAfetados.map((x) => `${nome.produto(x.produtoId)} › ${nome.etapa(x.etapaId)}`).join(", ")}`,
    efeitos: [] as string[],
  }));
  const resumo: string[] = [];
  g.produtosMelhorados.forEach((p) => {
    const mudouStatus = p.de !== p.para;
    const partes: string[] = [];
    if (mudouStatus) partes.push(`${ROTULO_STATUS[p.de]} → ${ROTULO_STATUS[p.para]}`);
    if (p.faltaDe - p.faltaPara > 0.5) partes.push(`falta ${fmt(p.faltaDe)} → ${fmt(p.faltaPara)} peças`);
    if (partes.length > 0) resumo.push(`${nome.produto(p.produtoId)}: ${partes.join("; ")}`);
  });
  if (g.antes.faltaTotal - g.depois.faltaTotal > 0.5) resumo.push(`Total em falta: ${fmt(g.antes.faltaTotal)} → ${fmt(g.depois.faltaTotal)} peças`);
  resumo.push(`Cobertura (só o previsto): ${fmt(g.antes.coberturaPrevisto, 1)}% → ${fmt(g.depois.coberturaPrevisto, 1)}%`);
  if (g.antes.comAdicional && g.depois.comAdicional) resumo.push(`Cobertura com a melhor carga adicional: ${fmt(g.antes.comAdicional.cobertura, 1)}% → ${fmt(g.depois.comAdicional.cobertura, 1)}%`);
  return { passos, resumo };
}
