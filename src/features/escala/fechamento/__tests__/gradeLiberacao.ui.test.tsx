import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import GradeEscala from "../../components/GradeEscala";
import type { AlocacaoLinha, DiaEscala, Nomes } from "@/hooks/useEscalaProducao";

afterEach(() => cleanup());
const dia = { data: "2026-11-04", periodos: [{ id: "m2", nome: "M2", inicio: "08:48", fim: "10:24" }, { id: "m3", nome: "M3", inicio: "10:24", fim: "11:55" }] } as unknown as DiaEscala;
const nomes = { funcionarios: new Map([["f1", "Fulano"]]), maquinas: new Map([["q1", "Montagem 18"]]), produtos: new Map(), operacoes: new Map() } as unknown as Nomes;
const aloc = (periodoId: string) => ({ periodoId, funcionarioId: "f1", maquinaId: "q1", produtoId: null, operacaoId: null, origem: "auto" }) as unknown as AlocacaoLinha;

describe("Escala interna: planejamento futuro com cara de ESTIMADO", () => {
  it("período não liberado ganha 'ESTIMADO — NÃO LIBERADO'; liberado (transição) não; sem informação do banco não inventa selo", () => {
    render(<GradeEscala dia={dia} alocacoes={[aloc("m2"), aloc("m3")]} funcionarios={["f1"]} nomes={nomes} agoraMs={Date.parse("2026-11-04T13:30:00Z")} onEditar={() => undefined}
      liberacao={{ m2: { liberado: true, motivo: "TRANSICAO" }, m3: { liberado: false, motivo: "AGUARDANDO_FECHAMENTO" } }} />);
    const selos = screen.getAllByTestId("nao-liberado");
    expect(selos).toHaveLength(1); expect(selos[0].textContent).toBe("ESTIMADO — NÃO LIBERADO");
    expect(selos[0].closest("th")!.textContent).toContain("M3");
    cleanup();
    render(<GradeEscala dia={dia} alocacoes={[aloc("m2")]} funcionarios={["f1"]} nomes={nomes} agoraMs={0} onEditar={() => undefined} liberacao={null} />);
    expect(screen.queryByTestId("nao-liberado")).toBeNull();
  });
});
