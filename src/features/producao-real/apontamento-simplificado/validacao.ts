// Validação das linhas (domínio puro). Regra de completude do fechamento:
//   todo posto PROGRAMADO tem produzido (+refugo) OU NÃO PRODUZIU com motivo; extras são opcionais, mas uma extra iniciada precisa estar correta.
import type { Catalogo, LinhaApontamento, LinhaRpc, ProblemaLinha } from "./tipos";
import { defMotivo } from "./motivos";
import { etapaDoPar } from "./linhas";

const ehInteiro = (n: number | null) => n !== null && Number.isInteger(n) && n >= 0;

/** Linha totalmente em branco (extra que ninguém começou): é ignorada, nunca bloqueia. */
export const linhaEmBranco = (l: LinhaApontamento): boolean =>
  l.origem === "POSTO_NAO_PLANEJADO" && l.situacao === "NOVA" && !l.naoProduziu && l.produzido === null && l.refugo === null && !l.real.maquinaId && !l.real.produtoId;

export function problemasDaLinha(l: LinhaApontamento, cat: Catalogo): ProblemaLinha[] {
  if (l.situacao === "EXISTENTE_PAINEL" || linhaEmBranco(l)) return [];
  const p: ProblemaLinha[] = [];
  if (!l.real.maquinaId) p.push({ codigo: "MAQUINA_OBRIGATORIA", mensagem: "Escolha a máquina.", campo: "maquina" });
  if (l.naoProduziu) {
    const d = defMotivo(l.motivo);
    if (!d) p.push({ codigo: "MOTIVO_OBRIGATORIO", mensagem: "Escolha o motivo do NÃO PRODUZIU.", campo: "motivo" });
    else if (d.exigeDescricao && l.descricao.trim().length < 3) p.push({ codigo: "DESCRICAO_OBRIGATORIA", mensagem: "Descreva o motivo (Outro).", campo: "descricao" });
    return p;
  }
  if (!l.real.produtoId) p.push({ codigo: "PRODUTO_OBRIGATORIO", mensagem: "Escolha o produto.", campo: "produto" });
  else if (l.real.maquinaId && !etapaDoPar(cat, l.real.maquinaId, l.real.produtoId)) p.push({ codigo: "PRODUTO_SEM_ETAPA_NA_MAQUINA", mensagem: "Este produto não tem etapa cadastrada (ou tem mais de uma) nesta máquina. Escolha outro produto/máquina.", campo: "produto" });
  if (!l.real.funcionarioId) p.push({ codigo: "OPERADOR_OBRIGATORIO", mensagem: "Escolha quem estava no posto.", campo: "operador" });
  if (l.produzido === null) p.push({ codigo: "PRODUZIDO_OBRIGATORIO", mensagem: "Informe o produzido.", campo: "produzido" });
  else if (!ehInteiro(l.produzido)) p.push({ codigo: "PRODUZIDO_INVALIDO", mensagem: "Produzido deve ser um número inteiro (0 ou mais).", campo: "produzido" });
  const refugo = l.refugo ?? 0;
  if (!ehInteiro(refugo)) p.push({ codigo: "REFUGO_INVALIDO", mensagem: "Refugo deve ser um número inteiro (0 ou mais).", campo: "refugo" });
  else if (l.produzido !== null && ehInteiro(l.produzido) && refugo > l.produzido) p.push({ codigo: "REFUGO_MAIOR_QUE_PRODUZIDO", mensagem: "O refugo não pode ser maior que o produzido.", campo: "refugo" });
  return p;
}

export interface ProblemaConjunto { codigo: "MAQUINA_DUPLICADA"; mensagem: string; chaves: string[] }
/** Duas linhas na MESMA máquina real (o banco admite um apontamento por máquina/dia/período). Inclui as lançadas no painel. */
export function problemasDoConjunto(linhas: LinhaApontamento[]): ProblemaConjunto[] {
  const porMaq = new Map<string, string[]>();
  for (const l of linhas) { if (linhaEmBranco(l) || !l.real.maquinaId) continue; porMaq.set(l.real.maquinaId, [...(porMaq.get(l.real.maquinaId) ?? []), l.chave]); }
  return [...porMaq.values()].filter((c) => c.length > 1).map((chaves) => ({ codigo: "MAQUINA_DUPLICADA", mensagem: "Há duas linhas na mesma máquina. Cada máquina tem um apontamento por período.", chaves }));
}

/** Linha completa e correta (pode ir para o banco). */
export const linhaPronta = (l: LinhaApontamento, cat: Catalogo): boolean => l.situacao !== "EXISTENTE_PAINEL" && !linhaEmBranco(l) && problemasDaLinha(l, cat).length === 0
  && (l.naoProduziu || l.produzido !== null);

export interface ResumoCompletude {
  /** postos programados ainda sem produzido+refugo nem NÃO PRODUZIU (válidos) */
  pendentes: LinhaApontamento[];
  /** linhas com erro (programadas ou extras iniciadas) */
  comProblema: { chave: string; problemas: ProblemaLinha[] }[];
  conjunto: ProblemaConjunto[];
  completo: boolean;
}

/** Completude de TELA (antes de gravar). A completude OFICIAL é a do servidor (postos esperados lidos do banco no fechamento). */
export function completude(linhas: LinhaApontamento[], cat: Catalogo): ResumoCompletude {
  const comProblema = linhas.map((l) => ({ chave: l.chave, problemas: problemasDaLinha(l, cat) })).filter((x) => x.problemas.length > 0);
  const pendentes = linhas.filter((l) => l.origem === "PROGRAMADO" && l.situacao !== "EXISTENTE_PAINEL" && !linhaPronta(l, cat));
  const conjunto = problemasDoConjunto(linhas);
  return { pendentes, comProblema, conjunto, completo: pendentes.length === 0 && comProblema.length === 0 && conjunto.length === 0 };
}

/** Linhas para a RPC: só as editáveis e prontas. */
export function paraRpc(linhas: LinhaApontamento[], cat: Catalogo): LinhaRpc[] {
  return linhas.filter((l) => linhaPronta(l, cat)).map((l): LinhaRpc => ({
    chave: l.chave, maquina_planejada_id: l.origem === "PROGRAMADO" ? (l.planejado?.maquinaId ?? null) : null, maquina_id: l.real.maquinaId as string,
    produto_id: l.naoProduziu ? null : l.real.produtoId, funcionario_id: l.naoProduziu ? null : l.real.funcionarioId,
    produzido: l.naoProduziu ? 0 : (l.produzido as number), refugo: l.naoProduziu ? 0 : (l.refugo ?? 0), nao_produziu: l.naoProduziu, motivo: l.naoProduziu ? l.motivo : null, descricao: l.naoProduziu ? l.descricao.trim() : "",
  }));
}

/** A pessoa mexeu nesta linha? Posto programado intocado é "pendente", não "erro". */
export const linhaIniciada = (l: LinhaApontamento): boolean => l.situacao !== "EXISTENTE_PAINEL" && (l.produzido !== null || l.refugo !== null || l.naoProduziu || (l.origem === "POSTO_NAO_PLANEJADO" && !linhaEmBranco(l)));

/** O que impede SALVAR (gravar o que já está pronto): linhas iniciadas com erro e máquina repetida. Posto intocado não impede (fica pendente). */
export function bloqueiosParaSalvar(linhas: LinhaApontamento[], cat: Catalogo): { chave: string; problemas: ProblemaLinha[] }[] {
  return linhas.filter(linhaIniciada).map((l) => ({ chave: l.chave, problemas: problemasDaLinha(l, cat) })).filter((x) => x.problemas.length > 0);
}
