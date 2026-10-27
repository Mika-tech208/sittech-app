// GOLDEN-MASTER: com os hooks do fluxo ausentes (ou vazios) a saída do motor é BYTE-IDÊNTICA à do motor anterior.
// Referência: cópia congelada do gerarEscala.ts de antes dos hooks (gerarEscalaAntes.ts).
import { describe, it, expect } from "vitest";
import { gerarEscala } from "../../gerarEscala";
import { hashAlocacoes } from "../../horizonte";
import { paraParametrosCorte } from "../../snapshotSombra";
import { executarCorteSombra } from "../../sombraCorte";
import { cenariosGolden } from "../../__tests__/cenariosGolden";
import { gerarEscala as gerarEscalaAntes } from "./gerarEscalaAntes";
import { carregarFixtures, montarDeCanonica } from "./fixturesReais";

const j = (v: unknown) => JSON.stringify(v);

describe("golden-master: cenários fixos do motor", () => {
  cenariosGolden().forEach((c) => {
    it(`${c.nome}: idêntico ao motor anterior`, () => {
      expect(j(gerarEscala(c.entrada))).toBe(j(gerarEscalaAntes(c.entrada)));
    });
  });

  it("hooks presentes porém vazios não alteram nada", () => {
    cenariosGolden().slice(0, 6).forEach((c) => {
      const com = { ...c.entrada, remPorPool: {}, ordemPostos: { valorMarginal: {} }, bonusContinuidade: {} };
      expect(j(gerarEscala(com))).toBe(j(gerarEscalaAntes(c.entrada)));
    });
  });
});

describe("golden-master: instantâneos REAIS de escala_sombra_decisoes.entrada (PROD 27/10)", () => {
  const fx = carregarFixtures();
  Object.entries(fx).forEach(([nome, f]) => {
    it(`${nome}: gerarEscala antes × depois (entrada do fluxo, com e sem adicional/WIP)`, () => {
      const a = montarDeCanonica(f.entrada);
      expect(j(gerarEscala(a.entrada))).toBe(j(gerarEscalaAntes(a.entrada)));
      const b = montarDeCanonica(f.entrada, { semAdicional: true });
      expect(j(gerarEscala(b.entrada))).toBe(j(gerarEscalaAntes(b.entrada)));
      // semana inteira do zero e com aPartirDe deslocado
      expect(j(gerarEscala({ ...a.entrada, aPartirDe: 0, congeladas: [] }))).toBe(j(gerarEscalaAntes({ ...a.entrada, aPartirDe: 0, congeladas: [] })));
    });

    it(`${nome}: o pipeline da sombra reproduz o PLANO gravado em PROD (o hash da decisão muda de propósito com a correção do f duplicado, motor 4d.2)`, () => {
      const dec = executarCorteSombra(paraParametrosCorte(f.entrada));
      // o plano proposto não depende da projeção do oficial: tem que ser byte-idêntico ao gravado em PROD
      expect(hashAlocacoes([...dec.horizonte.comprometidas, ...dec.horizonte.alteravel])).toBe(f.hashPlanoSombra);
      // o hash da DECISÃO inclui as faltas projetadas (oficial × sombra), que a correção do f duplicado (Pacote G) altera de propósito
      expect(typeof dec.hashDecisao).toBe("string");
    });
  });
});
