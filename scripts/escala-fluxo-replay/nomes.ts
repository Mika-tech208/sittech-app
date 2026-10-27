import { carregarDecisoes, carregarNomes } from "./dados";

const nomes = carregarNomes();
const dec = carregarDecisoes();
const pools = dec[dec.length - 1].entrada.pools;
const opPorEtapa = new Map(pools.map((p) => [p.etapaId, p.operacaoId]));

export const nomeProduto = (id: string) => (nomes[id] ?? id.slice(0, 8)).trim().replace('Conector 3/4" - Maquina Automatica', "Conector 3/4 Autom.").replace('Conector 3/4"', "Conector 3/4 Conv.");
export const nomeMaquina = (id: string) => (nomes[id] ?? id.slice(0, 8)).trim();
export const nomeEtapa = (etapaId: string) => { const op = opPorEtapa.get(etapaId); return op ? (nomes[op] ?? op.slice(0, 8)) : etapaId.slice(0, 8); };
export const rotuloPool = (chave: string) => { const [p, e] = chave.split("|"); return `${nomeProduto(p)} · ${nomeEtapa(e)}`; };
export const rotuloPar = (produtoId: string, origem: string) => `${nomeProduto(produtoId)} · ${nomeEtapa(origem)}→`;
