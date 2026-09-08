import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import IntelligenceEvidenceList from "@/features/intelligence/components/IntelligenceEvidenceList";
import type { IntelligenceEvidence } from "@/features/intelligence/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const EVIDENCIA: IntelligenceEvidence = {
  id: "ev1",
  domain: "producao",
  metric: "Performance",
  value: 82.4,
  unit: "%",
  confidence: "CALCULADO",
  source: "calcularResumoIndicadores",
  context: { maquinaNome: "Embalagem 17" },
  period: { start: "2026-09-01", end: "2026-09-07", label: "Semana atual" },
  drillDown: "/producao-real/indicadores",
};

describe("IntelligenceEvidenceList — §12/§13/§14 da instrução", () => {
  it("lista vazia não renderiza nada (nunca um cabeçalho de seção vazio)", () => {
    const { container } = render(<IntelligenceEvidenceList evidencias={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("começa recolhido (compacto) e mostra a contagem no cabeçalho", () => {
    render(<IntelligenceEvidenceList evidencias={[EVIDENCIA]} />);
    expect(screen.getByText("Evidências (1)")).toBeInTheDocument();
    expect(screen.queryByText("Performance")).not.toBeInTheDocument();
  });

  it("ao expandir, mostra métrica, valor formatado (1 casa, não o valor bruto), confiança e contexto", () => {
    render(<IntelligenceEvidenceList evidencias={[EVIDENCIA]} />);
    fireEvent.click(screen.getByText("Evidências (1)"));
    expect(screen.getByText("Performance")).toBeInTheDocument();
    expect(screen.getByText("82,4%")).toBeInTheDocument();
    expect(screen.getByText("Calculado")).toBeInTheDocument();
    expect(screen.getByText("Embalagem 17 · Semana atual")).toBeInTheDocument();
    expect(screen.getByText("Ver dados")).toBeInTheDocument();
  });

  it("sem drillDown, não mostra botão 'Ver dados'", () => {
    render(<IntelligenceEvidenceList evidencias={[{ ...EVIDENCIA, drillDown: undefined }]} />);
    fireEvent.click(screen.getByText("Evidências (1)"));
    expect(screen.queryByText("Ver dados")).not.toBeInTheDocument();
  });
});
