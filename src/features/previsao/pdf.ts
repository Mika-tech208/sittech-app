// Gerador do relatório HTML "Programação de Produção" (baixa um .html que o
// usuário abre e imprime como PDF via Cmd+P). Extraído de SittechApp.tsx —
// mesma função, mesmo documento gerado, só com as dependências (produtos,
// máquinas, período, semana etc.) agora explícitas como parâmetros em vez
// de vir do closure do componente.

import {
  calcularAnaliseCapacidadeSemanal, calcularUsoPorMaquina, calcularObservacoesSetup, calcularViabilidadeItem,
  calcularFuncionariosTotalSemana, calcularPeriodosEtapa, textoDiasPeriodos,
} from "@/features/capacidade/calculations";
import { weekLabel } from "@/lib/date";
import { toNumber } from "@/lib/format";
import { LOGO_LIGHT } from "@/lib/logos";
import type { Produto, Maquina, PeriodoComDuracao, Previsao, Funcionario } from "@/types/domain";

const CORES_PRODUTO_PDF = ["#1D9E75", "#7F77DD", "#D85A30", "#D4537E", "#378ADD", "#BA7517"];

export interface GerarProgramacaoParams {
  semanaAtual: string;
  semanaAtualRec: Previsao;
  produtos: Produto[];
  maquinas: Maquina[];
  periodosComDuracao: PeriodoComDuracao[];
  horasPorMaquinaSemana: number;
  duracaoMediaPeriodo: number;
  diasUteisSemana: string | number;
  funcionariosAtivos: Funcionario[];
  getLucroHora: (produto: Produto) => number;
}

export function gerarHtmlProgramacaoSemana(params: GerarProgramacaoParams): string {
  const {
    semanaAtual, semanaAtualRec, produtos, maquinas, periodosComDuracao, horasPorMaquinaSemana,
    duracaoMediaPeriodo, diasUteisSemana, funcionariosAtivos, getLucroHora,
  } = params;

  const analiseCapacidade = calcularAnaliseCapacidadeSemanal(semanaAtualRec.itens, produtos, maquinas, periodosComDuracao, horasPorMaquinaSemana);
  const usoMaquinas = calcularUsoPorMaquina(analiseCapacidade, duracaoMediaPeriodo);
  const maquinasExcedidas = usoMaquinas.filter((u) => u.excedeu);
  const observacoesSetupPDF = calcularObservacoesSetup(analiseCapacidade, produtos, getLucroHora);
  const horasPessoaDisponiveisPDF = funcionariosAtivos.length * horasPorMaquinaSemana;
  const horasPessoaDemandadasPDF = analiseCapacidade.maquinas.reduce((s, m) => s + m.horasNecessarias, 0);
  const pctEquipePDF = horasPessoaDisponiveisPDF > 0 ? (horasPessoaDemandadasPDF / horasPessoaDisponiveisPDF) * 100 : 0;

  const linhasItens = semanaAtualRec.itens.map((it) => {
    const produto = produtos.find((p) => p.id === it.produtoId);
    const roteiro = produto?.roteiro || [];
    const viab = calcularViabilidadeItem(it, produtos, periodosComDuracao, horasPorMaquinaSemana);
    let etapaGargalo: { nome: string; periodos: ReturnType<typeof calcularPeriodosEtapa> } | null = null;
    let maiorHoras = -1;
    const linhasEtapas = roteiro.map((etapa) => {
      let totalPecasMeta = 0, totalHorasMeta = 0;
      const metas = (etapa.metas || {}) as unknown as Record<string, number>;
      periodosComDuracao.forEach((p) => {
        const meta = Number(metas[p.id] || 0);
        if (meta > 0 && p.duracaoHoras > 0) { totalPecasMeta += meta; totalHorasMeta += p.duracaoHoras; }
      });
      const tempoPorPeca = totalPecasMeta > 0 ? totalHorasMeta / totalPecasMeta : 0;
      const idsSelecionadas = (it.maquinasPorEtapa || {})[etapa.id] || [];
      const nomesMaquinas = idsSelecionadas.map((id) => maquinas.find((m) => m.id === id)?.nome).filter(Boolean);
      const periodos = calcularPeriodosEtapa(it.quantidade, tempoPorPeca, idsSelecionadas.length, duracaoMediaPeriodo);
      if (periodos.horasCalendario > maiorHoras) { maiorHoras = periodos.horasCalendario; etapaGargalo = { nome: etapa.operacao, periodos }; }
      return `<tr><td>${etapa.operacao}</td><td>${nomesMaquinas.length > 0 ? nomesMaquinas.join(", ") : "—"}</td><td>${periodos.manha}</td><td>${periodos.tarde}</td></tr>`;
    }).join("");
    return `
      <div class="item">
        <div class="item-header">
          <span class="item-nome">${it.produtoNome}</span>
          <span class="status ${viab.atingivel ? "ok" : "alerta"}">${viab.atingivel ? "✓ meta atingível" : `⚠ atinge só ${viab.maxPecas} de ${it.quantidade}`}</span>
        </div>
        <table><thead><tr><th>Etapa</th><th>Máquinas a usar</th><th>Períodos manhã</th><th>Períodos tarde</th></tr></thead><tbody>${linhasEtapas}</tbody></table>
        ${etapaGargalo ? (() => {
          const g = etapaGargalo as { nome: string; periodos: ReturnType<typeof calcularPeriodosEtapa> };
          return `<p class="callout">${g.nome} é a etapa mais lenta — tempo total estimado do produto: ${g.periodos.manha} período${g.periodos.manha !== 1 ? "s" : ""} de manhã e ${g.periodos.tarde} de tarde, ${textoDiasPeriodos(g.periodos.manha, g.periodos.tarde)}.</p>`;
        })() : ""}
        <p class="resumo-item">Meta da semana: <b>${it.quantidade}</b> peças &nbsp;·&nbsp; Funcionários pra esse item: <b>${viab.funcionariosNecessarios}</b></p>
      </div>`;
  }).join("");

  const totalFuncionarios = calcularFuncionariosTotalSemana(semanaAtualRec.itens);

  const linhasMaquinas = usoMaquinas.map((u) => {
    const idsProdutos = Object.keys(u.produtos);
    const segmentos = idsProdutos.map((produtoId, i) => {
      const cor = CORES_PRODUTO_PDF[i % CORES_PRODUTO_PDF.length];
      const dadosProduto = u.produtos[produtoId];
      const totalItem = dadosProduto.manha + dadosProduto.tarde;
      const larguraPct = (u.totalManha + u.totalTarde + u.livre) > 0 ? (totalItem / (u.totalManha + u.totalTarde + u.livre)) * 100 : 0;
      return { cor, nome: dadosProduto.produtoNome, larguraPct, manha: dadosProduto.manha, tarde: dadosProduto.tarde };
    });
    const larguraLivrePct = 100 - segmentos.reduce((s, seg) => s + seg.larguraPct, 0);
    const barra = segmentos.map((seg) => `<div style="width:${seg.larguraPct.toFixed(1)}%; background:${seg.cor};"></div>`).join("") +
      `<div style="width:${Math.max(0, larguraLivrePct).toFixed(1)}%; background:#dde2de;"></div>`;
    const legenda = segmentos.map((seg) => `<span><i style="background:${seg.cor};"></i>${seg.nome} — ${seg.manha} manhã + ${seg.tarde} tarde</span>`).join("") +
      `<span><i style="background:#dde2de;"></i>Livre — ${Math.max(0, u.capacidadePeriodo - u.totalManha)} manhã + ${Math.max(0, u.capacidadePeriodo - u.totalTarde)} tarde</span>`;
    return `
      <div class="maquina-card">
        <div class="maquina-header"><span class="maquina-nome">${u.nome}</span><span class="${u.excedeu ? "pct-excedido" : "pct-ok"}">${u.pct}% usada</span></div>
        <div class="barra">${barra}</div>
        <div class="legenda">${legenda}</div>
      </div>`;
  }).join("");

  const capacidadePeriodoSemana = (toNumber(diasUteisSemana) || 5) * 3;
  const cabe = analiseCapacidade.atingivel;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Programação de Produção - ${weekLabel(semanaAtual)}</title>
<style>
  body { font-family: -apple-system, Arial, sans-serif; color: #14181c; padding: 24px; -webkit-print-color-adjust: exact; print-color-adjust: exact; color-adjust: exact; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; color-adjust: exact; }
  .header { display: flex; align-items: center; gap: 16px; border-bottom: 2px solid #14181c; padding-bottom: 14px; margin-bottom: 20px; }
  .header img { height: 52px; }
  .title { font-size: 20px; font-weight: 700; margin: 0; }
  .sub { font-size: 12px; color: #5a636b; margin: 2px 0 0 0; }
  .item { margin-bottom: 20px; page-break-inside: avoid; }
  .item-header { display: flex; justify-content: space-between; align-items: center; background: #f2f4f2; padding: 8px 12px; border-radius: 6px 6px 0 0; }
  .item-nome { font-weight: 700; font-size: 14px; }
  .status { font-size: 12px; font-weight: 600; }
  .status.ok { color: #1F8A73; }
  .status.alerta { color: #b8790a; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  th, td { border: 1px solid #dde2de; padding: 6px 10px; text-align: left; }
  th { background: #f8f9f8; font-weight: 600; }
  .callout { font-size: 12px; color: #14181c; background: #eef7f4; border-radius: 6px; padding: 8px 10px; margin: 8px 0 0 0; }
  .resumo-item { font-size: 12px; color: #5a636b; margin: 6px 2px 0 2px; }
  h2.secao { font-size: 15px; font-weight: 700; margin: 28px 0 4px 0; }
  p.secao-sub { font-size: 11.5px; color: #8a8f94; margin: 0 0 12px 0; }
  .maquina-card { background: #f8f9f8; border-radius: 8px; padding: 12px 14px; margin-bottom: 10px; page-break-inside: avoid; }
  .maquina-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
  .maquina-nome { font-size: 13px; font-weight: 700; }
  .pct-ok { font-size: 12px; color: #5a636b; }
  .pct-excedido { font-size: 12px; color: #b8790a; font-weight: 700; }
  .barra { display: flex; height: 14px; border-radius: 4px; overflow: hidden; }
  .legenda { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 8px; font-size: 11px; color: #5a636b; }
  .legenda span { display: inline-flex; align-items: center; gap: 5px; }
  .legenda i { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }
  .total { margin-top: 20px; padding-top: 12px; border-top: 2px solid #14181c; font-size: 14px; }
  .resumo-final { border-radius: 8px; padding: 14px 16px; margin-top: 8px; }
  .resumo-final.ok { background: #eef7f4; color: #1F8A73; }
  .resumo-final.alerta { background: #fdf3e2; color: #b8790a; }
  .resumo-final p { margin: 0; font-size: 13px; }
  .resumo-final p.veredito { font-weight: 700; font-size: 14px; margin-bottom: 4px; }
  .obs-card { background: #f8f9f8; border-radius: 8px; padding: 14px 16px; margin-bottom: 14px; page-break-inside: avoid; }
  .obs-maquina { font-size: 13.5px; font-weight: 700; margin: 0 0 10px 0; }
  .obs-comparacao { display: flex; gap: 16px; flex-wrap: wrap; }
  .obs-coluna { flex: 1; min-width: 220px; }
  .obs-rotulo { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; margin: 0 0 8px 0; }
  .obs-rotulo.ruim { color: #c0392b; }
  .obs-rotulo.boa { color: #1F8A73; }
  .obs-sequencia { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
  .obs-bloco-ruim { background: #f4d9d6; color: #a03227; font-size: 10.5px; font-weight: 600; padding: 5px 8px; border-radius: 4px; text-decoration: line-through; opacity: 0.75; }
  .obs-bloco-boa { color: #ffffff; font-size: 11px; font-weight: 700; padding: 6px 10px; border-radius: 4px; }
  .obs-seta { color: #8a8f94; font-size: 13px; padding: 0 2px; }
  @media print {
    body { padding: 12px; }
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
  }
</style></head>
<body>
  <div class="header">
    <img src="${LOGO_LIGHT}" alt="Sittech" />
    <div>
      <p class="title">Programação de Produção</p>
      <p class="sub">${weekLabel(semanaAtual)} · gerado em ${new Date().toLocaleDateString("pt-BR")}</p>
    </div>
  </div>
  ${semanaAtualRec.itens.length === 0 ? "<p>Nenhum item lançado pra essa semana.</p>" : linhasItens}
  ${semanaAtualRec.itens.length > 0 ? `<p class="total">Total geral de funcionários necessários na semana: <b>${totalFuncionarios}</b> de ${funcionariosAtivos.length} ativos</p>
  <p style="margin-top:4px; font-size:14px;">Uso da equipe em horas: <b>${pctEquipePDF.toFixed(1)}%</b> <span style="font-weight:400; color:#8a8f94; font-size:12px;">(${horasPessoaDemandadasPDF.toFixed(1)}h demandadas de ${horasPessoaDisponiveisPDF.toFixed(1)}h disponíveis)</span></p>` : ""}
  ${usoMaquinas.length > 0 ? `
  <h2 class="secao">Uso de cada máquina essa semana</h2>
  <p class="secao-sub">Todas as máquinas com demanda na programação, não só as compartilhadas entre produtos.</p>
  ${linhasMaquinas}
  ${observacoesSetupPDF.length > 0 ? `
  <h2 class="secao">Observações — como organizar pra perder menos tempo trocando</h2>
  <p class="secao-sub">Máquinas usadas por mais de um produto essa semana — sugestão de ordem pra reduzir trocas de setup.</p>
  ${observacoesSetupPDF.map((obs) => {
    const nomes = obs.ordenados.map((p) => p.nome);
    const blocosRuim: string[] = [];
    for (let i = 0; i < Math.max(4, nomes.length * 2); i++) blocosRuim.push(nomes[i % nomes.length]);
    const blocosRuimHtml = blocosRuim.map((n) => `<span class="obs-bloco-ruim">${n}</span>`).join("");
    const blocosBoaHtml = obs.ordenados.map((p, i) => {
      const cor = CORES_PRODUTO_PDF[i % CORES_PRODUTO_PDF.length];
      return `<span class="obs-bloco-boa" style="background:${cor};">${p.nome}${i === 0 ? " (maior lucro/hora)" : ""}</span>`;
    }).join('<span class="obs-seta">→</span>');
    return `
    <div class="obs-card">
      <p class="obs-maquina">💡 ${obs.nome}</p>
      <div class="obs-comparacao">
        <div class="obs-coluna">
          <p class="obs-rotulo ruim">✕ Evite — trocando toda hora</p>
          <div class="obs-sequencia">${blocosRuimHtml}</div>
        </div>
        <div class="obs-coluna">
          <p class="obs-rotulo boa">✓ Prefira — lote completo por vez</p>
          <div class="obs-sequencia">${blocosBoaHtml}</div>
        </div>
      </div>
    </div>`;
  }).join("")}
  ` : ""}
  <h2 class="secao">Resumo final — programação da semana inteira</h2>
  <p class="secao-sub">Soma de todos os produtos lançados, checando cada máquina contra a capacidade dela na semana.</p>
  <div class="resumo-final ${cabe ? "ok" : "alerta"}">
    <p class="veredito">${cabe ? "✓ Dá para cumprir toda a programação dentro dos períodos disponíveis." : `⚠ ${maquinasExcedidas.length} máquina${maquinasExcedidas.length > 1 ? "s estão" : " está"} pedida${maquinasExcedidas.length > 1 ? "s" : ""} além da capacidade da semana.`}</p>
    <p>${cabe
        ? `Cada máquina usada tem no máximo ${capacidadePeriodoSemana} períodos de manhã e ${capacidadePeriodoSemana} de tarde disponíveis nos ${toNumber(diasUteisSemana) || 5} dias úteis — nenhuma passou disso.`
        : `Máquina${maquinasExcedidas.length > 1 ? "s" : ""} no limite: ${maquinasExcedidas.map((u) => u.nome).join(", ")}. Considera redistribuir entre produtos ou rever a previsão dessa semana.`}</p>
  </div>` : ""}
</body></html>`;
}

export function baixarProgramacaoSemanaPDF(params: GerarProgramacaoParams): void {
  const html = gerarHtmlProgramacaoSemana(params);
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `programacao-${params.semanaAtual}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
