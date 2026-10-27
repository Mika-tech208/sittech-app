"use client";

// Cadastro de produto de ROTAS (tela Produtos): mostra CONV, AUTO e FLUXO COMUM — nunca "Rosquear → Parafusar → Automática → Etiquetar → Embalar" — e o custo por rota (exclusivo, comum, final via cada rota).
import type { Maquina, PeriodoComDuracao, Produto } from "@/types/domain";
import { custoDoProdutoDeRotas } from "./produtoCusto";

const NOME: Record<string, string> = { CONV: "Rota convencional", AUTO: "Rota automática" };

export default function FluxoProdutoRotas({ produto, maquinas, periodosComDuracao, custoHoraPorOperacao, custoHoraEmpresa, formatBRL }: {
  produto: Produto; maquinas: Maquina[]; periodosComDuracao: PeriodoComDuracao[]; custoHoraPorOperacao: Record<string, number>; custoHoraEmpresa: number; formatBRL: (v: number) => string;
}) {
  const estrutura = produto.estruturaRotas;
  if (!estrutura) return null;
  const etapa = (id: string) => produto.roteiro.find((e) => e.id === id);
  const texto = (ids: string[]) => ids.map((id) => {
    const e = etapa(id); if (!e) return "";
    const ms = maquinas.filter((m) => e.maquinasIds.includes(m.id)).map((m) => m.nome.trim());
    return `${e.operacao}${ms.length ? ` (${ms.join(", ")})` : ""}`;
  }).filter(Boolean).join(" → ");
  const c = custoDoProdutoDeRotas(produto, custoHoraPorOperacao, custoHoraEmpresa, periodosComDuracao);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5 }}>
      {estrutura.rotas.filter((r) => r.ativa).map((r) => <p key={r.codigo} className="stx-prod-fluxo" style={{ margin: 0 }}><b>{NOME[r.codigo] ?? r.nome}:</b> {texto(r.etapas)}</p>)}
      {estrutura.poolComum && <p className="stx-prod-fluxo" style={{ margin: 0 }}><b>Fluxo comum:</b> {texto(estrutura.poolComum.etapas)}</p>}
      {c && (
        <p className="stx-prod-fluxo" style={{ margin: 0, color: "var(--text-2)" }}>
          Custo por peça — {c.porRota.map((x) => `${NOME[x.rotaCodigo] ?? x.rotaCodigo}: ${formatBRL(c.exclusivoPorRota[x.rotaCodigo])}`).join(" · ")} · fluxo comum: {formatBRL(c.comum)} ·{" "}
          final {c.porRota.map((x) => `via ${x.rotaCodigo === "CONV" ? "CONV" : x.rotaCodigo === "AUTO" ? "AUTO" : x.rotaCodigo}: ${formatBRL(x.final)}`).join(" · ")}
        </p>
      )}
    </div>
  );
}
