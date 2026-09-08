import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import IntelligenceComposer from "@/features/intelligence/components/IntelligenceComposer";

describe("IntelligenceComposer — §6 da instrução", () => {
  it("Enter (sem Shift) envia; Shift+Enter não envia (quebra linha)", () => {
    const onEnviar = vi.fn();
    render(<IntelligenceComposer valor="Como está minha fábrica?" onChange={() => {}} onEnviar={onEnviar} enviando={false} />);
    const textarea = screen.getByLabelText("Pergunta para a Sittech Intelligence");

    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(onEnviar).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    expect(onEnviar).toHaveBeenCalledTimes(1);
  });

  it("Enter com campo vazio não envia (nunca dispara pergunta em branco)", () => {
    const onEnviar = vi.fn();
    render(<IntelligenceComposer valor="   " onChange={() => {}} onEnviar={onEnviar} enviando={false} />);
    fireEvent.keyDown(screen.getByLabelText("Pergunta para a Sittech Intelligence"), { key: "Enter" });
    expect(onEnviar).not.toHaveBeenCalled();
  });

  it("enquanto enviando=true, o botão de enviar fica desabilitado (nunca envio duplicado)", () => {
    render(<IntelligenceComposer valor="pergunta" onChange={() => {}} onEnviar={() => {}} enviando />);
    expect(screen.getByLabelText("Enviar pergunta")).toBeDisabled();
  });

  it("placeholder é exatamente o pedido na instrução", () => {
    render(<IntelligenceComposer valor="" onChange={() => {}} onEnviar={() => {}} enviando={false} />);
    expect(screen.getByPlaceholderText("Pergunte sobre sua operação...")).toBeInTheDocument();
  });
});
