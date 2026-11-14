// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import PainelMetasTv from "../PainelMetasTv";
import { montarModeloTv, type PayloadMetasTv } from "../metasTv";

const ap = (id: string, boas: number) => ({ produto_id: id, etapa_id: `${id}-f`, operacao_id: "o", quantidade_boa: boas, n_apontamentos: 2, etapa_ordem: 1, etapa_operacao_id: "o", ultima_ordem: 1, n_na_ultima_ordem: 1, ultima_operacao_id: "o" });
const payload: PayloadMetasTv = {
  agora: "2026-11-14T18:32:00Z", semana_inicio: "2026-11-09", semana_fim: "2026-11-15", existe: true,
  produtos: [
    { produto_id: "a", nome: "Pino", meta: 108000, encerrado: false }, { produto_id: "b", nome: "Plug Macho", meta: 33000, encerrado: false },
    { produto_id: "c", nome: "Conector 3\"", meta: 500, encerrado: false }, { produto_id: "d", nome: "Caixa Amarela 4x2", meta: 56400, encerrado: true },
  ],
  apontado: [ap("a", 78953), ap("b", 33000), ap("c", 1535), ap("d", 27930)],
};

describe("PainelMetasTv", () => {
  it("mostra meta, produzido, percentual, faltam / meta atingida + excedente e o encerrado à parte — sem nenhum R$", () => {
    cleanup();
    const { container } = render(<PainelMetasTv modelo={montarModeloTv(payload)} atualizadoEm="15:32" conexao="ok" slideFixo={0} />);
    expect(screen.getByText("Produção da semana")).toBeTruthy();
    expect(screen.getByText("09/11 a 15/11")).toBeTruthy();
    expect(screen.getByText("Atualizado às 15:32")).toBeTruthy();
    expect(screen.getByText("29.047")).toBeTruthy(); // faltam (Pino)
    expect(screen.getAllByText("Meta atingida").length).toBe(2); // Plug (100%) e Conector 3" (acima)
    expect(screen.getByText("+1.035")).toBeTruthy(); // excedente
    expect(screen.getByText(/Encerrado:/).textContent).toContain("27.930");
    const visivel = container.cloneNode(true) as HTMLElement; visivel.querySelectorAll("style").forEach((n) => n.remove());
    expect(visivel.textContent).not.toMatch(/R\$|valor|custo|margem|lucro|faturamento/i);
    // acessível sem depender de cor: cada card descreve o estado em texto
    expect(screen.getByLabelText(/Pino: 73,1% da meta de 108.000 peças\. Faltam 29\.047 peças\./)).toBeTruthy();
  });
  it("conexão pendente avisa em texto; semana sem previsão mostra estado vazio explicativo", () => {
    cleanup();
    render(<PainelMetasTv modelo={montarModeloTv({ ...payload, produtos: [], apontado: [], existe: false })} atualizadoEm="15:10" conexao="pendente" slideFixo={0} />);
    expect(screen.getByRole("status").textContent).toContain("Atualização pendente");
    expect(screen.getByText("Previsão da semana ainda não cadastrada")).toBeTruthy();
  });
});
