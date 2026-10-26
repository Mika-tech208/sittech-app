"use client";

// Desativar / reativar funcionário (somente administrador, validado no backend). Desativar NÃO apaga nada: o funcionário sai das operações futuras e
// todo o histórico (produção, ausências, escalas, custos) é preservado. A data/hora EFETIVA pode ser diferente de "agora" (ex.: saiu sexta 17:00 e o
// registro é feito segunda 08:00); o sistema guarda os dois instantes na linha do tempo (efetivo x registrado).
import { useEffect, useState } from "react";
import { carregarResumo, desativarFuncionario, listarSituacao, reativarFuncionario, type LinhaSituacao } from "./exclusaoApi";
import { linhasDeVinculos, type ResumoFuncionario } from "./exclusao";
import { agoraParaInputLocal, efetivoNoFuturo, formatarDataHoraSP, inputLocalParaIso, TEXTO_DESATIVAR } from "./situacao";

export interface FuncionarioSituacaoModalProps {
  funcionarioId: string;
  modo: "desativar" | "reativar";
  onFechar: () => void;
  onConcluido: () => void; // recarrega a lista de funcionários
}

export default function FuncionarioSituacaoModal({ funcionarioId, modo, onFechar, onConcluido }: FuncionarioSituacaoModalProps) {
  const [resumo, setResumo] = useState<ResumoFuncionario | null>(null);
  const [historico, setHistorico] = useState<LinhaSituacao[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [concluido, setConcluido] = useState<string | null>(null);
  const [efetivo, setEfetivo] = useState(() => agoraParaInputLocal());
  const [motivo, setMotivo] = useState("");

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const [r, h] = await Promise.all([carregarResumo(funcionarioId), listarSituacao(funcionarioId)]);
      if (!vivo) return;
      if (!r.ok) { setErro(r.erro); return; }
      setResumo(r.dados);
      if (h.ok) setHistorico(h.dados);
    })();
    return () => { vivo = false; };
  }, [funcionarioId]);

  const desativando = modo === "desativar";
  const nome = resumo?.funcionario.nome ?? "";
  const bloqueadoPorAtraso = desativando && resumo?.atraso_em_aberto === true;
  const futuro = efetivoNoFuturo(efetivo);
  const podeConfirmar = !ocupado && !!resumo && !bloqueadoPorAtraso && !futuro && inputLocalParaIso(efetivo) !== null;

  async function confirmar() {
    if (!podeConfirmar) return;
    setOcupado(true);
    setErro(null);
    const iso = inputLocalParaIso(efetivo);
    const r = desativando ? await desativarFuncionario(funcionarioId, iso, motivo) : await reativarFuncionario(funcionarioId, iso, motivo);
    setOcupado(false);
    if (!r.ok) { setErro(r.erro); return; }
    setConcluido(desativando
      ? `${nome} foi desativado. Ele sai das operações futuras e todo o histórico foi preservado.`
      : `${nome} foi reativado. Ele volta a ficar elegível para novas operações; a inclusão em semanas já programadas continua sendo decisão da Previsão.`);
    onConcluido();
  }

  const titulo = desativando ? "Desativar funcionário" : "Reativar funcionário";
  return (
    <div className="stx-modal-backdrop" onClick={concluido ? onFechar : undefined}>
      <div className="stx-modal-card" role="dialog" aria-label={titulo} onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <p className="stx-modal-titulo">{concluido ? "Concluído" : titulo}{nome && !concluido ? ` — ${nome}` : ""}</p>

        {concluido && (
          <>
            <p className="stx-panel-sub">{concluido}</p>
            <div className="stx-form-actions" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="stx-btn-primary" onClick={onFechar}>Fechar</button>
            </div>
          </>
        )}

        {!concluido && !resumo && !erro && <p className="stx-panel-sub">Carregando…</p>}
        {!concluido && !resumo && erro && (
          <>
            <p style={{ color: "var(--danger)", fontSize: 13 }}>{erro}</p>
            <div className="stx-form-actions" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="stx-btn-secondary" onClick={onFechar}>Fechar</button>
            </div>
          </>
        )}

        {!concluido && resumo && (
          <>
            {desativando ? (
              <p className="stx-panel-sub">{TEXTO_DESATIVAR}</p>
            ) : (
              <p className="stx-panel-sub">
                Reativar não cria histórico novo: apenas volta a permitir o uso do funcionário em operações futuras (apontamentos, ausências, novas Previsões e Escalas).
                {resumo.funcionario.desligado_em ? ` Desligado em ${formatarDataHoraSP(resumo.funcionario.desligado_em)}${resumo.funcionario.motivo_desligamento ? ` — ${resumo.funcionario.motivo_desligamento}` : ""}.` : ""}
              </p>
            )}

            {desativando && linhasDeVinculos(resumo.vinculos).length > 0 && (
              <div style={{ margin: "10px 0 0", fontSize: 13 }}>
                <b>Será preservado:</b>
                <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>{linhasDeVinculos(resumo.vinculos).map((l) => <li key={l}>{l}</li>)}</ul>
              </div>
            )}

            {bloqueadoPorAtraso && (
              <p style={{ color: "var(--danger)", fontSize: 13, margin: "10px 0 0" }}>
                ⛔ Este funcionário tem um atraso em aberto. Registre a chegada em Faltas e Ausências (ou aguarde o fechamento automático) antes de desativar.
              </p>
            )}

            <div style={{ marginTop: 12 }}>
              <label className="stx-panel-sub" htmlFor="sit-efetivo" style={{ display: "block", margin: "0 0 4px" }}>
                {desativando ? "Data/hora efetiva do desligamento" : "Data/hora efetiva da reativação"} (horário de São Paulo)
              </label>
              <input id="sit-efetivo" type="datetime-local" className="stx-input" value={efetivo} onChange={(e) => setEfetivo(e.target.value)} disabled={ocupado} />
              <p className="stx-panel-sub" style={{ margin: "4px 0 0" }}>Por padrão é agora. Se a saída foi antes, informe o instante real; o sistema também guarda a hora em que você registrou.</p>
              {futuro && <p style={{ color: "var(--danger)", fontSize: 13, margin: "4px 0 0" }}>A data/hora efetiva não pode estar no futuro.</p>}
            </div>

            <div style={{ marginTop: 12 }}>
              <label className="stx-panel-sub" htmlFor="sit-motivo" style={{ display: "block", margin: "0 0 4px" }}>Motivo (opcional)</label>
              <input id="sit-motivo" className="stx-input" value={motivo} onChange={(e) => setMotivo(e.target.value)} disabled={ocupado} placeholder={desativando ? "Ex.: pediu demissão" : "Ex.: desligamento registrado por engano"} />
            </div>

            {historico.length > 0 && (
              <div style={{ margin: "12px 0 0", fontSize: 12.5 }}>
                <b>Histórico de situação</b>
                <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>
                  {historico.map((h) => (
                    <li key={h.id}>
                      {h.acao === "desativado" ? "Desativado" : "Reativado"} em {formatarDataHoraSP(h.efetivo_em)} (registrado {formatarDataHoraSP(h.registrado_em)}{h.registrado_por ? ` por ${h.registrado_por}` : ""}){h.motivo ? ` — ${h.motivo}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {erro && <p style={{ color: "var(--danger)", fontSize: 13, margin: "10px 0 0" }}>{erro}</p>}

            <div className="stx-form-actions" style={{ marginTop: 16, justifyContent: "flex-end" }}>
              <button type="button" className="stx-btn-secondary" onClick={onFechar} disabled={ocupado}>Cancelar</button>
              <button type="button" className="stx-btn-primary" onClick={() => void confirmar()} disabled={!podeConfirmar} style={!podeConfirmar ? { opacity: 0.45, cursor: "not-allowed" } : undefined}>
                {ocupado ? "Processando…" : desativando ? "DESATIVAR FUNCIONÁRIO" : "REATIVAR FUNCIONÁRIO"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
