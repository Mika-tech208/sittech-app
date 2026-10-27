// Teste de mutação do verificador independente: o plano regenerado pelo motor oficial deve ter 0 violações e cada mutação deve ser detectada.
import { carregarApontamentos, carregarDecisoes } from "./dados";
import { montarCenario } from "./montar";
import { verificarIndependente } from "./independente";
import { gerarEscala } from "@/features/escala/gerarEscala";
import type { AlocacaoEscala } from "@/features/escala/types";

const decs = carregarDecisoes();
const ap = carregarApontamentos();
const d = decs.find((x) => x.data === "2026-10-27" && x.periodoId === "m2" && x.revisao === 0)!;
const cen = montarCenario(d, ap);
const e = cen.entrada;
const base = gerarEscala(e).alocacoes;
const run = (nome: string, plano: AlocacaoEscala[], ent = e) => {
  const v = verificarIndependente(ent, plano, { planoVigente: cen.planoVigente });
  console.log(nome.padEnd(46), v.length === 0 ? "0 violações" : [...new Set(v.map((x) => `${x.criterio}:${x.tipo}`))].join(", "));
  return v;
};
let falhas = 0;
const espera = (ok: boolean, msg: string) => { if (!ok) { falhas++; console.log("  ✗ ESPERADO:", msg); } };
espera(run("baseline (gerarEscala)", base).length === 0, "baseline sem violações");

const slot0 = e.slots[e.aPartirDe];
const clone = (l: AlocacaoEscala[]) => l.map((a) => ({ ...a }));
const comPosto = (l: AlocacaoEscala[]) => l.filter((a) => a.maquinaId);

{ // ausente em posto
  const p = clone(base); const a = comPosto(p).find((x) => x.data === slot0.data && x.periodoId === slot0.periodoId)!;
  const ent = { ...e, ausencias: [...e.ausencias, { funcionarioId: a.funcionarioId, data: slot0.data, inicioMin: null, fimMin: null }] };
  espera(run("funcionário ausente alocado", p, ent).some((x) => x.tipo === "funcionario_ausente"), "funcionario_ausente");
}
{ // máquina indisponível
  const p = clone(base); const a = comPosto(p).find((x) => x.data === slot0.data && x.periodoId === slot0.periodoId)!;
  const ent = { ...e, indisponibilidades: [...e.indisponibilidades, { maquinaId: a.maquinaId!, desdeMs: slot0.inicioMs + 60_000, liberadaEmMs: null }] };
  espera(run("máquina com causa começando no meio do período", p, ent).some((x) => x.tipo === "maquina_indisponivel"), "maquina_indisponivel");
  const ent2 = { ...e, indisponibilidades: [...e.indisponibilidades, { maquinaId: a.maquinaId!, desdeMs: slot0.fimMs, liberadaEmMs: null }] };
  espera(run("causa começando exatamente no fim (não afeta)", p, ent2).filter((x) => x.slot === e.aPartirDe).every((x) => x.tipo !== "maquina_indisponivel"), "sem maquina_indisponivel no próprio slot");
}
{ // máquina inativa e fora da Previsão
  const p = clone(base); const a = comPosto(p).find((x) => x.data === slot0.data && x.periodoId === slot0.periodoId)!;
  espera(run("máquina inativa", p, { ...e, maquinasInativas: [a.maquinaId!] }).some((x) => x.tipo === "maquina_inativa"), "maquina_inativa");
  espera(run("máquina indisponível na Previsão", p, { ...e, maquinasIndisponiveisPrevisao: [a.maquinaId!] }).some((x) => x.tipo === "maquina_fora_da_previsao"), "maquina_fora_da_previsao");
}
{ // pessoa com duas linhas
  const p = clone(base); const a = comPosto(p).find((x) => x.data === slot0.data && x.periodoId === slot0.periodoId)!; p.push({ ...a, maquinaId: null, produtoId: null, etapaId: null, operacaoId: null, pecas: 0, motivoSemPosto: "x" });
  espera(run("pessoa com 2 linhas no período", p).some((x) => x.tipo === "pessoa_com_mais_de_uma_linha"), "pessoa_com_mais_de_uma_linha");
}
{ // posto com duas pessoas
  const p = clone(base); const doSlot = p.filter((x) => x.data === slot0.data && x.periodoId === slot0.periodoId); const a = doSlot.find((x) => x.maquinaId)!; const b = doSlot.find((x) => x.maquinaId && x.maquinaId !== a.maquinaId);
  if (b) { Object.assign(b, { maquinaId: a.maquinaId, produtoId: a.produtoId, etapaId: a.etapaId, operacaoId: a.operacaoId, pecas: a.pecas, motivoSemPosto: null }); espera(run("2 pessoas no mesmo posto", p).some((x) => x.tipo === "posto_com_duas_pessoas"), "posto_com_duas_pessoas"); } else console.log("(sem pessoa ociosa para mutação 2 pessoas/posto)");
}
{ // máquina em dois pools
  const p = clone(base); const doSlot = p.filter((x) => x.data === slot0.data && x.periodoId === slot0.periodoId); const a = doSlot.find((x) => x.maquinaId)!; const outro = doSlot.find((x) => x.maquinaId && `${x.produtoId}|${x.etapaId}` !== `${a.produtoId}|${a.etapaId}`)!;
  Object.assign(outro, { maquinaId: a.maquinaId }); espera(run("máquina em 2 pools", p).some((x) => x.tipo === "maquina_duplicada_em_pools"), "maquina_duplicada_em_pools");
}
{ // máquina fora da seleção
  const p = clone(base); const a = comPosto(p).find((x) => x.data === slot0.data && x.periodoId === slot0.periodoId)!; const outraMaq = e.pools.flatMap((x) => x.maquinasIds).find((m) => !e.pools.find((x) => x.produtoId === a.produtoId && x.etapaId === a.etapaId)!.maquinasIds.includes(m))!;
  a.maquinaId = outraMaq; espera(run("máquina fora da seleção da Previsão", p).some((x) => x.tipo === "maquina_fora_da_selecao"), "maquina_fora_da_selecao");
}
{ // revezamento: copia a linha do slot anterior (mesma operação) para o seguinte
  const p = clone(base); const s1 = e.aPartirDe + 1; if (!e.slots[s1].primeiroDoDia) {
    const a1 = comPosto(p).filter((x) => x.data === e.slots[s1].data && x.periodoId === e.slots[s1].periodoId)[0]; const a0 = comPosto(p).filter((x) => x.data === slot0.data && x.periodoId === slot0.periodoId)[0];
    a1.funcionarioId = a0.funcionarioId; Object.assign(a1, { operacaoId: a0.operacaoId });
    // a pessoa a0.funcionarioId passa a ter possivelmente 2 linhas; o que importa é D
    espera(run("mesma operação em períodos consecutivos", p).some((x) => x.criterio === "D"), "D mesma_operacao_consecutiva");
  }
}
{ // passado alterado
  const p = clone(base); const a = clone(cen.planoVigente).find((x) => x.maquinaId && x.data === e.slots[0].data && x.periodoId === e.slots[0].periodoId)!; a.pecas += 1000; p.push(a);
  espera(run("linha do passado alterada", p).some((x) => x.tipo === "passado_alterado"), "passado_alterado");
}
console.log(falhas === 0 ? "AUTOTESTE OK" : `AUTOTESTE FALHOU (${falhas})`);
process.exit(falhas ? 1 : 0);
