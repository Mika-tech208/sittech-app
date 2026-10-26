"use client";

// Previsão Semanal — produto de ROTAS (M3): a pessoa marca, por etapa, quais máquinas valem NESTA semana. Tudo começa DESMARCADO (o cadastro só diz o que a máquina PODE fazer; o sistema nunca marca
// nem acrescenta máquina). A prévia recalcula a cada marcação e é uma ESTIMATIVA NOMINAL (não garantia): pessoas, revezamento e períodos só a Escala confirma.
// A interface mostra o produto único e, abaixo, "Rota convencional", "Rota automática" e "Fluxo comum" — nunca as cadeias internas do adaptador.
import { useMemo } from "react";
import { previaComCompartilhamento, type ItemSelecionado, type MetasDaEtapa } from "./compartilhada";
import type { ContextoCusto } from "./custo";
import type { ContextoCapacidade, EstruturaProduto, EtapaCadastro } from "./tipos";

const n = (v: number) => (Number.isFinite(v) ? Math.round(v).toLocaleString("pt-BR") : "∞");
const hh = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h`;
const BRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const TITULO_ROTA: Record<string, string> = { CONV: "ROTA CONVENCIONAL", AUTO: "ROTA AUTOMÁTICA" };

export interface RealizavelDaEscala { porRota: Record<string, number>; final?: number; observacao?: string }

export interface SelecaoRotasPrevisaoProps {
  estrutura: EstruturaProduto;
  etapas: Map<string, EtapaCadastro>;
  nomeMaquina: (id: string) => string;
  maquinasIndisponiveis: string[];
  selecao: Record<string, string[]>;
  onToggleMaquina: (etapaId: string, maquinaId: string) => void;
  demanda: number;
  ctx: ContextoCapacidade;
  outros: ItemSelecionado[];                               // demais itens da semana (quem também escolheu máquinas)
  etapasDosOutros: Map<string, MetasDaEtapa>;
  custo?: ContextoCusto; valorUnitario?: number;
  realizavel?: RealizavelDaEscala | null;                  // vindo da última Escala (escala_rota_divisao); ausente = ainda não calculado
}

function Caixa({ titulo, valor, sub, tom }: { titulo: string; valor: string; sub?: string; tom?: "erro" | "ok" | "neutro" }) {
  const cor = tom === "erro" ? "var(--danger)" : tom === "ok" ? "var(--accent)" : "var(--border)";
  return (
    <div style={{ border: `${tom && tom !== "neutro" ? 2 : 1}px solid ${cor}`, borderRadius: 10, padding: "6px 10px", minWidth: 118, flex: "1 1 auto" }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, color: "var(--text-muted)" }}>{titulo}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: tom === "erro" ? "var(--danger)" : "var(--text)" }}>{valor}</div>
      {sub && <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{sub}</div>}
    </div>
  );
}

export default function SelecaoRotasPrevisao(p: SelecaoRotasPrevisaoProps) {
  const { estrutura, etapas } = p;
  const marcadas = useMemo(() => new Set(Object.values(p.selecao).flat()), [p.selecao]);
  const previa = useMemo(() => {
    try {
      return previaComCompartilhamento({
        itemId: "__produto_de_rotas", estrutura, etapas, demanda: p.demanda, ctx: { ...p.ctx, maquinasIndisponiveis: p.maquinasIndisponiveis }, selecao: p.selecao,
        outros: p.outros, etapasDosOutros: p.etapasDosOutros, custo: p.custo, valorUnitario: p.valorUnitario,
      });
    } catch { return null; }
  }, [estrutura, etapas, p.demanda, p.ctx, p.maquinasIndisponiveis, p.selecao, p.outros, p.etapasDosOutros, p.custo, p.valorUnitario]);

  // quem MAIS marcou cada máquina (para a etiqueta "compartilhada com …")
  const outrosPorMaquina = useMemo(() => {
    const m = new Map<string, string[]>();
    p.outros.forEach((o) => Object.values(o.selecao).flat().forEach((id) => { const l = m.get(id) ?? []; if (!l.includes(o.produtoNome ?? o.itemId)) l.push(o.produtoNome ?? o.itemId); m.set(id, l); }));
    return m;
  }, [p.outros]);
  const detalhe = (id: string) => previa?.compartilhadas.find((c) => c.maquinaId === id);

  const grupos: { chave: string; titulo: string; etapas: string[] }[] = [
    ...estrutura.rotas.filter((r) => r.ativa).map((r) => ({ chave: r.codigo, titulo: TITULO_ROTA[r.codigo] ?? `ROTA ${r.nome.toUpperCase()}`, etapas: r.etapas })),
    ...(estrutura.poolComum ? [{ chave: "COMUM", titulo: "FLUXO COMUM", etapas: estrutura.poolComum.etapas }] : []),
  ];
  const plano = previa?.plano;
  const nenhuma = marcadas.size === 0;
  const etiq = plano?.poolComum.porOperacao.Etiquetar, emb = plano?.poolComum.porOperacao.Embalar;

  return (
    <div className="stx-custos-builder">
      <p className="stx-custos-builder-title">Máquinas desta semana (você escolhe — nada vem marcado)</p>
      {grupos.map((g) => (
        <div key={g.chave} style={{ marginBottom: 8 }}>
          <p className="stx-panel-sub" style={{ margin: "0 0 4px", fontWeight: 700, color: g.chave === "COMUM" ? "var(--accent)" : "var(--blueprint)" }}>{g.titulo}</p>
          {g.etapas.map((id) => {
            const e = etapas.get(id) as EtapaCadastro;
            const elegiveis = e.maquinasIds.filter((m) => !p.maquinasIndisponiveis.includes(m));
            const sel = p.selecao[id] ?? [];
            return (
              <div className="stx-etapa-card" key={id}>
                <p className="stx-panel-sub" style={{ margin: "0 0 6px 0", fontWeight: 600 }}>{e.operacao}</p>
                {elegiveis.length === 0 ? <p className="stx-panel-sub" style={{ margin: 0 }}>Nenhuma máquina disponível para esta etapa nesta semana.</p> : (
                  <div className="stx-etapa-maquinas">
                    {elegiveis.map((m) => {
                      const com = outrosPorMaquina.get(m);
                      const d = detalhe(m);
                      return (
                        <label className="stx-maquina-chip" key={m} title={com ? `Também marcada em: ${com.join(", ")}` : undefined}>
                          <input type="checkbox" checked={sel.includes(m)} onChange={() => p.onToggleMaquina(id, m)} />
                          {p.nomeMaquina(m)}
                          {com && <span style={{ marginLeft: 6, fontSize: 11, color: "var(--warning)" }}>compartilhada com {com.join(", ")}</span>}
                          {d && sel.includes(m) && (
                            <span style={{ marginLeft: 6, fontSize: 11, color: "var(--text-muted)" }}>
                              total {hh(d.horasTotais)} · já pedido por outros {hh(d.reivindicadoPorOutros)} · restante estimado {hh(d.restanteEstimado)}
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}

      <div className="stx-resumo-ao-vivo" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>Prévia — CAPACIDADE NOMINAL <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>(estimativa com as máquinas marcadas; não é garantia de produção)</span></div>
        {nenhuma || !plano ? (
          <p className="stx-panel-sub" style={{ margin: 0 }}>Marque as máquinas de cada etapa para ver a capacidade. O sistema não escolhe máquinas por você.</p>
        ) : (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Caixa titulo="DEMANDA FINAL" valor={n(plano.demandaFinal)} />
              {Object.values(plano.capacidadePorRota).map((r) => <Caixa key={r.rotaCodigo} titulo={`${r.rotaCodigo} POSSÍVEL`} valor={n(r.realizavel)} sub={r.limitante ? `limita: ${r.limitante.operacao}` : "sem máquina marcada"} />)}
              <Caixa titulo="ETIQUETAR POSSÍVEL" valor={n(etiq ?? 0)} tom={plano.gargalo?.tipo === "comum" && plano.gargalo.operacao === "Etiquetar" ? "erro" : "neutro"} />
              <Caixa titulo="EMBALAR POSSÍVEL" valor={n(emb ?? 0)} tom={plano.gargalo?.tipo === "comum" && plano.gargalo.operacao === "Embalar" ? "erro" : "neutro"} />
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Caixa titulo="PRODUTO FINAL POSSÍVEL" valor={`${n(plano.finalAtingivel)} / ${n(plano.demandaFinal)}`} tom={plano.falta > 0 ? "erro" : "ok"} />
              <Caixa titulo="FALTA" valor={n(plano.falta)} tom={plano.falta > 0 ? "erro" : "neutro"} />
              <Caixa titulo="ATINGIBILIDADE" valor={`${plano.percentualAtingivel.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`} tom={plano.falta > 0 ? "erro" : "ok"} />
              <Caixa titulo="GARGALO" valor={plano.gargalo === null ? "—" : plano.gargalo.tipo === "comum" ? plano.gargalo.operacao : "Entrada"} sub={plano.gargalo?.tipo === "entrada" ? plano.gargalo.limitantes.map((l) => `${l.rotaCodigo}/${l.operacao}`).join(" + ") : plano.gargalo ? "fluxo comum (corta as duas rotas)" : "demanda atendida"} tom={plano.gargalo ? "erro" : "ok"} />
            </div>
            <div style={{ fontSize: 13 }}>
              <b>Divisão proposta:</b> {Object.keys(plano.alvo).map((c) => `${TITULO_ROTA[c]?.replace("ROTA ", "") ?? c} ${n(plano.alvo[c])}`).join(" + ")} = {n(Object.values(plano.alvo).reduce((s, v) => s + v, 0))} entregues ao fluxo comum (só o que será consumido)
              {plano.custo?.economiaAuto && plano.custo.economiaAuto.volume > 0 && <> · economia da automática ≈ {BRL(plano.custo.economiaAuto.total)}</>}
            </div>
            {previa && previa.compartilhadas.length > 0 && (
              <div style={{ fontSize: 12.5, color: "var(--warning)" }}>
                Máquina compartilhada: {previa.compartilhadas.map((c) => `${p.nomeMaquina(c.maquinaId)} (${c.porItem.filter((x) => x.produtoNome).map((x) => x.produtoNome).join(", ") || "outro item"})`).join(" · ")}. A divisão por período é decidida pela Escala; a estimativa acima não reserva a máquina.
              </div>
            )}
            <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
              <b>CAPACIDADE REALIZÁVEL</b> (equipe, revezamento, ausências e conflitos): {p.realizavel
                ? <>{Object.entries(p.realizavel.porRota).map(([r, v]) => `${r} ${n(v)}`).join(" · ")}{p.realizavel.final !== undefined ? ` · final ${n(p.realizavel.final)}` : ""}{p.realizavel.observacao ? ` — ${p.realizavel.observacao}` : ""}</>
                : "aparece depois que a Escala for gerada; até lá os números acima são só nominais."}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
