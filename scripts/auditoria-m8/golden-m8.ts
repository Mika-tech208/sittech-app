// Imprime os hashes dos planos do mini-Conector com a M8 SELECIONADA (golden-master do comportamento atual). Rodar ANTES e DEPOIS da correção: devem ser iguais.
import { montarEntradaEscala } from "@/lib/escala/montarEntrada";
import { gerarEscala } from "@/features/escala/gerarEscala";
import { hashAlocacoes } from "@/features/escala/horizonte";
import { planejarSemanaComCorte } from "@/features/escala/fluxo/planoCorte";
import { estadoM8, AGORA_VESPERA } from "@/lib/escala/__tests__/m8Fixture";

const e = montarEntradaEscala(estadoM8(), AGORA_VESPERA).entrada;
console.log("legado", hashAlocacoes(gerarEscala(e).alocacoes));
const r = planejarSemanaComCorte(e, { apontamentos: [], agoraMs: AGORA_VESPERA, fechamentoMinutos: 10, planoVigente: [], contagensFisicas: [] }, { fluxoMesmoPeriodo: false }, { objetivo: "EQUILIBRIO", busca: { iter: 40000, reinicios: 1, semente: 1 } });
console.log("corte", r.ok, hashAlocacoes(r.resultado!.alocacoes));
