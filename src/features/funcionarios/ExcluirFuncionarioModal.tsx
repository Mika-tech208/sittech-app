"use client";

// Unificar cadastro duplicado / remover cadastro VAZIO — fluxo controlado (somente administrador).
//  • UNIFICAR: dois cadastros representam a mesma pessoa; escolhe-se qual manter, simula, vê conflitos, confirma; o histórico é transferido.
//  • REMOVER CADASTRO VAZIO: só para cadastro criado por engano e SEM nenhum vínculo (apontamentos, ausências, Escala, equipe, custos, ocorrências, auditorias).
// "Excluir funcionário" que saiu da empresa NÃO passa por aqui: é DESATIVAR (FuncionarioSituacaoModal), que preserva todo o histórico.
// O caminho destrutivo "excluir sem unificar" não existe mais na interface. Nunca há DELETE no navegador.

import { useEffect, useState } from "react";
import { executarExclusao, carregarResumo, removerCadastroVazio, simularExclusao, type Decisoes } from "./exclusaoApi";
import {
  descreverFuncionario, formatarData, linhasConsolidacao, linhasDeVinculos, linhasDescarte,
  linhasTransferencia, plural, podeConfirmar,
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

type Modo = "vazio" | "unificacao";

export interface ExcluirFuncionarioModalProps {
  funcionarioId: string;
  onFechar: () => void;
  onConcluido: () => void; // recarrega a lista de funcionários
}

export default function ExcluirFuncionarioModal({ funcionarioId, onFechar, onConcluido }: ExcluirFuncionarioModalProps) {
  const [resumo, setResumo] = useState<ResumoFuncionario | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [modo, setModo] = useState<Modo | null>(null); // cadastro vazio: o administrador escolhe remover ou unificar; com vínculos: só unificar
  const [destinoId, setDestinoId] = useState<string>(""); // NUNCA pré-selecionado
  const [plano, setPlano] = useState<PlanoExclusao | null>(null);
  const [destinoSimulado, setDestinoSimulado] = useState<string | null>(null);
  const [decisoes, setDecisoes] = useState<Decisoes>({});
  const [ocupado, setOcupado] = useState(false);
  const [concluido, setConcluido] = useState<string | null>(null);

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
      setModo(r.dados.vazio ? null : "unificacao");
    })();
    return () => { vivo = false; };
  }, [funcionarioId]);

  const unificando = modo === "unificacao";
  const vazio = resumo?.vazio === true;

  function limparSimulacao() {
    setPlano(null);
    setDecisoes({});
    setErro(null);
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

  async function remover() {
    if (!vazio || ocupado) return;
    setOcupado(true);
    setErro(null);
    const r = await removerCadastroVazio(funcionarioId);
    setOcupado(false);
    if (!r.ok) { setErro(r.erro); return; }
    setConcluido("Cadastro removido. Ele não tinha nenhum vínculo no sistema.");
    onConcluido();
  }

  async function confirmar() {
    if (!plano || !podeConfirmar(plano, unificando ? destinoId : null, destinoSimulado)) return;
    setOcupado(true);
    setErro(null);
    const r = await executarExclusao(funcionarioId, unificando ? destinoId : null, decisoes, plano.assinatura);
    setOcupado(false);
    if (!r.ok) {
      setErro(r.erro);
      setPlano(null); // dados podem ter mudado: simular de novo
      return;
    }
    setConcluido(`Cadastros unificados: o histórico foi transferido para ${plano.mantido?.nome ?? "o funcionário mantido"} e o cadastro duplicado foi removido.`);
    onConcluido();
  }

  const tituloAcao = unificando ? "Unificar cadastro duplicado" : modo === "vazio" ? "Remover cadastro vazio" : "Unificar ou remover cadastro";
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
              <h4>{modo === "vazio" ? "Cadastro" : "Cadastro duplicado (será removido)"}</h4>
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

            <p className="stx-panel-sub" style={{ margin: "10px 0 0" }}>
              Para um funcionário que saiu da empresa, use <b>Desativar funcionário</b>: o histórico é preservado. Unificar serve só quando dois cadastros representam a mesma pessoa.
            </p>

            {/* cadastro sem NENHUM vínculo: pode ser removido (criado por engano) ou unificado */}
            {vazio && modo === null && (
              <div className="stx-ex-escolhas">
                <button type="button" className="stx-ex-escolha perigo" onClick={() => escolherModo("vazio")}>
                  <b>Remover cadastro (criado por engano)</b>
                  <span>Este cadastro não tem nenhum vínculo. A remoção fica registrada no log.</span>
                </button>
                <button type="button" className="stx-ex-escolha" onClick={() => escolherModo("unificacao")}>
                  <b>Unificar com outro funcionário</b>
                  <span>Transfere o histórico para outro cadastro e remove este. Você escolhe qual manter.</span>
                </button>
                <div className="stx-form-actions" style={{ justifyContent: "flex-end" }}>
                  <button type="button" className="stx-btn-secondary" onClick={onFechar}>Cancelar</button>
                </div>
              </div>
            )}

            {modo === "vazio" && (
              <div className="stx-form-actions" style={{ marginTop: 16, justifyContent: "flex-end" }}>
                <button type="button" className="stx-btn-secondary" onClick={() => escolherModo(null)} disabled={ocupado}>Voltar</button>
                <button type="button" className="stx-btn-primary stx-ex-btn-perigo" onClick={() => void remover()} disabled={ocupado}>{ocupado ? "Removendo…" : "Remover cadastro"}</button>
              </div>
            )}

            {vazio && modo === "unificacao" && !plano && (
              <p className="stx-panel-sub" style={{ marginTop: 10 }}>
                <button type="button" className="stx-btn-secondary" onClick={() => escolherModo(null)} disabled={ocupado}>← Voltar às opções</button>
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

            {unificando && !plano && (
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
                      Os períodos futuros são recalculados; os já iniciados não são alterados.
                    </p>
                  )}
                </div>

                {plano.bloqueios.map((b) => <p key={b.codigo} className="stx-ex-erro">⛔ {b.mensagem}</p>)}
                {plano.avisos.map((a) => <p key={a.codigo} className="stx-ex-aviso">⚠ {a.mensagem}</p>)}
                {plano.pendencias.filter((p) => !p.custo_id).map((p) => <p key={p.codigo} className="stx-ex-erro">{p.mensagem}</p>)}

                <div className="stx-form-actions" style={{ marginTop: 16, justifyContent: "flex-end" }}>
                  <button type="button" className="stx-btn-secondary" onClick={onFechar} disabled={ocupado}>Cancelar</button>
                  <button type="button" className="stx-btn-secondary" onClick={() => void simular()} disabled={ocupado}>Simular novamente</button>
                  <button
                    type="button"
                    className="stx-btn-primary"
                    onClick={() => void confirmar()}
                    disabled={ocupado || !podeOk}
                    style={ocupado || !podeOk ? { opacity: 0.45, cursor: "not-allowed" } : undefined}
                  >
                    {ocupado ? "Processando…" : "Unificar e remover cadastro duplicado"}
                  </button>
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
