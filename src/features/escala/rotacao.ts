// REVEZAMENTO DURO — validação PURA de qualquer alteração manual (troca, arrastar, etc.).
// Regra definitiva (Fase 4a): a mesma pessoa NUNCA executa a mesma operacao_id em períodos consecutivos do mesmo dia — mesmo que seja outra
// máquina, outro produto ou outro posto físico. M3→T1 conta como consecutivo; o primeiro período do dia zera. NÃO existe exceção manual,
// confirmação com motivo nem bypass administrativo: a ação é bloqueada. O servidor (RPC escala_trocar_alocacoes) aplica a mesma regra.

// ESCOPO "bloco" (hotfix 28/10, flag `revezamento_escopo`): a regra vira "a mesma pessoa não executa a mesma operação mais de uma vez na mesma manhã (M1-M3) nem na mesma tarde (T1-T3)";
// a exposição zera entre manhã e tarde (M3→T1 é permitido) e no dia seguinte. Sem `regras` (ou escopo consecutivo) o comportamento é o anterior, byte a byte.
import { blocoDoPeriodo, MemoriaBloco, type EquivalenciaOperacoes } from "./exposicaoBloco";

export const MENSAGEM_TROCA_BLOQUEADA = "Esta troca não pode ser realizada porque faria o funcionário repetir a mesma operação em períodos consecutivos.";
export const MENSAGEM_TROCA_BLOQUEADA_BLOCO = "Esta troca não pode ser realizada porque faria o funcionário repetir a mesma operação na mesma manhã ou na mesma tarde.";
export const MENSAGEM_TROCA_BLOQUEADA_PONTE = "Esta troca não pode ser realizada porque faria o funcionário repetir a mesma operação na mesma manhã, na mesma tarde ou do último período da manhã para o primeiro da tarde.";
/** `ponteM3T1` (flag, só com escopo "bloco"): além do bloco, a mesma operação não se repete de M3 para T1 do mesmo dia. */
export interface RegrasRotacao { escopo?: "consecutivo" | "bloco"; equivalencias?: EquivalenciaOperacoes; ponteM3T1?: boolean }
export const mensagemTrocaBloqueada = (r?: RegrasRotacao) => (r?.escopo === "bloco" ? (r.ponteM3T1 ? MENSAGEM_TROCA_BLOQUEADA_PONTE : MENSAGEM_TROCA_BLOQUEADA_BLOCO) : MENSAGEM_TROCA_BLOQUEADA);

export interface LinhaRotacao {
  periodoId: string;
  funcionarioId: string;
  maquinaId: string | null;
  operacaoId: string | null;
}

// `ordemPeriodos`: ids dos períodos do dia, em ordem (consecutivos = índices vizinhos; não há reset entre M3 e T1).
export function repeticoesDaPessoa(linhas: LinhaRotacao[], funcionarioId: string, ordemPeriodos: string[], apenasAoRedorDe?: string, regras?: RegrasRotacao): number {
  const op = new Map<string, string | null>();
  linhas.filter((l) => l.funcionarioId === funcionarioId).forEach((l) => op.set(l.periodoId, l.maquinaId ? l.operacaoId : null));
  if (regras?.escopo === "bloco") {
    // repetições = execuções além da 1ª (ou equivalente) dentro do mesmo bloco; com `apenasAoRedorDe` só o bloco do período alterado
    const blocoAlvo = apenasAoRedorDe ? blocoDoPeriodo(apenasAoRedorDe) : null;
    const mem = { manha: new MemoriaBloco(regras.equivalencias), tarde: new MemoriaBloco(regras.equivalencias) };
    let total = 0;
    for (const pid of ordemPeriodos) {
      const b = blocoDoPeriodo(pid);
      const o = op.get(pid);
      if (!o) continue;
      if (mem[b].proibido(funcionarioId, o) && (blocoAlvo === null || b === blocoAlvo)) total++;
      mem[b].registrar(funcionarioId, o);
    }
    if (regras.ponteM3T1) {
      // PONTE M3 → T1: último período da manhã × primeiro da tarde (adjacentes na ordem do dia); com `apenasAoRedorDe` só conta se o período alterado é um dos dois
      for (let i = 1; i < ordemPeriodos.length; i++) {
        const [pm, pt] = [ordemPeriodos[i - 1], ordemPeriodos[i]];
        if (blocoDoPeriodo(pm) !== "manha" || blocoDoPeriodo(pt) !== "tarde") continue;
        if (apenasAoRedorDe && apenasAoRedorDe !== pm && apenasAoRedorDe !== pt) continue;
        const om = op.get(pm);
        const ot = op.get(pt);
        if (!om || !ot) continue;
        const m = new MemoriaBloco(regras.equivalencias);
        m.registrar(funcionarioId, om);
        if (m.proibido(funcionarioId, ot)) total++;
      }
    }
    return total;
  }
  let n = 0;
  for (let i = 1; i < ordemPeriodos.length; i++) {
    const a = op.get(ordemPeriodos[i - 1]);
    const b = op.get(ordemPeriodos[i]);
    if (apenasAoRedorDe) {
      const j = ordemPeriodos.indexOf(apenasAoRedorDe);
      if (i !== j && i !== j + 1) continue; // só os pares que envolvem o período alterado
    }
    if (a && b && a === b) n++;
  }
  return n;
}

export type ResultadoTroca = { ok: true } | { ok: false; funcionarioId: string; mensagem: string };

// Simula a troca de posto entre A e B no período e confere SÓ os pares que envolvem esse período (violação antiga e alheia à troca não a bloqueia).
export function validarTroca(linhasDoDia: LinhaRotacao[], ordemPeriodos: string[], periodoId: string, funcionarioA: string, funcionarioB: string, regras: RegrasRotacao = {}): ResultadoTroca {
  const a = linhasDoDia.find((l) => l.periodoId === periodoId && l.funcionarioId === funcionarioA);
  const b = linhasDoDia.find((l) => l.periodoId === periodoId && l.funcionarioId === funcionarioB);
  if (!a || !b) return { ok: true }; // o servidor recusa por outro motivo
  const depois: LinhaRotacao[] = linhasDoDia.map((l) => {
    if (l === a) return { ...l, maquinaId: b.maquinaId, operacaoId: b.operacaoId };
    if (l === b) return { ...l, maquinaId: a.maquinaId, operacaoId: a.operacaoId };
    return l;
  });
  for (const fid of [funcionarioA, funcionarioB]) {
    if (regras?.escopo === "bloco") {
      // violação já existente no bloco (plano antigo) e alheia à troca não a bloqueia: só bloqueia se a troca AUMENTA as repetições da pessoa no bloco
      if (repeticoesDaPessoa(depois, fid, ordemPeriodos, periodoId, regras) > repeticoesDaPessoa(linhasDoDia, fid, ordemPeriodos, periodoId, regras)) return { ok: false, funcionarioId: fid, mensagem: mensagemTrocaBloqueada(regras) };
    } else if (repeticoesDaPessoa(depois, fid, ordemPeriodos, periodoId) > 0) return { ok: false, funcionarioId: fid, mensagem: mensagemTrocaBloqueada(regras) };
  }
  return { ok: true };
}
