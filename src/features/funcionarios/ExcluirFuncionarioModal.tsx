"use client";

// Excluir funcionário — fluxo controlado (somente administrador):
//  1) resumo dos vínculos; 2) escolha EXPLÍCITA do destino do histórico (nunca pré-selecionado);
//  3) simulação (nada é gravado); 4) decisões de custo; 5) confirmação; 6) execução atômica no backend.
// Funcionário com apontamentos NUNCA é excluído sem unificação.

import { useEffect, useState } from "react";
import { executarExclusao, carregarResumo, simularExclusao, type Decisoes } from "./exclusaoApi";
import {
  descreverFuncionario, exigeUnificacao, formatarData, linhasConsolidacao, linhasDeVinculos, linhasDescarte, linhasTransferencia, plural, podeConfirmar,
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
.stx-ex-erro { color: var(--danger); font-size: 13px; margin: 10px 0 0; }
.stx-ex-aviso { color: var(--warning); font-size: 13px; margin: 8px 0 0; }
.stx-ex-decisao { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; margin-top: 6px; font-size: 13px; }
.stx-ex-tab { width: 100%; border-collapse: collapse; font-size: 12.5px; margin-top: 6px; }
.stx-ex-tab th, .stx-ex-tab td { text-align: left; padding: 4px 6px; border-bottom: 1px solid var(--border); }
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
  const [modo, setModo] = useState<Modo>("unificacao");
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
      // quem tem apontamentos só pode unificar; o destino NUNCA vem pré-selecionado
      setModo(exigeUnificacao(r.dados.vinculos) ? "unificacao" : "simples");
    })();
    return () => { vivo = false; };
  }, [funcionarioId]);

  const obrigaUnificar = resumo ? exigeUnificacao(resumo.vinculos) : false;
  const unificando = modo === "unificacao";

  async function simular(novasDecisoes: Decisoes = decisoes) {
    if (!resumo) return;
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

  function escolherDestino(id: string) {
    setDestinoId(id);
    setPlano(null); // trocou o destino: a simulação anterior deixa de valer
    setDecisoes({});
    setErro(null);
  }
  function escolherModo(m: Modo) {
    setModo(m);
    setPlano(null);
    setDecisoes({});
    setErro(null);
  }
  async function decidir(custoId: string, valor: "copiar" | "descartar") {
    const novas = { ...decisoes, [custoId]: valor };
    setDecisoes(novas);
    await simular(novas);
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
    setConcluido(unificando
      ? `Funcionário unificado: o histórico foi transferido para ${plano.mantido?.nome ?? "o funcionário mantido"} e o cadastro excluído foi removido.`
      : "Funcionário excluído.");
    onConcluido();
  }

  const tituloAcao = unificando ? "Unificar funcionário e excluir cadastro" : "Excluir funcionário";
  const f = resumo?.funcionario;
  const vinculos = resumo?.vinculos;
  const semVinculo = vinculos ? linhasDeVinculos(vinculos).length === 0 : false;

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

            {obrigaUnificar ? (
              <p className="stx-panel-sub" style={{ marginTop: 12 }}>
                Como há apontamentos de produção, <b>não é possível excluir sem unificar</b>. Escolha o funcionário que receberá este histórico.
              </p>
            ) : (
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
                <label><input type="radio" name="modo" checked={modo === "simples"} onChange={() => escolherModo("simples")} /> Excluir sem unificar</label>
                <label><input type="radio" name="modo" checked={modo === "unificacao"} onChange={() => escolherModo("unificacao")} /> Migrar histórico para outro funcionário e excluir</label>
              </div>
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

            {!plano && (
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

                {linhasDescarte(plano).length > 0 && (
                  <div className="stx-ex-bloco">
                    <h4>{plano.modo === "exclusao" ? "O que será removido" : "Descartado"}</h4>
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
                      Períodos já iniciados não são alterados.
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
                    disabled={ocupado || !podeConfirmar(plano, unificando ? destinoId : null, destinoSimulado)}
                    style={ocupado || !podeConfirmar(plano, unificando ? destinoId : null, destinoSimulado) ? { opacity: 0.45, cursor: "not-allowed" } : undefined}
                  >
                    {ocupado ? "Processando…" : unificando ? "Unificar e excluir cadastro" : "Excluir funcionário"}
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
