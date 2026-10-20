"use client";

// Excluir funcionário — fluxo controlado (somente administrador). O administrador escolhe:
//  • UNIFICAR E EXCLUIR CADASTRO: escolhe outro funcionário, simula, vê conflitos, confirma; o histórico é transferido.
//  • EXCLUIR SEM UNIFICAR: mesmo com histórico. O sistema mostra o impacto; a decisão é do administrador, com
//    confirmação forte (resumo, segunda confirmação, digitar o nome e botão vermelho "Excluir permanentemente").
// Em ambos: simulação (nada é gravado) -> assinatura -> execução atômica no backend. Nunca há DELETE no navegador.

import { useEffect, useState } from "react";
import { executarExclusao, carregarResumo, simularExclusao, type Decisoes } from "./exclusaoApi";
import {
  descreverFuncionario, formatarData, haHistoricoNoPlano, linhasConsolidacao, linhasDeVinculos, linhasDescarte, linhasImpactoIndicadores, linhasRemocao,
  linhasTransferencia, nomeConfere, plural, podeConfirmar, temHistorico,
  type PlanoExclusao, type ResumoFuncionario,
} from "./exclusao";

const ESTILOS = `
.stx-ex-card { max-width: 640px; }
.stx-ex-bloco { margin: 14px 0 0; padding: 12px 14px; border-radius: 10px; background: rgba(255,255,255,.04); border: 1px solid var(--border); }
.stx-ex-bloco h4 { margin: 0 0 6px; font-size: 12px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--text-muted); }
.stx-ex-bloco ul { margin: 4px 0 0 18px; padding: 0; font-size: 13px; }
.stx-ex-alvo { font-size: 13px; margin: 2px 0 0; }
.stx-ex-manter { border-color: var(--accent); }
.stx-ex-excluir { border-color: var(--danger); }
.stx-ex-perigo { border-color: var(--danger); background: rgba(217,83,79,.08); }
.stx-ex-erro { color: var(--danger); font-size: 13px; margin: 10px 0 0; }
.stx-ex-aviso { color: var(--warning); font-size: 13px; margin: 8px 0 0; }
.stx-ex-decisao { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; margin-top: 6px; font-size: 13px; }
.stx-ex-tab { width: 100%; border-collapse: collapse; font-size: 12.5px; margin-top: 6px; }
.stx-ex-tab th, .stx-ex-tab td { text-align: left; padding: 4px 6px; border-bottom: 1px solid var(--border); }
.stx-ex-escolhas { display: flex; flex-direction: column; gap: 10px; margin-top: 14px; }
.stx-ex-escolha { text-align: left; padding: 12px 14px; border-radius: 10px; border: 1px solid var(--border); background: rgba(255,255,255,.04); color: var(--text); cursor: pointer; font: inherit; }
.stx-ex-escolha:hover { border-color: var(--accent); }
.stx-ex-escolha.perigo:hover { border-color: var(--danger); }
.stx-ex-escolha b { display: block; font-size: 14px; }
.stx-ex-escolha span { display: block; font-size: 12px; color: var(--text-muted); margin-top: 2px; }
.stx-ex-btn-perigo { background: var(--danger); border-color: var(--danger); color: #fff; }
.stx-ex-btn-perigo:disabled { opacity: .45; cursor: not-allowed; }
`;

type Modo = "simples" | "unificacao";

export interface ExcluirFuncionarioModalProps {
  funcionarioId: string;
  onFechar: () => void;
  onConcluido: () => void; // recarrega a lista de funcionários
}

export default function ExcluirFuncionarioModal({ funcionarioId, onFechar, onConcluido }: ExcluirFuncionarioModalProps) {
  const [resumo, setResumo] = useState<ResumoFuncionario | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [modo, setModo] = useState<Modo | null>(null); // com histórico: o administrador escolhe; sem histórico: "simples"
  const [destinoId, setDestinoId] = useState<string>(""); // NUNCA pré-selecionado
  const [plano, setPlano] = useState<PlanoExclusao | null>(null);
  const [destinoSimulado, setDestinoSimulado] = useState<string | null>(null);
  const [decisoes, setDecisoes] = useState<Decisoes>({});
  const [ocupado, setOcupado] = useState(false);
  const [concluido, setConcluido] = useState<string | null>(null);
  // confirmação forte (exclusão permanente com histórico)
  const [forte, setForte] = useState(false);
  const [entendo, setEntendo] = useState(false);
  const [nomeDigitado, setNomeDigitado] = useState("");

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const r = await carregarResumo(funcionarioId);
      if (!vivo) return;
      if (!r.ok) {
        setErro(r.erro);
        return;
      }
      setResumo(r.dados);
      setModo(temHistorico(r.dados.vinculos) ? null : "simples");
    })();
    return () => { vivo = false; };
  }, [funcionarioId]);

  const unificando = modo === "unificacao";
  const comHistorico = resumo ? temHistorico(resumo.vinculos) : false;
  const exclusaoPermanente = modo === "simples" && comHistorico; // exclusão sem unificar COM histórico => confirmação forte

  function limparSimulacao() {
    setPlano(null);
    setDecisoes({});
    setErro(null);
    setForte(false);
    setEntendo(false);
    setNomeDigitado("");
  }

  async function simular(novasDecisoes: Decisoes = decisoes) {
    if (!resumo || !modo) return;
    if (unificando && !destinoId) return;
    setOcupado(true);
    setErro(null);
    const r = await simularExclusao(funcionarioId, unificando ? destinoId : null, novasDecisoes);
    setOcupado(false);
    if (!r.ok) {
      setErro(r.erro);
      setPlano(null);
      return;
    }
    setPlano(r.dados);
    setDestinoSimulado(unificando ? destinoId : null);
    setForte(false);
    setEntendo(false);
    setNomeDigitado("");
  }

  function escolherModo(m: Modo | null) {
    setModo(m);
    limparSimulacao();
  }
  function escolherDestino(id: string) {
    setDestinoId(id);
    limparSimulacao(); // trocou o destino: a simulação anterior deixa de valer
  }
  async function decidir(custoId: string, valor: "copiar" | "descartar") {
    const novas = { ...decisoes, [custoId]: valor };
    setDecisoes(novas);
    await simular(novas);
  }

  const nomeAlvo = resumo?.funcionario.nome ?? "";
  const confirmacaoForteOk = !exclusaoPermanente || (forte && entendo && nomeConfere(nomeDigitado, nomeAlvo));

  async function confirmar() {
    if (!plano || !podeConfirmar(plano, unificando ? destinoId : null, destinoSimulado) || !confirmacaoForteOk) return;
    setOcupado(true);
    setErro(null);
    const r = await executarExclusao(funcionarioId, unificando ? destinoId : null, decisoes, plano.assinatura);
    setOcupado(false);
    if (!r.ok) {
      setErro(r.erro);
      setPlano(null); // dados podem ter mudado: simular de novo
      setForte(false);
      setEntendo(false);
      return;
    }
    setConcluido(unificando
      ? `Funcionário unificado: o histórico foi transferido para ${plano.mantido?.nome ?? "o funcionário mantido"} e o cadastro excluído foi removido.`
      : "Funcionário excluído permanentemente. Tudo que foi removido ficou registrado no log de exclusões.");
    onConcluido();
  }

  const tituloAcao = unificando ? "Unificar funcionário e excluir cadastro" : modo === "simples" ? (comHistorico ? "Excluir sem unificar" : "Excluir funcionário") : "Excluir funcionário";
  const f = resumo?.funcionario;
  const vinculos = resumo?.vinculos;
  const semVinculo = vinculos ? linhasDeVinculos(vinculos).length === 0 : false;
  const podeOk = !!plano && podeConfirmar(plano, unificando ? destinoId : null, destinoSimulado);

  return (
    <div className="stx-modal-backdrop" onClick={concluido ? onFechar : undefined}>
      <style>{ESTILOS}</style>
      <div className="stx-modal-card stx-ex-card" role="dialog" aria-label={tituloAcao} onClick={(e) => e.stopPropagation()}>
        <p className="stx-modal-titulo">{concluido ? "Concluído" : tituloAcao}</p>

        {concluido && (
          <>
            <p className="stx-panel-sub">{concluido}</p>
            <div className="stx-form-actions" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="stx-btn-primary" onClick={onFechar}>Fechar</button>
            </div>
          </>
        )}

        {!concluido && !resumo && !erro && <p className="stx-panel-sub">Carregando vínculos…</p>}
        {!concluido && !resumo && erro && (
          <>
            <p className="stx-ex-erro">{erro}</p>
            <div className="stx-form-actions" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="stx-btn-secondary" onClick={onFechar}>Fechar</button>
            </div>
          </>
        )}

        {!concluido && resumo && f && vinculos && (
          <>
            <div className="stx-ex-bloco stx-ex-excluir">
              <h4>Funcionário que será excluído</h4>
              <p className="stx-ex-alvo"><b>{descreverFuncionario({ ...f, apontamentos: vinculos.apontamentos })}</b></p>
              {semVinculo ? (
                <p className="stx-panel-sub" style={{ margin: "6px 0 0" }}>Este funcionário não possui histórico no sistema.</p>
              ) : (
                <>
                  <p className="stx-panel-sub" style={{ margin: "6px 0 0" }}>Este funcionário possui histórico no sistema:</p>
                  <ul>{linhasDeVinculos(vinculos).map((l) => <li key={l}>{l}</li>)}</ul>
                </>
              )}
            </div>

            {/* 1) com histórico: o administrador escolhe uma das duas ações */}
            {comHistorico && modo === null && (
              <div className="stx-ex-escolhas">
                <button type="button" className="stx-ex-escolha" onClick={() => escolherModo("unificacao")}>
                  <b>Unificar com outro funcionário</b>
                  <span>Transfere o histórico para outro cadastro e exclui este. Você escolhe qual manter.</span>
                </button>
                <button type="button" className="stx-ex-escolha perigo" onClick={() => escolherModo("simples")}>
                  <b>Excluir sem unificar</b>
                  <span>Remove este cadastro e os dados vinculados a ele, sem transferir nada. Exige confirmação forte.</span>
                </button>
                <div className="stx-form-actions" style={{ justifyContent: "flex-end" }}>
                  <button type="button" className="stx-btn-secondary" onClick={onFechar}>Cancelar</button>
                </div>
              </div>
            )}

            {/* sem histórico: exclusão simples (ou unificar, se quiser) */}
            {!comHistorico && (
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
                <label><input type="radio" name="modo" checked={modo === "simples"} onChange={() => escolherModo("simples")} /> Excluir funcionário</label>
                <label><input type="radio" name="modo" checked={modo === "unificacao"} onChange={() => escolherModo("unificacao")} /> Migrar histórico para outro funcionário e excluir</label>
              </div>
            )}

            {comHistorico && modo !== null && !plano && (
              <p className="stx-panel-sub" style={{ marginTop: 10 }}>
                <button type="button" className="stx-btn-secondary" onClick={() => escolherModo(null)} disabled={ocupado}>← Voltar às duas opções</button>
              </p>
            )}

            {unificando && (
              <div style={{ marginTop: 12 }}>
                <label className="stx-panel-sub" htmlFor="ex-destino" style={{ display: "block", margin: "0 0 4px" }}>Funcionário que será mantido (receberá o histórico)</label>
                <select id="ex-destino" className="stx-select" value={destinoId} onChange={(e) => escolherDestino(e.target.value)} disabled={ocupado}>
                  <option value="">Selecione o funcionário que será mantido…</option>
                  {resumo.candidatos.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.mesmo_nome ? "★ mesmo nome — " : ""}{descreverFuncionario(c)}
                    </option>
                  ))}
                </select>
                {resumo.candidatos.some((c) => c.mesmo_nome) && <p className="stx-panel-sub" style={{ margin: "4px 0 0" }}>★ = outro cadastro com o mesmo nome. Nada vem pré-selecionado: você escolhe qual manter.</p>}
              </div>
            )}

            {modo !== null && !plano && (
              <div className="stx-form-actions" style={{ marginTop: 16, justifyContent: "flex-end" }}>
                <button type="button" className="stx-btn-secondary" onClick={onFechar} disabled={ocupado}>Cancelar</button>
                <button type="button" className="stx-btn-primary" onClick={() => void simular()} disabled={ocupado || (unificando && !destinoId)}>
                  {ocupado ? "Simulando…" : "Simular (nada será alterado)"}
                </button>
              </div>
            )}

            {plano && (
              <>
                {plano.modo === "unificacao" && plano.mantido && (
                  <div className="stx-ex-bloco stx-ex-manter">
                    <h4>Funcionário que será mantido</h4>
                    <p className="stx-ex-alvo"><b>{descreverFuncionario({ ...plano.mantido, apontamentos: plano.mantido.vinculos.apontamentos })}</b></p>
                  </div>
                )}

                {plano.modo === "unificacao" && linhasTransferencia(plano).length > 0 && (
                  <div className="stx-ex-bloco">
                    <h4>Histórico que será transferido</h4>
                    <ul>{linhasTransferencia(plano).map((l) => <li key={l}>{l}</li>)}</ul>
                  </div>
                )}

                {plano.modo === "unificacao" && linhasConsolidacao(plano).length > 0 && (
                  <div className="stx-ex-bloco">
                    <h4>Registros consolidados</h4>
                    <ul>{linhasConsolidacao(plano).map((l) => <li key={l}>{l}</li>)}</ul>
                    {plano.consolidar.semanas_equipe.some((s) => s.difere) && (
                      <>
                        <p className="stx-panel-sub" style={{ margin: "8px 0 0" }}>Semanas com conflito de “produtivo”:</p>
                        <table className="stx-ex-tab">
                          <thead><tr><th>Semana</th><th>Excluído</th><th>Mantido</th><th>Final</th></tr></thead>
                          <tbody>
                            {plano.consolidar.semanas_equipe.filter((s) => s.difere).map((s) => (
                              <tr key={s.previsao_id}>
                                <td>{formatarData(s.semana_inicio)}</td>
                                <td>{s.produtivo_excluido ? "produtivo" : "não"}</td>
                                <td>{s.produtivo_mantido ? "produtivo" : "não"}</td>
                                <td><b>{s.produtivo_final ? "produtivo" : "não"}</b></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </>
                    )}
                  </div>
                )}

                {plano.modo === "unificacao" && linhasDescarte(plano).length > 0 && (
                  <div className="stx-ex-bloco">
                    <h4>Descartado</h4>
                    <ul>{linhasDescarte(plano).map((l) => <li key={l}>{l}</li>)}</ul>
                  </div>
                )}

                {plano.modo === "exclusao" && (
                  <>
                    <div className={`stx-ex-bloco ${haHistoricoNoPlano(plano) ? "stx-ex-perigo" : ""}`}>
                      <h4>Excluir sem unificar</h4>
                      {linhasRemocao(plano).length === 0 ? (
                        <p className="stx-panel-sub" style={{ margin: 0 }}>Nenhum dado vinculado a este cadastro. Apenas o cadastro será excluído.</p>
                      ) : (
                        <>
                          <p className="stx-panel-sub" style={{ margin: "0 0 4px" }}>Esta operação removerá permanentemente os dados vinculados exclusivamente a este cadastro:</p>
                          <ul>{linhasRemocao(plano).map((l) => <li key={l}>{l}</li>)}</ul>
                        </>
                      )}
                    </div>
                    {linhasImpactoIndicadores(plano).length > 0 && (
                      <div className="stx-ex-bloco">
                        <h4>Impacto nos indicadores históricos</h4>
                        <ul>{linhasImpactoIndicadores(plano).map((l) => <li key={l}>{l}</li>)}</ul>
                      </div>
                    )}
                  </>
                )}

                {plano.pendencias.some((p) => p.custo_id) && (
                  <div className="stx-ex-bloco">
                    <h4>Custos diferentes — decisão necessária</h4>
                    {plano.pendencias.filter((p) => p.custo_id).map((p) => (
                      <div key={p.custo_id} style={{ marginBottom: 8 }}>
                        <div style={{ fontSize: 13 }}><b>{p.descricao}</b> · {(p.valor ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</div>
                        <div className="stx-ex-decisao">
                          <label><input type="radio" name={`c-${p.custo_id}`} onChange={() => void decidir(p.custo_id as string, "copiar")} disabled={ocupado} /> Copiar para o funcionário mantido</label>
                          <label><input type="radio" name={`c-${p.custo_id}`} onChange={() => void decidir(p.custo_id as string, "descartar")} disabled={ocupado} /> Descartar</label>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="stx-ex-bloco">
                  <h4>Impacto na Escala</h4>
                  {plano.impacto_escala.semanas_recalculadas.length === 0 ? (
                    <p className="stx-panel-sub" style={{ margin: 0 }}>Nenhuma semana de Escala será recalculada.</p>
                  ) : (
                    <p className="stx-panel-sub" style={{ margin: 0 }}>
                      {plural(plano.impacto_escala.semanas_recalculadas.length, "semana será recalculada", "semanas serão recalculadas")} ({plano.impacto_escala.semanas_recalculadas.map((s) => formatarData(s.semana_inicio)).join(", ")}).
                      Os períodos futuros são recalculados; os já iniciados {plano.modo === "exclusao" ? "perdem apenas as alocações deste funcionário" : "não são alterados"}.
                    </p>
                  )}
                </div>

                {plano.bloqueios.map((b) => <p key={b.codigo} className="stx-ex-erro">⛔ {b.mensagem}</p>)}
                {plano.avisos.map((a) => <p key={a.codigo} className="stx-ex-aviso">⚠ {a.mensagem}</p>)}
                {plano.pendencias.filter((p) => !p.custo_id).map((p) => <p key={p.codigo} className="stx-ex-erro">{p.mensagem}</p>)}

                {/* confirmação forte: exclusão permanente com histórico */}
                {exclusaoPermanente && forte && (
                  <div className="stx-ex-bloco stx-ex-perigo">
                    <h4>Confirmação final</h4>
                    <p className="stx-ex-alvo"><b>Esta exclusão é permanente e não transfere o histórico para outro funcionário.</b></p>
                    <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, marginTop: 8 }}>
                      <input type="checkbox" checked={entendo} onChange={(e) => setEntendo(e.target.checked)} />
                      <span>Entendo que os dados listados serão apagados e que os indicadores históricos podem mudar.</span>
                    </label>
                    <label className="stx-panel-sub" htmlFor="ex-nome" style={{ display: "block", margin: "10px 0 4px" }}>
                      Digite <b>{nomeAlvo.trim().toLocaleUpperCase("pt-BR")}</b> para confirmar.
                    </label>
                    <input id="ex-nome" className="stx-input" value={nomeDigitado} onChange={(e) => setNomeDigitado(e.target.value)} autoComplete="off" placeholder={nomeAlvo} />
                  </div>
                )}

                <div className="stx-form-actions" style={{ marginTop: 16, justifyContent: "flex-end" }}>
                  <button type="button" className="stx-btn-secondary" onClick={onFechar} disabled={ocupado}>Cancelar</button>
                  <button type="button" className="stx-btn-secondary" onClick={() => void simular()} disabled={ocupado}>Simular novamente</button>
                  {exclusaoPermanente && !forte ? (
                    <button type="button" className="stx-btn-secondary" onClick={() => setForte(true)} disabled={ocupado || !podeOk}
                      style={!podeOk ? { opacity: 0.45, cursor: "not-allowed" } : { borderColor: "var(--danger)", color: "var(--danger)" }}>
                      Continuar para a confirmação
                    </button>
                  ) : exclusaoPermanente ? (
                    <button type="button" className="stx-btn-primary stx-ex-btn-perigo" onClick={() => void confirmar()} disabled={ocupado || !podeOk || !confirmacaoForteOk}>
                      {ocupado ? "Excluindo…" : "Excluir permanentemente"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="stx-btn-primary"
                      onClick={() => void confirmar()}
                      disabled={ocupado || !podeOk}
                      style={ocupado || !podeOk ? { opacity: 0.45, cursor: "not-allowed" } : undefined}
                    >
                      {ocupado ? "Processando…" : unificando ? "Unificar e excluir cadastro" : "Excluir funcionário"}
                    </button>
                  )}
                </div>
              </>
            )}

            {erro && <p className="stx-ex-erro">{erro}</p>}
          </>
        )}
      </div>
    </div>
  );
}
