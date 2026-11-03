// Validações do fechamento (puras): (1) antes de gravar, (2) PORTÃO HARD antes de publicar o plano. Mesmos limites dos CHECKs do banco.
import type { ContagemFisicaPar } from "@/features/escala/fluxo/tipos";
import { DIFERENCA_EXIGE_CONFIRMACAO, DIFERENCA_EXIGE_MOTIVO, JANELA_CONTAGEM_ANTES_DO_FIM_MS, TOLERANCIA_FUTURO_MS, type BufferCatalogo, type EntradaConfirmacao, type ErroValidacao, type EstimativaBuffer, type PostoFechamento, type ResultadoValidacao } from "./tipos";

export interface ContextoValidacao {
  agoraMs: number;
  fimPeriodoMs: number;
  postos: PostoFechamento[];
  obrigatorios: BufferCatalogo[];
  estimativas: EstimativaBuffer[];
  podeExcecao: boolean;
  periodoJaFechado: boolean;
}

export const limiteMotivo = (fisico: number) => Math.max(DIFERENCA_EXIGE_MOTIVO.absoluta, DIFERENCA_EXIGE_MOTIVO.relativa * fisico);

export function validarConfirmacao(e: EntradaConfirmacao, c: ContextoValidacao): ResultadoValidacao {
  const erros: ErroValidacao[] = [];
  const exigeConfirmacao: string[] = [];
  const add = (codigo: string, mensagem: string, bufferId?: string) => erros.push({ codigo, mensagem, ...(bufferId ? { bufferId } : {}) });

  if (c.periodoJaFechado) add("PERIODO_JA_FECHADO", "Este período já foi fechado.");
  if (!/^[0-9a-f-]{36}$/i.test(e.chave)) add("CHAVE_INVALIDA", "Chave de idempotência inválida.");
  const pendentes = c.postos.filter((p) => p.status === "pendente");
  if (pendentes.length > 0) add("POSTOS_PENDENTES", `Faltam apontamentos de ${pendentes.length} posto(s): ${pendentes.map((p) => p.nome).join(", ")}.`);
  if (e.contadoEmMs !== undefined) {
    if (!Number.isFinite(e.contadoEmMs)) add("INSTANTE_INVALIDO", "Horário da contagem inválido.");
    else if (e.contadoEmMs < c.fimPeriodoMs - JANELA_CONTAGEM_ANTES_DO_FIM_MS) add("INSTANTE_ANTIGO", "A contagem é anterior ao fim do período por mais de 15 minutos.");
    else if (e.contadoEmMs > c.agoraMs + TOLERANCIA_FUTURO_MS) add("INSTANTE_FUTURO", "Horário da contagem no futuro.");
  }

  if (e.excecao) {
    if (!c.podeExcecao) add("EXCECAO_SEM_PERMISSAO", "Fechar sem contagem exige perfil superior.");
    if (!e.excecao.motivo || e.excecao.motivo.trim().length < 5) add("EXCECAO_SEM_MOTIVO", "Informe o motivo (mínimo 5 caracteres) para fechar sem contagem.");
    return { ok: erros.length === 0, erros, exigeConfirmacao };
  }

  const ids = new Set(c.obrigatorios.map((b) => b.id));
  e.buffers.forEach((b) => { if (!ids.has(b.bufferId)) add("BUFFER_DESCONHECIDO", "Buffer não pertence a este fechamento.", b.bufferId); });
  if (new Set(e.buffers.map((b) => b.bufferId)).size !== e.buffers.length) add("BUFFER_DUPLICADO", "Buffer informado mais de uma vez.");
  c.obrigatorios.forEach((b) => {
    const inf = e.buffers.find((x) => x.bufferId === b.id);
    if (!inf || inf.fisico === null || inf.fisico === undefined || (typeof inf.fisico === "number" && Number.isNaN(inf.fisico))) { add("BUFFER_FALTANDO", `Informe o estoque físico: ${b.rotulo}.`, b.id); return; }
    if (typeof inf.fisico !== "number" || !Number.isFinite(inf.fisico)) { add("SALDO_INVALIDO", `Valor inválido em ${b.rotulo}.`, b.id); return; }
    if (inf.fisico < 0) { add("SALDO_NEGATIVO", `${b.rotulo}: o estoque não pode ser negativo.`, b.id); return; }
    if (!Number.isInteger(inf.fisico)) { add("SALDO_NAO_INTEIRO", `${b.rotulo}: informe um número inteiro de peças.`, b.id); return; }
    const est = c.estimativas.find((x) => x.bufferId === b.id)?.estimado;
    if (est === undefined) return;
    const dif = Math.abs(inf.fisico - est);
    if (dif > limiteMotivo(inf.fisico) && (!inf.motivo || inf.motivo.trim().length < 3)) add("MOTIVO_OBRIGATORIO", `${b.rotulo}: diferença de ${Math.round(dif)} peças em relação ao estimado — informe o motivo.`, b.id);
    if (est > 0 && dif / Math.max(est, 1) > DIFERENCA_EXIGE_CONFIRMACAO && !e.confirmouDiferencaGrande) exigeConfirmacao.push(b.id);
  });
  if (exigeConfirmacao.length > 0) add("CONFIRMACAO_DIFERENCA_GRANDE", "Há diferença superior a 50% do estimado: confirme os valores.");
  return { ok: erros.length === 0, erros, exigeConfirmacao };
}

export interface ParaPortao {
  corteUsado: boolean;
  corteMotivoFalha: string | null;
  checagens: Record<string, number> | null;
  paresDoEstado: { produtoId: string; etapaOrigemId: string; etapaSeguinteId: string; wip: { lo: number; hi: number }; negativo?: boolean }[] | null;
  contagens: ContagemFisicaPar[];
}

/**
 * PORTÃO HARD antes de publicar o próximo período. null = pode publicar. Texto = recusa (nada é gravado).
 * Cobre: 0 CADEIA_INVALIDA, 0 downstream sem material, 0 estoque negativo, 0 pessoa/máquina duplicada, 0 violação de revezamento/dura, 0 máquina fora da Previsão,
 * pessoas ≤ disponíveis, passado intacto, distribuição válida e INVENTÁRIO FÍSICO PRESERVADO (o WIP inicial do motor é exatamente o físico informado).
 */
export function portaoHard(p: ParaPortao): string | null {
  if (!p.corteUsado) return `o planejador não aprovou o plano${p.corteMotivoFalha ? `: ${p.corteMotivoFalha}` : ""}`;
  const falhas: string[] = [];
  const ch = p.checagens ?? {};
  const zero: [string, string][] = [
    ["cadeiaInvalida", "CADEIA_INVALIDA"], ["semMaterial", "downstream sem material"], ["violacoesDuras", "violação de restrição dura (revezamento/pessoa/máquina)"],
    ["maquinaForaDaPrevisao", "máquina fora da Previsão"], ["distribuicaoInvalida", "distribuição de quantidade inválida"], ["excedePessoas", "mais postos que pessoas disponíveis"],
    ["passadoAlterado", "passado alterado"], ["duplicidade", "pessoa/máquina duplicada"],
  ];
  zero.forEach(([k, nome]) => { if (Number(ch[k] ?? 0) > 0) falhas.push(`${nome} (${ch[k]})`); });
  if (p.checagens === null) falhas.push("checagens independentes ausentes");
  (p.paresDoEstado ?? []).forEach((q) => { if (q.negativo) falhas.push(`estoque negativo em ${q.produtoId.slice(0, 6)}/${q.etapaOrigemId.slice(0, 6)}`); });
  p.contagens.forEach((c) => {
    const q = (p.paresDoEstado ?? []).find((x) => x.produtoId === c.produtoId && x.etapaOrigemId === c.etapaOrigemId && x.etapaSeguinteId === c.etapaSeguinteId);
    if (!q) falhas.push(`inventário não encontrado no estado do motor (${c.etapaOrigemId.slice(0, 6)}→${c.etapaSeguinteId.slice(0, 6)})`);
    else if (Math.abs(q.wip.lo - c.saldo) > 0.5 || Math.abs(q.wip.hi - c.saldo) > 0.5) falhas.push(`inventário físico não preservado (${c.etapaOrigemId.slice(0, 6)}→${c.etapaSeguinteId.slice(0, 6)}: físico ${c.saldo}, motor ${Math.round(q.wip.lo)}–${Math.round(q.wip.hi)})`);
  });
  return falhas.length > 0 ? falhas.join("; ") : null;
}
