// Textos da ATINGIBILIDADE DO PREVISTO e da recomendação de máquina — funções PURAS (a tela só mostra).
// Cobertura da equipe ("estamos ocupando as pessoas?") e Atingibilidade do previsto ("conseguimos concluir a programação?")
// são perguntas diferentes: uma semana pode ter cobertura 100% e previsto impossível, e isso NÃO é contradição.

import type { AcaoRecomendada, AtingibilidadeProduto, CausaAtingibilidade, DiagnosticoGlobal, StatusAtingibilidade } from "@/features/escala/atingibilidade";
import type { BeneficioRecomendacao, GanhosRecomendacao, RecomendacaoGlobal } from "@/features/escala/recomendacaoMaquina";

export const PERGUNTA_COBERTURA = "Estamos conseguindo ocupar as pessoas?";
export const PERGUNTA_ATINGIBILIDADE = "Com os recursos disponíveis, conseguimos concluir a programação?";
export const NOTA_INDEPENDENTES =
  "100% de cobertura não significa que o previsto é atingível. São perguntas diferentes e independentes: a equipe pode estar 100% ocupada e, ainda assim, o previsto não fechar (as máquinas do gargalo ou a equipe não dão conta). Isso não é contradição.";

export const ROTULO_STATUS: Record<StatusAtingibilidade, string> = {
  atingivel: "Atingível",
  atingivel_no_limite: "Atingível no limite",
  em_risco: "Em risco",
  impossivel: "Impossível com a capacidade atual",
};

export const TEXTO_CAUSA: Record<CausaAtingibilidade, string> = {
  sem_maquina: "A etapa não tem máquina selecionada.",
  capacidade_maquinas: "As máquinas selecionadas da etapa não produzem o necessário nos períodos restantes, mesmo rodando o tempo todo.",
  recurso_compartilhado_saturado: "O recurso compartilhado com outros produtos não comporta o conjunto da programação (veja o diagnóstico da semana) e o plano deixou faltar peças deste produto.",
  semana_sem_equipe: "Este produto cabe sozinho, mas a semana inteira não cabe na equipe disponível — e o plano deixou faltar peças dele. Isso NÃO prova que ele, sozinho, seja impossível.",
  maquina_livre_nao_priorizada: "A máquina ficou livre enquanto faltavam peças desta etapa — a equipe estava em outro produto.",
  recurso_compartilhado: "As máquinas da etapa estiveram ocupadas por outros produtos.",
  folga_curta: "Fecha, mas usa quase toda a capacidade (folga menor que a margem configurada): qualquer parada no gargalo faz faltar peças.",
};

const fmt = (v: number, casas = 0) => v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

export function faltaDoProduto(p: Pick<AtingibilidadeProduto, "faltaPlano" | "faltaMinima">): number {
  return Math.max(p.faltaPlano, p.faltaMinima);
}

// "Em risco de faltar 8.400 peças" / "Impossível com a capacidade atual — faltam 8.400 peças" / "Fecha, mas sem folga"
export function manchete(p: AtingibilidadeProduto): string {
  const falta = faltaDoProduto(p);
  if (p.status === "impossivel") return falta > 0 ? `Impossível com a capacidade atual — faltam ${fmt(falta)} peças` : "Impossível com a capacidade atual";
  if (p.status === "em_risco") return falta > 0 ? `Em risco de faltar ${fmt(falta)} peças` : "Em risco";
  if (p.status === "atingivel_no_limite") {
    const folga = p.etapas.length > 0 ? Math.min(...p.etapas.map((e) => e.folgaPercentual)) : 0;
    return `Atingível no limite — fecha, com folga de só ${fmt(Math.max(0, folga), 1)}% no gargalo`;
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
  beneficios: BeneficioRecomendacao[];
  efeitos: string[];
  forte: boolean; // ganho produtivo ou de cobertura: destaque total. Só margem = destaque reduzido
}

// Linhas da recomendação de máquina validada pelo cenário COMPLETO.
export function linhasRecomendacao(
  g: RecomendacaoGlobal,
  nome: { maquina: (id: string) => string; produto: (id: string) => string; etapa: (id: string) => string }
): { passos: LinhaRecomendacao[]; resumo: string[] } {
  const passos = g.passos.map((p) => ({
    titulo: `Selecionar ${nome.maquina(p.maquinaId)}${p.alternativas.length > 0 ? ` (ou ${p.alternativas.map(nome.maquina).join(", ")})` : ""} em ${p.poolsAfetados.map((x) => `${nome.produto(x.produtoId)} › ${nome.etapa(x.etapaId)}`).join(", ")}`,
    beneficios: p.ganhos.beneficios,
    efeitos: textoGanhos(p.ganhos, nome.produto),
    forte: p.ganhos.beneficios.includes("produtivo") || p.ganhos.beneficios.includes("cobertura"),
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

// Diagnóstico da SEMANA (mostrado ANTES do detalhe por produto).
export interface LinhaDiagnosticoGlobal {
  titulo: string;
  linhas: string[];
}

export function diagnosticoGlobalTexto(d: DiagnosticoGlobal, nomeProduto: (id: string) => string, nomeMaquina: (id: string) => string): LinhaDiagnosticoGlobal[] {
  const saida: LinhaDiagnosticoGlobal[] = [];
  if (d.equipe.insuficiente) {
    saida.push({
      titulo: "Programação semanal não cabe na equipe disponível",
      linhas: [
        `Necessário (no mínimo): ${fmt(d.equipe.necessarioPeriodosPessoa, 1)} pessoas-período`,
        `Disponível: ${fmt(d.equipe.disponivelPeriodosPessoa)} pessoas-período`,
        `Déficit: ${fmt(d.equipe.deficit, 1)} pessoas-período`,
        "Isso prova que a semana como um todo não cabe — não que cada produto, sozinho, seja impossível.",
      ],
    });
  }
  d.recursosSaturados.forEach((r) =>
    saida.push({
      titulo: "Recurso compartilhado saturado",
      linhas: [
        `Máquinas: ${r.maquinas.slice(0, 6).map(nomeMaquina).join(", ")}${r.maquinas.length > 6 ? "…" : ""}`,
        `Disputado por: ${r.produtos.map(nomeProduto).join(", ")}`,
        `Necessário (no mínimo): ${fmt(r.necessarioPeriodosMaquina, 1)} períodos-máquina · disponível: ${fmt(r.disponivelPeriodosMaquina)} · déficit: ${fmt(r.deficit, 1)}`,
      ],
    })
  );
  return saida;
}

// ---- benefício das recomendações de máquina ----
export const ROTULO_BENEFICIO: Record<BeneficioRecomendacao, string> = {
  produtivo: "Ganho produtivo",
  cobertura: "Ganho de cobertura",
  margem: "Ganho de margem",
};

export function textoGanhos(g: GanhosRecomendacao, nomeProduto: (id: string) => string): string[] {
  const linhas: string[] = [];
  g.produtos.forEach((p) => {
    if (p.de !== p.para) linhas.push(`${nomeProduto(p.produtoId)} passa de ${ROTULO_STATUS[p.de]} para ${ROTULO_STATUS[p.para]}.`);
  });
  if (g.faltaReduzida > 0.5) linhas.push(`Falta reduzida em ${fmt(g.faltaReduzida)} peças.`);
  else if (g.beneficios.includes("margem") && !g.beneficios.includes("produtivo")) linhas.push("Peças faltantes: sem alteração.");
  if (g.minutosOciososReduzidos > 0.5) linhas.push(`Ociosidade reduzida em ${fmt(g.minutosOciososReduzidos / 60, 1)} horas-pessoa.`);
  return linhas;
}
