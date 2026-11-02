// supabaseIO — a distribuição por produto atravessa a RPC (aplicar) e volta na leitura (lerDistribuicao); linha de um só produto NÃO leva a chave (RPC antiga/nova recebem o mesmo payload de antes).
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { criarEscalaIO } from "../supabaseIO";
import { lerDistribuicao } from "@/features/escala/distribuicao";
import type { AlocacaoEscala } from "@/features/escala/types";
import type { PayloadAplicacao } from "../estado";

const base = { data: "2026-11-03", periodoId: "m1", pecasAdicional: 0, motivoSemPosto: null, excecaoRevezamento: false, motivoExcecao: null, origem: "auto" as const };
const compartilhada: AlocacaoEscala = { ...base, funcionarioId: "f1", maquinaId: "mq", produtoId: "pC", etapaId: "eC", operacaoId: "op", pecas: 300, distribuicao: [{ produtoId: "pC", etapaId: "eC", pecas: 200 }, { produtoId: "pA", etapaId: "eA", pecas: 100 }] };
const simples: AlocacaoEscala = { ...base, funcionarioId: "f2", maquinaId: "mq2", produtoId: "pX", etapaId: "eX", operacaoId: "op2", pecas: 50 };
const semPosto: AlocacaoEscala = { ...base, funcionarioId: "f3", maquinaId: null, produtoId: null, etapaId: null, operacaoId: null, pecas: 0, motivoSemPosto: "Demanda da Previsão esgotada" };

describe("supabaseIO.aplicar × distribuição", () => {
  it("envia `distribuicao` (snake_case) só nas linhas compartilhadas e a relê igual", async () => {
    let args: Record<string, unknown> = {};
    const admin = { rpc: async (_n: string, a: Record<string, unknown>) => { args = a; return { data: { versoes: { "2026-11-03": 2 } }, error: null }; } } as unknown as SupabaseClient;
    const p: PayloadAplicacao = { previsaoId: "prev", dias: [], aPartirDeData: "2026-11-03", aPartirDePeriodo: "m1", alocacoes: [compartilhada, simples, semPosto], removerDias: [], usuarioId: null, eventoIds: [], resumo: {} };
    const r = await criarEscalaIO(admin, "prev").aplicar(p);
    expect(r.versoes["2026-11-03"]).toBe(2);
    const linhas = args.p_alocacoes as Record<string, unknown>[];
    expect(linhas[0].distribuicao).toEqual([{ produto_id: "pA", etapa_id: "eA", pecas: 100 }, { produto_id: "pC", etapa_id: "eC", pecas: 200 }]); // ordem canônica (produto|etapa)
    expect("distribuicao" in linhas[1]).toBe(false);
    expect("distribuicao" in linhas[2]).toBe(false);
    // ida e volta: o que o banco devolve (jsonb snake_case) vira a mesma distribuição
    expect(lerDistribuicao(linhas[0].distribuicao)).toEqual([{ produtoId: "pA", etapaId: "eA", pecas: 100 }, { produtoId: "pC", etapaId: "eC", pecas: 200 }]);
    expect(lerDistribuicao(null)).toBeUndefined();
    expect(lerDistribuicao([])).toBeUndefined();
    expect(lerDistribuicao([{ produto_id: 1 }])).toBeUndefined(); // malformado: ignorado, nunca lança
  });
});
