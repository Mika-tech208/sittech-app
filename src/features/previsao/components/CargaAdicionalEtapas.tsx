"use client";

// Carga adicional POR ETAPA (modo WIP): produto acabado + estoque intermediário. Só apresentação — os números vêm do
// mesmo motor da Escala (rota /api/escala/simular-cobertura) e as regras de validação de `adicionalEtapas.ts`.
// Nada é salvo sem o clique em "Salvar carga adicional"; "Aplicar sugestão" apenas PREENCHE para revisão.

import type { SimulacaoCobertura } from "@/lib/escala/simularCobertura";
import { formatBRL, formatQtd } from "@/lib/format";
import type { PrevisaoItem } from "@/types/domain";
import {
  acabadoDe,
  errosDeEtapas,
  estoqueEntreEtapas,
  linhasSugestaoWip,
  type EtapaRef,
  type RascunhoEtapas,
} from "@/features/previsao/adicionalEtapas";

const pct = (v: number) => `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const horasPessoa = (h: number) => `${h.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h`;

export interface CargaAdicionalEtapasProps {
  itens: PrevisaoItem[];
  etapasDe: (produtoId: string) => EtapaRef[];
  rascunho: RascunhoEtapas;
  onEditar: (itemId: string, etapaId: string, valor: string) => void;
  analise: SimulacaoCobertura | null;
  sugestao: SimulacaoCobertura["sugestaoWip"];
  nomeProd: (id: string) => string;
  nomeEtapa: (id: string | null) => string;
  nomeMaq: (id: string) => string;
  carregando: boolean;
  salvandoOuSimulando: boolean; // desabilita "Salvar" (em simulação ou salvando)
  modoSimulacao: boolean;
  gravando: boolean;
  alterado: boolean;
  temErro: boolean;
  onAplicar: () => void;
  onSalvar: () => void;
  onDesfazer: () => void;
}

export default function CargaAdicionalEtapas(p: CargaAdicionalEtapasProps) {
  const { itens, etapasDe, rascunho, analise, sugestao } = p;
  const linhasSug = sugestao ? linhasSugestaoWip(sugestao, p.nomeProd, (id) => p.nomeEtapa(id), p.nomeMaq) : [];

  return (
    <>
      <div className="stx-cob-bloco">
        <h3>Carga adicional por etapa</h3>
        {itens.map((i) => {
          const etapas = etapasDe(i.produtoId);
          const valores = rascunho[i.id] ?? {};
          const erros = errosDeEtapas(etapas, valores);
          const estoque = estoqueEntreEtapas(etapas, valores);
          const linhaAnalise = analise?.adicional.find((a) => a.produtoId === i.produtoId);
          const acabado = acabadoDe(etapas, valores);
          return (
            <div key={i.id} style={{ marginBottom: 14 }}>
              <div className="stx-cob-linha" style={{ borderBottom: "none", paddingBottom: 0 }}>
                <span><b>{i.produtoNome}</b><small>Previsto {formatQtd(i.quantidade)} · adicional de produto acabado {formatQtd(acabado)} · total programado {formatQtd(i.quantidade + acabado)}</small></span>
                <span>{estoque.length > 0 ? `${formatQtd(estoque.reduce((s, e) => s + e.pecas, 0))} em estoque intermediário` : "sem estoque intermediário"}</span>
              </div>
              {etapas.length === 0 ? (
                <p className="stx-cob-dica">Produto sem roteiro cadastrado.</p>
              ) : (
                <div className="stx-cob-rolagem">
                  <table className="stx-cob-tabela">
                    <thead>
                      <tr><th>Etapa / operação</th><th>Adicional</th>{analise && <th>Absorvido</th>}<th>Destino</th></tr>
                    </thead>
                    <tbody>
                      {etapas.map((e, k) => {
                        const ultima = k === etapas.length - 1;
                        const abs = linhaAnalise?.porEtapa.find((x) => x.etapaId === e.id)?.absorvido;
                        const sobra = estoque.find((x) => x.deEtapaId === e.id);
                        const programado = Number(valores[e.id] ?? 0) || 0;
                        return (
                          <tr key={e.id}>
                            <td>{e.nome}</td>
                            <td>
                              <input
                                className="stx-input stx-cob-input"
                                type="number"
                                min={0}
                                inputMode="numeric"
                                aria-label={`Quantidade adicional de ${i.produtoNome} na etapa ${e.nome}`}
                                aria-invalid={erros[e.id] ? true : undefined}
                                value={valores[e.id] ?? "0"}
                                onChange={(ev) => p.onEditar(i.id, e.id, ev.target.value)}
                              />
                              {erros[e.id] && <small className="stx-cob-neg" style={{ display: "block" }}>{erros[e.id]}</small>}
                            </td>
                            {analise && (
                              <td className={abs !== undefined && programado > 0 && abs + 1e-6 < programado ? "stx-cob-neg" : undefined} title="O que a capacidade ociosa realmente absorve nesta etapa">
                                {abs !== undefined && programado > 0 ? formatQtd(abs) : "—"}
                              </td>
                            )}
                            <td style={{ textAlign: "left" }}>
                              {ultima ? "Produto acabado" : sobra ? `${formatQtd(sobra.pecas)} aguardando ${etapas[k + 1].nome}` : "segue para a próxima etapa"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
        {analise && itens.some((i) => (analise.adicional.find((a) => a.produtoId === i.produtoId)?.porEtapa ?? []).some((x) => x.programado !== undefined && x.programado > 0 && x.absorvido + 1e-6 < x.programado)) && (
          <p className="stx-cob-dica stx-cob-neg">Parte do adicional programado não cabe na capacidade ociosa (em vermelho): essa parte não ocupará ninguém.</p>
        )}
        <p className="stx-cob-dica">
          O adicional é uma camada separada e só ocupa quem ficaria sem posto; o previsto, o atingimento e o faturamento previsto continuam exatamente como estão.
          A última etapa é o <b>produto acabado</b>; o que as etapas anteriores produzem a mais fica em <b>estoque intermediário</b>. Uma etapa não pode passar do que a anterior produz.
        </p>
        <div className="stx-cob-acoes" style={{ marginTop: 10 }}>
          {sugestao && sugestao.itens.length > 0 && (
            <button className="stx-prev-pill-btn" onClick={p.onAplicar} disabled={p.carregando}>Aplicar sugestão</button>
          )}
          <button className="stx-prev-pill-btn-primary" disabled={!p.alterado || p.temErro || p.salvandoOuSimulando || p.gravando} onClick={p.onSalvar}>
            {p.gravando ? "Salvando…" : "Salvar carga adicional"}
          </button>
          {p.alterado && <button className="stx-prev-pill-btn" onClick={p.onDesfazer} disabled={p.gravando}>Desfazer edição</button>}
        </div>
        {p.modoSimulacao && <p className="stx-cob-dica">Em modo simulação a carga adicional só pode ser analisada — saia da simulação para salvar.</p>}
      </div>

      {sugestao && (
        <div className="stx-cob-bloco">
          <h3>Sugestão de carga adicional (acabado + estoque intermediário)</h3>
          {sugestao.itens.length === 0 ? (
            <p className="stx-cob-alerta">Nenhuma carga adicional cabe com as máquinas atualmente selecionadas — verifique se todas as etapas dos produtos previstos têm máquina selecionada.</p>
          ) : (
            <>
              <p className="stx-cob-sub">
                <b>+{formatQtd(sugestao.acabadoTotal)} peças de produto acabado</b> e {formatQtd(sugestao.estoqueTotal)} peças de estoque intermediário.
                {" "}Faturamento potencial do acabado (indicador à parte, <u>não</u> soma ao previsto): <b>{formatBRL(sugestao.valorPotencial)}</b>.
              </p>
              <div className="stx-cob-rolagem">
                <table className="stx-cob-tabela">
                  <thead>
                    <tr><th>Produto</th><th>Etapa / operação</th><th>Máquina / posto</th><th>Qtd adicional</th><th>Destino</th></tr>
                  </thead>
                  <tbody>
                    {linhasSug.map((l) => (
                      <tr key={l.chave}>
                        <td>{l.produto}</td>
                        <td>{l.etapa}</td>
                        <td style={{ textAlign: "left" }}>{l.maquinas.join(", ") || "—"}</td>
                        <td>+{formatQtd(l.quantidade)}</td>
                        <td style={{ textAlign: "left" }}>{l.destino}{l.tipo === "intermediario" && l.estoquePecas > 0 ? ` · ${formatQtd(l.estoquePecas)} pç` : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="stx-cob-rolagem" style={{ marginTop: 10 }}>
                <table className="stx-cob-tabela">
                  <thead><tr><th>Antes → depois</th><th>Só o previsto</th><th>Com a sugestão</th></tr></thead>
                  <tbody>
                    <tr><td>Cobertura da equipe</td><td>{pct(sugestao.antes.percentual)}</td><td>{pct(sugestao.depois.percentual)}</td></tr>
                    <tr><td>Horas-pessoa ociosas</td><td>{horasPessoa(sugestao.antes.horasSemPosto)}</td><td>{horasPessoa(sugestao.depois.horasSemPosto)}</td></tr>
                    <tr><td>Pessoas-período sem posto</td><td>{sugestao.antes.pessoasPeriodoSemPosto}</td><td>{sugestao.depois.pessoasPeriodoSemPosto}</td></tr>
                  </tbody>
                </table>
              </div>
              {sugestao.porProduto.map((pp) => (
                <div className="stx-cob-linha" key={pp.produtoId}>
                  <span>
                    <b>{p.nomeProd(pp.produtoId)}</b>
                    <small>
                      {pp.acabado > 0 ? `+${formatQtd(pp.acabado)} de produto acabado` : "sem produto acabado adicional"}
                      {pp.estoque.length > 0 ? ` · estoque: ${pp.estoque.map((e) => `${formatQtd(e.pecas)} aguardando ${p.nomeEtapa(e.proximaEtapaId)}`).join(", ")}` : ""}
                    </small>
                    <small>sem este produto a cobertura iria para {pct(pp.coberturaSemEle.percentual)} ({horasPessoa(pp.coberturaSemEle.horasSemPosto)} ociosas)</small>
                  </span>
                  <span>{formatBRL(pp.valorPotencial)}</span>
                </div>
              ))}
              <p className="stx-cob-dica">O produto acabado tem prioridade: o estoque intermediário só usa a capacidade que sobra e nunca tira a de um produto acabado. Nada é aplicado automaticamente.</p>
            </>
          )}
        </div>
      )}
    </>
  );
}
