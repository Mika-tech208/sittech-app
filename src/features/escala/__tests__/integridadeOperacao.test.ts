import { describe, expect, it } from "vitest";
import { canonizarApontamentos, etapaCanonica, resumirIntegridade, type EtapaRoteiro } from "../integridadeOperacao";

// Roteiro ATUAL da Caixa Amarela depois da troca de 21/10: c765 = Etiquetar (0), f75c = Montar Presilha (1)
const ETIQ = "op-etiquetar", PRES = "op-presilha";
const roteiro: EtapaRoteiro[] = [
  { id: "c765", produtoId: "CX", operacaoId: ETIQ, ordem: 0 },
  { id: "f75c", produtoId: "CX", operacaoId: PRES, ordem: 1 },
  { id: "x1", produtoId: "LV", operacaoId: "op-rosq", ordem: 0 },
];
const ap = (etapaId: string | null, operacaoId: string | null, produtoId: string | null = "CX") => ({ produtoId, etapaId, operacaoId });

describe("etapaCanonica", () => {
  it("linha coerente permanece", () => expect(etapaCanonica(ap("c765", ETIQ), roteiro)).toEqual({ etapaId: "c765", ordem: 0, motivo: "coerente" }));
  it("linha pré-troca (c765 gravado com Montar Presilha) vai para a etapa atual de Montar Presilha", () => {
    expect(etapaCanonica(ap("c765", PRES), roteiro)).toEqual({ etapaId: "f75c", ordem: 1, motivo: "etapa_trocou_de_operacao" });
    expect(etapaCanonica(ap("f75c", ETIQ), roteiro)).toEqual({ etapaId: "c765", ordem: 0, motivo: "etapa_trocou_de_operacao" });
  });
  it("operação que não existe mais no roteiro ⇒ sem equivalente (não inventa)", () => expect(etapaCanonica(ap("c765", "op-x"), roteiro).motivo).toBe("sem_etapa_equivalente"));
  it("operação repetida no roteiro ⇒ ambígua (não escolhe)", () => {
    const r2 = [...roteiro, { id: "dup", produtoId: "CX", operacaoId: PRES, ordem: 2 }];
    expect(etapaCanonica(ap("c765", PRES), r2)).toEqual({ etapaId: null, ordem: null, motivo: "ambigua" });
  });
  it("sem produto/operação ⇒ sem_dados", () => expect(etapaCanonica(ap("c765", null), roteiro).motivo).toBe("sem_dados"));
  it("não cruza produtos", () => expect(etapaCanonica(ap("x1", "op-rosq", "LV"), roteiro).motivo).toBe("coerente"));
});

describe("canonizarApontamentos", () => {
  const linhas = [ap("c765", PRES), ap("f75c", ETIQ), ap("c765", ETIQ), ap("c765", "op-x"), ap("x1", "op-rosq", "LV")];
  it("reescreve só as inequívocas, audita todas as reclassificadas, não muta a entrada", () => {
    const copia = JSON.stringify(linhas);
    const r = canonizarApontamentos(linhas, roteiro);
    expect(r.linhas.map((l) => l.etapaId)).toEqual(["f75c", "c765", "c765", "c765", "x1"]);
    expect(r.auditoria.map((a) => a.motivo)).toEqual(["etapa_trocou_de_operacao", "etapa_trocou_de_operacao", "sem_etapa_equivalente"]);
    expect(JSON.stringify(linhas)).toBe(copia);
    expect(resumirIntegridade(r.auditoria, linhas.length)).toMatchObject({ coerente: 2, etapa_trocou_de_operacao: 2, sem_etapa_equivalente: 1 });
  });
  it("idempotente: canonizar de novo não muda nada e não gera auditoria nova", () => {
    const um = canonizarApontamentos(linhas, roteiro);
    const dois = canonizarApontamentos(um.linhas, roteiro);
    expect(dois.linhas).toEqual(um.linhas);
    expect(dois.auditoria.map((a) => a.motivo)).toEqual(["sem_etapa_equivalente"]);
  });
});
