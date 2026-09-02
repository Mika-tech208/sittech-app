#!/usr/bin/env node
// Importador de uso único — backup real do Sittech (localStorage) → schema
// PostgreSQL do Supabase (sittech-dev). Dois modos:
//   --dry-run   valida e prepara tudo, não conecta em lugar nenhum, não escreve.
//   --apply     faz tudo que o dry-run faz + de fato insere no banco, numa
//               única transação, só depois de confirmar que as tabelas de
//               destino estão vazias.
// Os dois modos compartilham EXATAMENTE a mesma lógica de validação/preparo
// (mesma função `prepareAll()`) — a única diferença é se a fase de escrita
// roda no final ou não. Isso evita divergência entre o que foi aprovado no
// dry-run e o que realmente é inserido.
//
// usuarios e auditoria NÃO são migrados nesta etapa (decisão explícita) —
// nenhuma linha é lida, preparada ou inserida pra essas duas tabelas.

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

// ---- CLI ----
const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");
const isApply = args.includes("--apply");
const inputArgIdx = args.findIndex((a) => a === "--input");
const inputPath = inputArgIdx >= 0 ? args[inputArgIdx + 1] : "/mnt/data/sittech-backup-2026-09-01.json";

if (isDryRun === isApply) {
  console.error("Use exatamente um modo: --dry-run OU --apply (nunca os dois, nunca nenhum).");
  process.exit(1);
}
const mode = isApply ? "apply" : "dry-run";

// ---- helpers de transformação (mesmas regras já aprovadas) ----

function toNumericBR(value) {
  if (value === undefined || value === null) return { ok: false, value: null };
  if (typeof value === "number") return Number.isFinite(value) ? { ok: true, value } : { ok: false, value: null };
  const normalized = String(value).trim().replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, value: null };
}

function monthToFirstDay(mesStr) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(mesStr || "").trim());
  if (!m) return { ok: false, value: null };
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12) return { ok: false, value: null };
  return { ok: true, value: `${m[1]}-${m[2]}-01` };
}

function isValidISODate(dataStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dataStr || "").trim());
  if (!m) return false;
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  return mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31;
}

function normKey(s) {
  return String(s ?? "").trim().toLowerCase();
}

function newGroup() {
  return { jsonCount: 0, prepared: 0, ignored: 0, errors: [], warnings: [] };
}

function printGroup(label, g) {
  console.log(`\n${label}`);
  console.log(`  no JSON: ${g.jsonCount} | preparados: ${g.prepared} | ignorados: ${g.ignored} | erros: ${g.errors.length} | avisos: ${g.warnings.length}`);
  g.errors.forEach((e) => console.log(`    ERRO: ${e}`));
  g.warnings.forEach((w) => console.log(`    AVISO: ${w}`));
}

function checkDuplicateIds(label, items, keyFn) {
  const seen = new Map();
  const dups = [];
  items.forEach((item) => {
    const k = keyFn(item);
    if (k === undefined || k === null) return;
    seen.set(k, (seen.get(k) || 0) + 1);
  });
  for (const [k, count] of seen) {
    if (count > 1) dups.push(`${label}: id "${k}" aparece ${count} vezes`);
  }
  return dups;
}

// =========================================================================
// Fase única de validação + preparo — usada por --dry-run e --apply.
// Retorna { report, orfaos, rows } — `rows` só é consumido no modo --apply.
// =========================================================================
function prepareAll(data) {
  const {
    fixedCosts = [], variableEntries = [], categorias = [], operacoes = [], funcionarios = [],
    periodos = [], diasUteis, diasUteisSemana, faturamentos = [], produtos = [], maquinas = [], previsoes = [],
  } = data;

  const report = {};
  const rows = {
    categorias: [], operacoes: [], configuracoesEmpresa: [], periodos: [], fixedCosts: [], variableEntries: [],
    funcionarios: [], funcionarioCustos: [], maquinas: [], produtos: [], roteiroEtapas: [], roteiroEtapaMaquinas: [],
    faturamentos: [], receitas: [], previsoes: [], previsaoMaquinasIndisponiveis: [], previsaoItens: [], previsaoItemMaquinas: [],
  };
  const orfaos = [];

  // ---- categorias / operacoes ----
  function prepareCatalog(label, arr) {
    const g = newGroup();
    g.jsonCount = arr.length;
    const map = new Map();
    const out = [];
    arr.forEach((nomeOriginal) => {
      const nome = String(nomeOriginal ?? "").trim();
      if (!nome) { g.errors.push(`${label}: entrada vazia/em branco no array — ignorada`); return; }
      const k = normKey(nome);
      if (map.has(k)) { g.ignored++; g.warnings.push(`${label}: "${nomeOriginal}" é duplicata (case/espaço) de "${map.get(k).nome}" já catalogada`); return; }
      const uuid = randomUUID();
      map.set(k, { nome, uuid });
      out.push({ id: uuid, nome });
      g.prepared++;
    });
    return { group: g, map, out };
  }

  const { group: categoriasReport, map: categoriaMap, out: categoriasOut } = prepareCatalog("categorias", categorias);
  const { group: operacoesReport, map: operacaoMap, out: operacoesOut } = prepareCatalog("operacoes", operacoes);
  report.categorias = categoriasReport;
  report.operacoes = operacoesReport;
  rows.categorias = categoriasOut;
  rows.operacoes = operacoesOut;

  function resolveCatalog(map, valorOriginal) {
    return map.get(normKey(valorOriginal)) || null;
  }

  // ---- configuracoes_empresa ----
  const configReport = newGroup();
  configReport.jsonCount = 1;
  const APPROVED_DIAS_UTEIS = 22;
  const APPROVED_DIAS_UTEIS_SEMANA = 5;
  if (String(diasUteis).trim() !== String(APPROVED_DIAS_UTEIS)) {
    configReport.warnings.push(`diasUteis do JSON ("${diasUteis}") difere do valor aprovado (${APPROVED_DIAS_UTEIS}) — usando o valor aprovado mesmo assim`);
  }
  if (String(diasUteisSemana).trim() !== String(APPROVED_DIAS_UTEIS_SEMANA)) {
    configReport.warnings.push(`diasUteisSemana do JSON ("${diasUteisSemana}") difere do valor aprovado (${APPROVED_DIAS_UTEIS_SEMANA}) — usando o valor aprovado mesmo assim`);
  }
  configReport.prepared = 1;
  report.configuracoes_empresa = configReport;
  rows.configuracoesEmpresa.push({ id: randomUUID(), dias_uteis: APPROVED_DIAS_UTEIS, dias_uteis_semana: APPROVED_DIAS_UTEIS_SEMANA });

  // ---- periodos ----
  const periodosReport = newGroup();
  periodosReport.jsonCount = periodos.length;
  const PERIODOS_ESPERADOS = ["m1", "m2", "m3", "t1", "t2", "t3"];
  const idsPresentes = new Set(periodos.map((p) => p.id));
  PERIODOS_ESPERADOS.forEach((id) => { if (!idsPresentes.has(id)) periodosReport.errors.push(`período "${id}" esperado e ausente no JSON`); });
  periodos.forEach((p) => {
    if (!PERIODOS_ESPERADOS.includes(p.id)) periodosReport.warnings.push(`período com id inesperado "${p.id}" — fora do conjunto padrão m1..t3`);
    if (!/^\d{2}:\d{2}$/.test(p.inicio || "") || !/^\d{2}:\d{2}$/.test(p.fim || "")) {
      periodosReport.errors.push(`período "${p.id}": horário inválido (inicio="${p.inicio}" fim="${p.fim}")`);
      return;
    }
    periodosReport.prepared++;
    rows.periodos.push({ id: p.id, nome: p.nome, inicio: p.inicio, fim: p.fim });
  });
  periodosReport.ignored = periodosReport.jsonCount - periodosReport.prepared;
  report.periodos = periodosReport;

  // ---- funcionarios (+ funcionario_custos) ----
  const funcionariosReport = newGroup();
  const funcionarioCustosReport = newGroup();
  funcionariosReport.jsonCount = funcionarios.length;
  const funcionarioIdMap = new Map();
  checkDuplicateIds("funcionarios", funcionarios, (f) => f.id).forEach((d) => funcionariosReport.errors.push(d));

  funcionarios.forEach((f) => {
    const custosDoFunc = f.custos || [];
    funcionarioCustosReport.jsonCount += custosDoFunc.length;

    if (!f.id) { funcionariosReport.errors.push(`funcionário "${f.nome || "?"}" sem id — ignorado`); funcionarioCustosReport.ignored += custosDoFunc.length; return; }
    if (!f.nome || !String(f.nome).trim()) { funcionariosReport.errors.push(`funcionário id=${f.id} sem nome — ignorado`); funcionarioCustosReport.ignored += custosDoFunc.length; return; }
    const op = resolveCatalog(operacaoMap, f.operacao);
    if (!op) { funcionariosReport.errors.push(`funcionário "${f.nome}" (id=${f.id}): operação "${f.operacao}" não existe no catálogo — ignorado`); funcionarioCustosReport.ignored += custosDoFunc.length; return; }
    const salario = toNumericBR(f.salarioBase);
    if (!salario.ok) { funcionariosReport.errors.push(`funcionário "${f.nome}" (id=${f.id}): salarioBase inválido ("${f.salarioBase}") — ignorado`); funcionarioCustosReport.ignored += custosDoFunc.length; return; }

    const novoId = randomUUID();
    funcionarioIdMap.set(f.id, novoId);
    funcionariosReport.prepared++;
    rows.funcionarios.push({ id: novoId, nome: f.nome, operacao_id: op.uuid, salario_base: salario.value, ativo: f.ativo === undefined ? true : Boolean(f.ativo) });

    checkDuplicateIds(`funcionario_custos de "${f.nome}"`, custosDoFunc, (c) => c.id).forEach((d) => funcionarioCustosReport.errors.push(d));
    custosDoFunc.forEach((c) => {
      const valor = toNumericBR(c.valor);
      if (!c.id || !c.descricao || !valor.ok) { funcionarioCustosReport.errors.push(`custo de "${f.nome}" (id=${c.id || "?"}, "${c.descricao || "?"}"): dado inválido — ignorado`); return; }
      funcionarioCustosReport.prepared++;
      rows.funcionarioCustos.push({ id: randomUUID(), funcionario_id: novoId, descricao: c.descricao, valor: valor.value });
    });
  });
  funcionariosReport.ignored = funcionariosReport.jsonCount - funcionariosReport.prepared;
  funcionarioCustosReport.ignored += funcionarioCustosReport.jsonCount - funcionarioCustosReport.prepared - funcionarioCustosReport.ignored;
  report.funcionarios = funcionariosReport;
  report.funcionario_custos = funcionarioCustosReport;

  // ---- fixed_costs ----
  const fixedCostsReport = newGroup();
  fixedCostsReport.jsonCount = fixedCosts.length;
  checkDuplicateIds("fixed_costs", fixedCosts, (f) => f.id).forEach((d) => fixedCostsReport.errors.push(d));
  fixedCosts.forEach((f) => {
    const cat = resolveCatalog(categoriaMap, f.categoria);
    const valor = toNumericBR(f.valor);
    if (!f.id || !f.descricao) { fixedCostsReport.errors.push(`fixed_cost id=${f.id || "?"}: sem id ou descrição — ignorado`); return; }
    if (!cat) { fixedCostsReport.errors.push(`fixed_cost "${f.descricao}" (id=${f.id}): categoria "${f.categoria}" não existe no catálogo — ignorado`); return; }
    if (!valor.ok) { fixedCostsReport.errors.push(`fixed_cost "${f.descricao}" (id=${f.id}): valor inválido ("${f.valor}") — ignorado`); return; }
    fixedCostsReport.prepared++;
    rows.fixedCosts.push({ id: randomUUID(), descricao: f.descricao, categoria_id: cat.uuid, valor: valor.value, ativo: f.ativo === undefined ? true : Boolean(f.ativo) });
  });
  fixedCostsReport.ignored = fixedCostsReport.jsonCount - fixedCostsReport.prepared;
  report.fixed_costs = fixedCostsReport;

  // ---- variable_entries ----
  const variableEntriesReport = newGroup();
  variableEntriesReport.jsonCount = variableEntries.length;
  checkDuplicateIds("variable_entries", variableEntries, (v) => v.id).forEach((d) => variableEntriesReport.errors.push(d));
  variableEntries.forEach((v) => {
    const cat = resolveCatalog(categoriaMap, v.categoria);
    const valor = toNumericBR(v.valor);
    const mes = monthToFirstDay(v.mes);
    if (!v.id || !v.descricao) { variableEntriesReport.errors.push(`variable_entry id=${v.id || "?"}: sem id ou descrição — ignorado`); return; }
    if (!mes.ok) { variableEntriesReport.errors.push(`variable_entry "${v.descricao}" (id=${v.id}): mês inválido ("${v.mes}") — ignorado`); return; }
    if (!cat) { variableEntriesReport.errors.push(`variable_entry "${v.descricao}" (id=${v.id}): categoria "${v.categoria}" não existe no catálogo — ignorado`); return; }
    if (!valor.ok) { variableEntriesReport.errors.push(`variable_entry "${v.descricao}" (id=${v.id}): valor inválido ("${v.valor}") — ignorado`); return; }
    variableEntriesReport.prepared++;
    rows.variableEntries.push({ id: randomUUID(), mes: mes.value, descricao: v.descricao, categoria_id: cat.uuid, valor: valor.value });
  });
  variableEntriesReport.ignored = variableEntriesReport.jsonCount - variableEntriesReport.prepared;
  report.variable_entries = variableEntriesReport;

  // ---- maquinas ----
  const maquinasReport = newGroup();
  maquinasReport.jsonCount = maquinas.length;
  const maquinaIdMap = new Map();
  checkDuplicateIds("maquinas", maquinas, (m) => m.id).forEach((d) => maquinasReport.errors.push(d));
  maquinas.forEach((m) => {
    if (!m.id || !m.nome) { maquinasReport.errors.push(`máquina id=${m.id || "?"}: sem id ou nome — ignorada`); return; }
    const op = resolveCatalog(operacaoMap, m.operacao);
    if (!op) { maquinasReport.errors.push(`máquina "${m.nome}" (id=${m.id}): operação "${m.operacao}" não existe no catálogo — ignorada`); return; }
    const novoId = randomUUID();
    maquinaIdMap.set(m.id, novoId);
    maquinasReport.prepared++;
    rows.maquinas.push({ id: novoId, nome: m.nome, operacao_id: op.uuid, ativo: m.ativo === undefined ? true : Boolean(m.ativo) });
  });
  maquinasReport.ignored = maquinasReport.jsonCount - maquinasReport.prepared;
  report.maquinas = maquinasReport;

  // ---- produtos (+ roteiro_etapas + roteiro_etapa_maquinas) ----
  const produtosReport = newGroup();
  const roteiroEtapasReport = newGroup();
  const roteiroEtapaMaquinasReport = newGroup();
  produtosReport.jsonCount = produtos.length;
  const produtoIdMap = new Map();
  const etapaIdMap = new Map();
  checkDuplicateIds("produtos", produtos, (p) => p.id).forEach((d) => produtosReport.errors.push(d));

  produtos.forEach((p) => {
    const roteiro = p.roteiro || [];
    roteiroEtapasReport.jsonCount += roteiro.length;

    if (!p.id || !p.nome) { produtosReport.errors.push(`produto id=${p.id || "?"}: sem id ou nome — ignorado`); roteiroEtapasReport.ignored += roteiro.length; return; }
    const valorUnitario = toNumericBR(p.valorUnitario);
    if (!valorUnitario.ok) { produtosReport.errors.push(`produto "${p.nome}" (id=${p.id}): valorUnitario inválido ("${p.valorUnitario}") — ignorado`); roteiroEtapasReport.ignored += roteiro.length; return; }
    let prioridade = p.prioridade;
    if (!prioridade) { produtosReport.warnings.push(`produto "${p.nome}" (id=${p.id}): prioridade ausente — usando "media"`); prioridade = "media"; }
    else if (!["alta", "media", "baixa"].includes(prioridade)) { produtosReport.errors.push(`produto "${p.nome}" (id=${p.id}): prioridade inválida ("${prioridade}") — ignorado`); roteiroEtapasReport.ignored += roteiro.length; return; }

    const novoProdutoId = randomUUID();
    produtoIdMap.set(p.id, { uuid: novoProdutoId, nome: p.nome, valorUnitario: valorUnitario.value });
    produtosReport.prepared++;
    rows.produtos.push({ id: novoProdutoId, nome: p.nome, referencia: p.referencia ?? null, valor_unitario: valorUnitario.value, ativo: p.ativo === undefined ? true : Boolean(p.ativo), prioridade });

    checkDuplicateIds(`roteiro de "${p.nome}"`, roteiro, (e) => e.id).forEach((d) => roteiroEtapasReport.errors.push(d));

    roteiro.forEach((etapa, index) => {
      const etapasMaquinasIds = etapa.maquinasIds || [];
      roteiroEtapaMaquinasReport.jsonCount += etapasMaquinasIds.length;

      if (!etapa.id) { roteiroEtapasReport.errors.push(`etapa sem id no roteiro de "${p.nome}" (posição ${index}) — ignorada`); roteiroEtapaMaquinasReport.ignored += etapasMaquinasIds.length; return; }
      const op = resolveCatalog(operacaoMap, etapa.operacao);
      if (!op) { roteiroEtapasReport.errors.push(`etapa "${etapa.id}" de "${p.nome}": operação "${etapa.operacao}" não existe no catálogo — ignorada`); roteiroEtapaMaquinasReport.ignored += etapasMaquinasIds.length; return; }
      const metas = etapa.metas || {};
      const metaKeys = ["m1", "m2", "m3", "t1", "t2", "t3"];
      const metasResolvidas = {};
      const metasInvalidas = [];
      metaKeys.forEach((k) => { const r = toNumericBR(metas[k] ?? 0); if (!r.ok) metasInvalidas.push(k); else metasResolvidas[k] = r.value; });
      if (metasInvalidas.length) { roteiroEtapasReport.errors.push(`etapa "${etapa.id}" de "${p.nome}": metas inválidas (${metasInvalidas.join(", ")}) — ignorada`); roteiroEtapaMaquinasReport.ignored += etapasMaquinasIds.length; return; }

      const novaEtapaUuid = randomUUID();
      etapaIdMap.set(etapa.id, { uuid: novaEtapaUuid, produtoIdAntigo: p.id, produtoNome: p.nome, operacao: etapa.operacao });
      roteiroEtapasReport.prepared++;
      rows.roteiroEtapas.push({
        id: novaEtapaUuid, produto_id: novoProdutoId, operacao_id: op.uuid, ordem: index,
        meta_m1: metasResolvidas.m1, meta_m2: metasResolvidas.m2, meta_m3: metasResolvidas.m3,
        meta_t1: metasResolvidas.t1, meta_t2: metasResolvidas.t2, meta_t3: metasResolvidas.t3,
      });

      etapasMaquinasIds.forEach((maquinaIdAntigo) => {
        const maquinaUuid = maquinaIdMap.get(maquinaIdAntigo);
        if (!maquinaUuid) {
          roteiroEtapaMaquinasReport.warnings.push(`roteiro de "${p.nome}", etapa "${etapa.id}" (${etapa.operacao}): máquina "${maquinaIdAntigo}" não existe — relação ignorada`);
          roteiroEtapaMaquinasReport.ignored++;
          return;
        }
        roteiroEtapaMaquinasReport.prepared++;
        rows.roteiroEtapaMaquinas.push({ etapa_id: novaEtapaUuid, maquina_id: maquinaUuid });
      });
    });
  });
  produtosReport.ignored = produtosReport.jsonCount - produtosReport.prepared;
  roteiroEtapasReport.ignored += roteiroEtapasReport.jsonCount - roteiroEtapasReport.prepared - roteiroEtapasReport.ignored;
  report.produtos = produtosReport;
  report.roteiro_etapas = roteiroEtapasReport;
  report.roteiro_etapa_maquinas = roteiroEtapaMaquinasReport;

  // ---- faturamentos (+ receitas) ----
  const faturamentosReport = newGroup();
  const receitasReport = newGroup();
  faturamentosReport.jsonCount = faturamentos.length;
  const faturamentoMesMap = new Map();
  checkDuplicateIds("faturamentos", faturamentos, (f) => f.mes).forEach((d) => faturamentosReport.errors.push(d));

  faturamentos.forEach((f) => {
    const receitasDoMes = f.receitas || [];
    receitasReport.jsonCount += receitasDoMes.length;

    const mes = monthToFirstDay(f.mes);
    const numFunc = toNumericBR(f.numFuncionarios);
    const custoFunc = toNumericBR(f.custoFuncionariosTotal);
    const custoFixo = toNumericBR(f.custoFixoTotal);
    if (!mes.ok) { faturamentosReport.errors.push(`faturamento mes="${f.mes}": mês inválido — ignorado`); receitasReport.ignored += receitasDoMes.length; return; }
    if (!numFunc.ok || !custoFunc.ok || !custoFixo.ok) {
      faturamentosReport.errors.push(`faturamento ${f.mes}: valor numérico inválido (numFuncionarios="${f.numFuncionarios}", custoFuncionariosTotal="${f.custoFuncionariosTotal}", custoFixoTotal="${f.custoFixoTotal}") — ignorado`);
      receitasReport.ignored += receitasDoMes.length;
      return;
    }

    const novoId = randomUUID();
    faturamentoMesMap.set(f.mes, novoId);
    faturamentosReport.prepared++;
    rows.faturamentos.push({ id: novoId, mes: mes.value, num_funcionarios: numFunc.value, custo_funcionarios_total: custoFunc.value, custo_fixo_total: custoFixo.value });

    checkDuplicateIds(`receitas de ${f.mes}`, receitasDoMes, (r) => r.id).forEach((d) => receitasReport.errors.push(d));
    receitasDoMes.forEach((r) => {
      const valor = toNumericBR(r.valor);
      if (!r.id || !r.descricao || !isValidISODate(r.data) || !valor.ok) { receitasReport.errors.push(`receita id=${r.id || "?"} de ${f.mes}: dado inválido (data="${r.data}", valor="${r.valor}") — ignorada`); return; }
      receitasReport.prepared++;
      rows.receitas.push({ id: randomUUID(), faturamento_id: novoId, data: r.data, descricao: r.descricao, valor: valor.value });
    });
  });
  faturamentosReport.ignored = faturamentosReport.jsonCount - faturamentosReport.prepared;
  receitasReport.ignored += receitasReport.jsonCount - receitasReport.prepared - receitasReport.ignored;
  report.faturamentos = faturamentosReport;
  report.receitas = receitasReport;

  // ---- previsoes (+ previsao_maquinas_indisponiveis + previsao_itens + previsao_item_maquinas) ----
  const previsoesReport = newGroup();
  const previsaoMaqIndispReport = newGroup();
  const previsaoItensPrevistoReport = newGroup();
  const previsaoItensRealizadoReport = newGroup();
  const previsaoItemMaquinasReport = newGroup();
  previsoesReport.jsonCount = previsoes.length;
  const previsaoSemanaMap = new Map();
  checkDuplicateIds("previsoes", previsoes, (p) => p.semanaInicio).forEach((d) => previsoesReport.errors.push(d));

  previsoes.forEach((semana) => {
    const itens = semana.itens || [];
    const itensRealizados = semana.itensRealizados || [];
    const maquinasIndisp = semana.maquinasIndisponiveis || [];
    previsaoItensPrevistoReport.jsonCount += itens.length;
    previsaoItensRealizadoReport.jsonCount += itensRealizados.length;
    previsaoMaqIndispReport.jsonCount += maquinasIndisp.length;

    if (!semana.semanaInicio || !/^\d{4}-\d{2}-\d{2}$/.test(semana.semanaInicio)) {
      previsoesReport.errors.push(`previsão com semanaInicio inválida ("${semana.semanaInicio}") — semana inteira ignorada`);
      previsaoItensPrevistoReport.ignored += itens.length;
      previsaoItensRealizadoReport.ignored += itensRealizados.length;
      previsaoMaqIndispReport.ignored += maquinasIndisp.length;
      return;
    }

    const novaPrevisaoUuid = randomUUID();
    previsaoSemanaMap.set(semana.semanaInicio, novaPrevisaoUuid);
    previsoesReport.prepared++;
    rows.previsoes.push({ id: novaPrevisaoUuid, semana_inicio: semana.semanaInicio });

    maquinasIndisp.forEach((maquinaIdAntigo) => {
      const maquinaUuid = maquinaIdMap.get(maquinaIdAntigo);
      if (!maquinaUuid) { previsaoMaqIndispReport.warnings.push(`semana ${semana.semanaInicio}: máquina indisponível "${maquinaIdAntigo}" não existe — relação ignorada`); previsaoMaqIndispReport.ignored++; return; }
      previsaoMaqIndispReport.prepared++;
      rows.previsaoMaquinasIndisponiveis.push({ previsao_id: novaPrevisaoUuid, maquina_id: maquinaUuid });
    });

    function prepararItem(item, tipo, groupReport) {
      const produto = produtoIdMap.get(item.produtoId);
      const quantidade = toNumericBR(item.quantidade);
      const valorUnitario = toNumericBR(item.valorUnitario);

      if (!item.id) { groupReport.errors.push(`item sem id (produto "${item.produtoNome}") na semana ${semana.semanaInicio} [${tipo}] — ignorado`); return; }
      if (!produto) { groupReport.errors.push(`item ${item.id} (produto "${item.produtoNome}", produtoId="${item.produtoId}") na semana ${semana.semanaInicio} [${tipo}]: produto não existe mais — ignorado (viola FK previsao_itens.produto_id)`); return; }
      if (!quantidade.ok || !valorUnitario.ok) { groupReport.errors.push(`item ${item.id} (produto "${item.produtoNome}") na semana ${semana.semanaInicio} [${tipo}]: quantidade/valorUnitario inválido — ignorado`); return; }

      const novoItemUuid = randomUUID();
      groupReport.prepared++;
      // snapshot preservado tal qual — produto_nome/valor_unitario vêm do
      // item original (item.produtoNome/item.valorUnitario), NUNCA
      // recalculados a partir do produto atual (produto.nome/produto.valorUnitario).
      rows.previsaoItens.push({
        id: novoItemUuid, previsao_id: novaPrevisaoUuid, tipo, produto_id: produto.uuid,
        produto_nome: item.produtoNome, valor_unitario: valorUnitario.value, quantidade: quantidade.value,
      });

      const maquinasPorEtapa = item.maquinasPorEtapa || {};
      Object.entries(maquinasPorEtapa).forEach(([etapaIdAntigo, maquinaIds]) => {
        previsaoItemMaquinasReport.jsonCount += (maquinaIds || []).length;
        const etapa = etapaIdMap.get(etapaIdAntigo);
        if (!etapa) {
          previsaoItemMaquinasReport.warnings.push(`ÓRFÃ: item ${item.id} (produto "${item.produtoNome}", semana ${semana.semanaInicio}) referencia etapa "${etapaIdAntigo}" que NÃO existe mais no roteiro atual do produto — relação(ões) previsao_item_maquinas ignorada(s), item de previsão MANTIDO`);
          orfaos.push({ item: item.id, produto: item.produtoNome, semana: semana.semanaInicio, etapaId: etapaIdAntigo, maquinasIds: maquinaIds });
          previsaoItemMaquinasReport.ignored += (maquinaIds || []).length;
          return;
        }
        (maquinaIds || []).forEach((maquinaIdAntigo) => {
          const maquinaUuid = maquinaIdMap.get(maquinaIdAntigo);
          if (!maquinaUuid) { previsaoItemMaquinasReport.warnings.push(`item ${item.id} (produto "${item.produtoNome}", semana ${semana.semanaInicio}), etapa "${etapaIdAntigo}": máquina "${maquinaIdAntigo}" não existe — relação ignorada`); previsaoItemMaquinasReport.ignored++; return; }
          previsaoItemMaquinasReport.prepared++;
          rows.previsaoItemMaquinas.push({ item_id: novoItemUuid, etapa_id: etapa.uuid, maquina_id: maquinaUuid });
        });
      });
    }

    itens.forEach((item) => prepararItem(item, "previsto", previsaoItensPrevistoReport));
    itensRealizados.forEach((item) => prepararItem(item, "realizado", previsaoItensRealizadoReport));
  });

  previsoesReport.ignored = previsoesReport.jsonCount - previsoesReport.prepared;
  previsaoMaqIndispReport.ignored += previsaoMaqIndispReport.jsonCount - previsaoMaqIndispReport.prepared - previsaoMaqIndispReport.ignored;
  previsaoItensPrevistoReport.ignored += previsaoItensPrevistoReport.jsonCount - previsaoItensPrevistoReport.prepared - previsaoItensPrevistoReport.ignored;
  previsaoItensRealizadoReport.ignored += previsaoItensRealizadoReport.jsonCount - previsaoItensRealizadoReport.prepared - previsaoItensRealizadoReport.ignored;
  previsaoItemMaquinasReport.ignored += previsaoItemMaquinasReport.jsonCount - previsaoItemMaquinasReport.prepared - previsaoItemMaquinasReport.ignored;
  report.previsoes = previsoesReport;
  report.previsao_maquinas_indisponiveis = previsaoMaqIndispReport;
  report.previsao_itens_previsto = previsaoItensPrevistoReport;
  report.previsao_itens_realizado = previsaoItensRealizadoReport;
  report.previsao_item_maquinas = previsaoItemMaquinasReport;

  return { report, rows, orfaos };
}

function printReport(report, orfaos) {
  console.log("\n\n########## RELATÓRIO ##########");
  printGroup("categorias", report.categorias);
  printGroup("operacoes", report.operacoes);
  printGroup("configuracoes_empresa", report.configuracoes_empresa);
  printGroup("fixed_costs", report.fixed_costs);
  printGroup("variable_entries", report.variable_entries);
  printGroup("funcionarios", report.funcionarios);
  printGroup("funcionario_custos", report.funcionario_custos);
  printGroup("periodos", report.periodos);
  printGroup("maquinas", report.maquinas);
  printGroup("produtos", report.produtos);
  printGroup("roteiro_etapas", report.roteiro_etapas);
  printGroup("roteiro_etapa_maquinas", report.roteiro_etapa_maquinas);
  printGroup("faturamentos", report.faturamentos);
  printGroup("receitas", report.receitas);
  printGroup("previsoes", report.previsoes);
  printGroup("previsao_maquinas_indisponiveis", report.previsao_maquinas_indisponiveis);
  printGroup("previsao_itens (previsto)", report.previsao_itens_previsto);
  printGroup("previsao_itens (realizado)", report.previsao_itens_realizado);
  printGroup("previsao_item_maquinas", report.previsao_item_maquinas);

  const totalErros = Object.values(report).reduce((s, g) => s + g.errors.length, 0);
  const totalAvisos = Object.values(report).reduce((s, g) => s + g.warnings.length, 0);

  console.log("\n########## REFERÊNCIAS ÓRFÃS (etapa não existe mais no roteiro atual) ##########");
  if (orfaos.length === 0) console.log("Nenhuma.");
  else orfaos.forEach((o) => console.log(`  item=${o.item} produto="${o.produto}" semana=${o.semana} etapa="${o.etapaId}" maquinas=${JSON.stringify(o.maquinasIds)}`));

  console.log("\n########## RESUMO ##########");
  console.log(`Total de erros: ${totalErros}`);
  console.log(`Total de avisos: ${totalAvisos}`);
  console.log(`Referências órfãs (não fatais): ${orfaos.length}`);

  return { totalErros, totalAvisos };
}

// =========================================================================
// Fase de escrita — só roda em --apply, só depois do preflight de tabelas vazias.
// =========================================================================
async function applyToDatabase(rows) {
  const { Client } = await import("pg");
  const password = process.env.SITTECH_DB_PASSWORD;
  if (!password) {
    console.error("ERRO FATAL: defina SITTECH_DB_PASSWORD no ambiente antes de rodar --apply.");
    process.exit(1);
  }

  const client = new Client({
    host: "aws-0-sa-east-1.pooler.supabase.com",
    port: 5432,
    user: "postgres.zjwcomwjmhsloyxfypax",
    password,
    database: "postgres",
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  // ---- preflight: as 18 tabelas de destino precisam estar vazias ----
  const TARGET_TABLES = [
    "categorias", "operacoes", "configuracoes_empresa", "periodos", "fixed_costs", "variable_entries",
    "funcionarios", "funcionario_custos", "maquinas", "produtos", "roteiro_etapas", "roteiro_etapa_maquinas",
    "faturamentos", "receitas", "previsoes", "previsao_maquinas_indisponiveis", "previsao_itens", "previsao_item_maquinas",
  ];
  const naoVazias = [];
  for (const table of TARGET_TABLES) {
    const res = await client.query(`select count(*)::int as c from ${table}`);
    if (res.rows[0].c > 0) naoVazias.push({ table, count: res.rows[0].c });
  }
  if (naoVazias.length > 0) {
    console.error("\nABORTADO: as tabelas de destino já têm dados — não vou sobrescrever nem limpar automaticamente.");
    naoVazias.forEach((t) => console.error(`  ${t.table}: ${t.count} linha(s) já existente(s)`));
    await client.end();
    process.exit(1);
  }
  console.log("\nPreflight OK: todas as 18 tabelas de destino estão vazias. Prosseguindo com a importação.");

  // ---- inserts, em ordem de FK, dentro de uma única transação ----
  try {
    await client.query("BEGIN");

    async function insertMany(table, cols, items) {
      for (const item of items) {
        const values = cols.map((c) => item[c]);
        const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
        await client.query(`insert into ${table} (${cols.join(", ")}) values (${placeholders})`, values);
      }
    }

    await insertMany("categorias", ["id", "nome"], rows.categorias);
    await insertMany("operacoes", ["id", "nome"], rows.operacoes);
    await insertMany("configuracoes_empresa", ["id", "dias_uteis", "dias_uteis_semana"], rows.configuracoesEmpresa);
    await insertMany("periodos", ["id", "nome", "inicio", "fim"], rows.periodos);
    await insertMany("fixed_costs", ["id", "descricao", "categoria_id", "valor", "ativo"], rows.fixedCosts);
    await insertMany("variable_entries", ["id", "mes", "descricao", "categoria_id", "valor"], rows.variableEntries);
    await insertMany("funcionarios", ["id", "nome", "operacao_id", "salario_base", "ativo"], rows.funcionarios);
    await insertMany("funcionario_custos", ["id", "funcionario_id", "descricao", "valor"], rows.funcionarioCustos);
    await insertMany("maquinas", ["id", "nome", "operacao_id", "ativo"], rows.maquinas);
    await insertMany("produtos", ["id", "nome", "referencia", "valor_unitario", "ativo", "prioridade"], rows.produtos);
    await insertMany("roteiro_etapas", ["id", "produto_id", "operacao_id", "ordem", "meta_m1", "meta_m2", "meta_m3", "meta_t1", "meta_t2", "meta_t3"], rows.roteiroEtapas);
    await insertMany("roteiro_etapa_maquinas", ["etapa_id", "maquina_id"], rows.roteiroEtapaMaquinas);
    await insertMany("faturamentos", ["id", "mes", "num_funcionarios", "custo_funcionarios_total", "custo_fixo_total"], rows.faturamentos);
    await insertMany("receitas", ["id", "faturamento_id", "data", "descricao", "valor"], rows.receitas);
    await insertMany("previsoes", ["id", "semana_inicio"], rows.previsoes);
    await insertMany("previsao_maquinas_indisponiveis", ["previsao_id", "maquina_id"], rows.previsaoMaquinasIndisponiveis);
    await insertMany("previsao_itens", ["id", "previsao_id", "tipo", "produto_id", "produto_nome", "valor_unitario", "quantidade"], rows.previsaoItens);
    await insertMany("previsao_item_maquinas", ["item_id", "etapa_id", "maquina_id"], rows.previsaoItemMaquinas);

    await client.query("COMMIT");
    console.log("\nCOMMIT ok — importação real concluída.");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(`\nERRO durante a importação — ROLLBACK feito, nada foi persistido. Detalhe: ${e.message}`);
    await client.end();
    process.exit(1);
  }

  // ---- validação pós-importação, read-only ----
  console.log("\n########## VALIDAÇÃO PÓS-IMPORTAÇÃO ##########");
  const ALL_TABLES = [...TARGET_TABLES, "usuarios", "auditoria"];
  const counts = {};
  for (const table of ALL_TABLES) {
    const res = await client.query(`select count(*)::int as c from ${table}`);
    counts[table] = res.rows[0].c;
    console.log(`  ${table}: ${res.rows[0].c}`);
  }

  const config = await client.query("select dias_uteis, dias_uteis_semana from configuracoes_empresa limit 1");
  console.log(`  configuracoes_empresa valores: dias_uteis=${config.rows[0]?.dias_uteis} dias_uteis_semana=${config.rows[0]?.dias_uteis_semana}`);

  await client.end();
  return counts;
}

async function main() {
  console.log(`=== Importador Sittech -> Supabase (modo: ${mode}) ===`);
  console.log(`Arquivo de entrada: ${inputPath}`);

  let raw;
  try { raw = readFileSync(inputPath, "utf-8"); }
  catch (e) { console.error(`ERRO FATAL: não consegui ler o arquivo em "${inputPath}": ${e.message}`); process.exit(1); }

  let data;
  try { data = JSON.parse(raw); }
  catch (e) { console.error(`ERRO FATAL: o arquivo não é um JSON válido: ${e.message}`); process.exit(1); }

  const { report, rows, orfaos } = prepareAll(data);
  const { totalErros } = printReport(report, orfaos);

  if (mode === "dry-run") {
    console.log(`\nGARANTIA: modo --dry-run — nenhuma conexão de escrita foi aberta, nenhuma linha foi inserida/atualizada/removida no Supabase.`);
    process.exit(0);
  }

  // modo apply
  if (totalErros > 0) {
    console.error(`\nABORTADO: ${totalErros} erro(s) de preparo — corrija a origem e rode de novo. Nenhuma conexão de escrita foi aberta.`);
    process.exit(1);
  }
  await applyToDatabase(rows);
  console.log("\n=== Importação real finalizada ===");
}

main();
