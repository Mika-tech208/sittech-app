/* eslint-disable @typescript-eslint/no-explicit-any */
import { carregarTudo, versoes, nomeador, montarEstadoAting } from "./lib";
import { planejarComFluxo } from "@/features/escala/fluxo";
import type { EntradaEscala } from "@/features/escala/types";
import { chavePool } from "@/features/escala/types";

const { d } = carregarTudo();
const nome = nomeador(d.nomes);
const V = versoes();
const PC = "27c229d7-f192-41eb-aad1-0c69ece53eba";
const NODES: Record<string, string> = { Ros: `${PC}|ca90456c-9077-40f4-a058-bd0f467e87ec`, Paf: `${PC}|78aaa207-b8cc-412a-8a8b-d17bd95a1930`, Eti: `${PC}|34371af3-2608-42cc-9ded-1f7815a635a8`, Emb: `${PC}|b3db9629-c3f8-46d8-b4dd-64c9a61a5bc4`, M8: "a027ac97-ffd1-4834-8ed0-d3a94aac4aee|1b72bf46-5d13-43c5-89b4-6169436085b7", EtiA: "a027ac97-ffd1-4834-8ed0-d3a94aac4aee|1863b452-77f3-4d5c-9c49-a6d28ae77131", EmbA: "a027ac97-ffd1-4834-8ed0-d3a94aac4aee|fb96d08d-bd64-43d3-8694-40230c695c39" };
const M = { M8: "a118f430-f854-4e89-9e3c-ce6fcbbc52cf", Ros3: "4b48df30-62cb-4763-8749-1b2abae1b451", Ros6: "06aab855-07d6-4e9c-8e4e-1cc752e4e587", Paf9: "ddb9fd47-614d-467a-980f-88b4b89c708c", Paf10: "09d600ec-41b9-45c7-b0b4-0f2ef478e6f7", Paf11: "846dba04-38d9-4a98-83d4-c846e422c6af", Paf12: "73c6cf61-d7e4-4fa1-bcd0-34e36113ed45" };
const AGORA = Date.parse("2026-10-30T15:36:30Z");
const VALOR = 0.1825;

function estender(ent: EntradaEscala, nDias: number): EntradaEscala {
  const slots = [...ent.slots];
  const sexta = ent.slots.filter((s) => s.data === "2026-10-30");
  for (let k = 1; k <= nDias; k++) {
    const dMs = 86400000 * (k + 3);
    sexta.forEach((s, i) => {
      const dt = new Date(Date.parse(s.data + "T12:00:00Z") + dMs).toISOString().slice(0, 10);
      slots.push({ ...s, data: dt, indice: slots.length, primeiroDoDia: i === 0, inicioMs: s.inicioMs + dMs, fimMs: s.fimMs + dMs });
    });
  }
  return { ...ent, slots };
}

function rodar(id: string, dias: number, mod: (e: EntradaEscala) => EntradaEscala, soHoje = false) {
  const e = montarEstadoAting(d, AGORA, V["08:59"].linhas, 127, { fluxoMesmoPeriodo: false }, true);
  const ent = mod(dias > 0 ? estender(e.entrada, dias) : e.entrada);
  const r = planejarComFluxo(ent, e.dados, e.opcoes);
  const idx = new Map(ent.slots.map((s) => [`${s.data}|${s.periodoId}`, s.indice]));
  const por: Record<string, number[]> = {};
  Object.keys(NODES).forEach((k) => (por[k] = new Array(ent.slots.length).fill(0)));
  r.resultado.alocacoes.filter((a) => a.maquinaId && a.produtoId && a.etapaId).forEach((a) => {
    const kk = Object.entries(NODES).find(([, v]) => v === chavePool(a.produtoId!, a.etapaId!));
    const t = idx.get(`${a.data}|${a.periodoId}`)!;
    if (kk && t >= 27) por[kk[0]][t]++;
  });
  const av: any = r.diagnostico.avaliacaoFluxo;
  const con = av.produtos.filter((p: any) => nome(p.produtoId).startsWith("Con3/4"));
  const finalCon = con.reduce((s: number, p: any) => s + p.finalEntregue.lo, 0);
  const pp = (k: string, a = 27, b = ent.slots.length) => por[k].slice(a, b).reduce((s, v) => s + v, 0);
  const trajPaf = av.trajetoria.find((t: any) => t.chave === NODES.Paf);
  console.log(`\n## ${id} | horizonte ${ent.slots.length - 27} períodos | escolhido ${r.diagnostico.planoEscolhido} | final Con3/4 (lo) ${Math.round(finalCon)} pç = R$ ${Math.round(finalCon * VALOR)} | falta total ${Math.round(av.totais.faltaFinalLo)} | final total ${Math.round(av.totais.finalEntregueLo)}`);
  console.log("   pessoa-períodos na cadeia (Ros/Paf/M8/Eti/Emb):", ["Ros", "Paf", "M8", "Eti", "Emb"].map((k) => `${k}=${pp(k)}`).join(" "));
  console.log("   por período Ros/Paf/M8/Eti/Emb:", ent.slots.slice(27).map((s, i) => `${s.periodoId}:${["Ros", "Paf", "M8", "Eti", "Emb"].map((k) => por[k][27 + i]).join("")}`).join(" "));
  console.log("   W(Paf→Eti) fim do slot:", trajPaf ? trajPaf.porSlot.map((p: any) => Math.round(p.lo)).join(",") : "-");
  const trajRos = av.trajetoria.find((t: any) => t.chave === NODES.Ros);
  console.log("   W(Ros→Paf) fim do slot:", trajRos ? trajRos.porSlot.map((p: any) => Math.round(p.lo)).join(",") : "-");
  const trajEtiEmb = av.trajetoria.find((t: any) => t.chave === NODES.Eti);
  console.log("   W(Eti→Emb) fim do slot:", trajEtiEmb ? trajEtiEmb.porSlot.map((p: any) => Math.round(p.lo)).join(",") : "-");
  return { id, finalCon, por };
}
const indisp = (ms: string[]) => (e: EntradaEscala) => ({ ...e, maquinasIndisponiveisPrevisao: [...e.maquinasIndisponiveisPrevisao, ...ms] });
const H = Number(process.env.DIAS ?? 2);
rodar("H0 padrão", H, (e) => e);
rodar("H5 equivalência ON (M8 expõe Ros e Paf)", H, (e) => ({ ...e, equivalenciaOperacoes: { "15625032-5785-4781-b901-6f1cdc24fdf9": ["bb9da8be-d30c-4b0a-a7a2-537e23e16bdb", "11c45ab6-3feb-422b-8443-fb0fbd142361"] } }));
