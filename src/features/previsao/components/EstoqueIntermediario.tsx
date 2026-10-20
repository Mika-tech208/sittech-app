"use client";

// Estoque intermediário (WIP) na Previsão — bloco recolhível e simples (não é um módulo de estoque).
// ESTIMADO é só consulta; só o CONFIRMADO entra no planejamento (reduz o que a etapa origem precisa produzir).
// Sem permissão específica (admin ou `escala_wip_confirmar`) a tela é somente leitura. Só aparece com o WIP ativo.

import { useCallback, useEffect, useMemo, useState } from "react";
import { acaoWip, consultarWip, type RespostaWip } from "@/lib/escala/wipCliente";
import type { ResumoControleWip } from "@/features/escala/wipSaldo";
import type { Produto } from "@/types/domain";
import { formatQtd, toNumber } from "@/lib/format";
import Recolhivel from "@/features/previsao/components/Recolhivel";
import { alertaInconsistencia, exigeMotivo, linhaLimiteWip, linhaPrevistoWip, resumoCabecalhoWip, ROTULO_STATUS_WIP, textoUltimaConfirmacao } from "@/features/previsao/estoqueIntermediarioTexto";

const ESTILOS = `
.stx-wip-card { border:1px solid var(--border, rgba(255,255,255,.14)); border-radius:12px; padding:12px 14px; margin:10px 0; }
.stx-wip-topo { display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; align-items:baseline; }
.stx-wip-par { font-weight:700; }
.stx-wip-grade { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:8px 14px; margin:8px 0; font-size:13px; }
.stx-wip-grade small { display:block; color:var(--text-muted); font-size:11px; text-transform:uppercase; letter-spacing:.04em; }
.stx-wip-grade b { font-size:16px; }
.stx-wip-alerta { margin:6px 0; padding:8px 10px; border-radius:8px; font-size:13px; background:rgba(240,90,90,.12); color:var(--danger); }
.stx-wip-form { display:flex; gap:8px; flex-wrap:wrap; align-items:flex-end; margin-top:8px; }
.stx-wip-form label { display:flex; flex-direction:column; gap:3px; font-size:12px; color:var(--text-muted); }
`;

const COR_STATUS = { sem_saldo: "var(--text-muted)", estimado: "var(--warning)", confirmado: "var(--accent)", divergencia: "var(--danger)" } as const;

export interface EstoqueIntermediarioProps {
  semanaInicio: string;
  produtos: Produto[];
}

export default function EstoqueIntermediario({ semanaInicio, produtos }: EstoqueIntermediarioProps) {
  const [dados, setDados] = useState<RespostaWip | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [aberto, setAberto] = useState<{ id: string; modo: "confirmar" | "ajustar" } | null>(null);
  const [qtd, setQtd] = useState("");
  const [motivo, setMotivo] = useState("");
  const [gravando, setGravando] = useState(false);
  const [novo, setNovo] = useState<{ produtoId: string; par: string; saldo: string } | null>(null);

  const nomeProduto = useCallback((id: string) => produtos.find((p) => p.id === id)?.nome.trim() ?? "produto", [produtos]);
  const nomeEtapa = useCallback((produtoId: string, etapaId: string) => produtos.find((p) => p.id === produtoId)?.roteiro.find((e) => e.id === etapaId)?.operacao ?? "etapa", [produtos]);

  const carregar = useCallback(async () => {
    const r = await consultarWip(semanaInicio);
    if (!r.ok) { setErro(r.erro); return; }
    setErro(null);
    setDados(r);
  }, [semanaInicio]);
  useEffect(() => {
    let vivo = true;
    (async () => {
      const r = await consultarWip(semanaInicio);
      if (!vivo) return;
      if (!r.ok) setErro(r.erro);
      else { setErro(null); setDados(r); }
    })();
    return () => { vivo = false; };
  }, [semanaInicio]);

  const pares = useMemo(
    () => produtos.flatMap((p) => p.roteiro.slice(0, -1).map((e, k) => ({ chave: `${p.id}|${e.id}|${p.roteiro[k + 1].id}`, produtoId: p.id, origem: e.id, seguinte: p.roteiro[k + 1].id, rotulo: `${p.nome.trim()} — ${e.operacao} → ${p.roteiro[k + 1].operacao}` }))),
    [produtos]
  );

  if (!dados || !dados.modoWip) return null; // WIP desligado (ou sem acesso): o bloco não existe

  async function enviar(corpo: Record<string, unknown>, ok: string) {
    setGravando(true);
    setAviso(null);
    const r = await acaoWip({ ...corpo, semana: semanaInicio });
    setGravando(false);
    if (!r.ok) { setAviso(r.erro); return; }
    setAviso(ok);
    setAberto(null);
    setQtd("");
    setMotivo("");
    setNovo(null);
    await carregar();
  }

  function abrir(c: ResumoControleWip, modo: "confirmar" | "ajustar") {
    setAberto({ id: c.controle.id, modo });
    setQtd(modo === "confirmar" ? String(Math.max(0, Math.round(c.estimado.valor))) : "");
    setMotivo("");
    setAviso(null);
  }

  return (
    <div className="stx-panel">
      <style>{ESTILOS}</style>
      <Recolhivel id="previsao-estoque-intermediario" titulo="Estoque intermediário" resumo={resumoCabecalhoWip(dados.controles)}>
        <p className="stx-panel-sub">
          Peças já produzidas pela etapa de origem e ainda aguardando a etapa seguinte. O <b>estimado</b> vem da Produção Real e serve só para consulta; somente o saldo <b>confirmado</b> reduz o que a etapa de origem precisa produzir. O previsto salvo, o realizado e o faturamento não mudam.
        </p>
        {erro && <p className="stx-save-error">{erro}</p>}
        {aviso && <p className="stx-cob-sub">{aviso}</p>}
        {!dados.podeAlterar && <p className="stx-cob-dica">Somente leitura: confirmar e ajustar exige a permissão de estoque intermediário (ou administrador).</p>}
        {dados.controles.length === 0 && <p className="stx-cob-dica">Nenhum par de etapas está sendo controlado ainda.</p>}

        {dados.controles.map((c) => {
          const id = c.controle.id;
          const estimadoTxt = formatQtd(Math.round(c.estimado.valor));
          const divergente = aberto?.modo === "confirmar" && aberto.id === id && exigeMotivo(toNumber(qtd) || 0, Math.round(c.estimado.valor));
          return (
            <div className="stx-wip-card" key={id}>
              <div className="stx-wip-topo">
                <span className="stx-wip-par">{nomeProduto(c.controle.produtoId)} — {nomeEtapa(c.controle.produtoId, c.controle.etapaOrigemId)} → {nomeEtapa(c.controle.produtoId, c.controle.etapaSeguinteId)}</span>
                <span className="stx-badge" style={{ color: COR_STATUS[c.status], background: "rgba(255,255,255,.06)" }}>{ROTULO_STATUS_WIP[c.status]}</span>
              </div>
              <div className="stx-wip-grade">
                <div><small>Estimado</small><b>{estimadoTxt}</b></div>
                <div><small>Confirmado disponível</small><b>{formatQtd(Math.round(c.confirmadoDisponivel))}</b></div>
                <div><small>Usado nesta semana</small><b>{formatQtd(Math.round(c.alocado))}</b></div>
                <div><small>Última confirmação</small><b style={{ fontSize: 13 }}>{textoUltimaConfirmacao(c)}</b></div>
              </div>
              <p className="stx-cob-sub">{linhaPrevistoWip(c)}</p>
              {linhaLimiteWip(c) && <p className="stx-cob-sub" style={{ color: c.acimaDoLimite ? "var(--danger)" : undefined }}>{linhaLimiteWip(c)}</p>}
              {c.estimado.valor < 0 && <p className="stx-cob-dica">Estimado negativo: a etapa seguinte consumiu mais do que a origem produziu — nenhum estoque é inventado.</p>}
              {c.inconsistencias.map((i) => <p className="stx-wip-alerta" key={i.codigo}>{alertaInconsistencia(i)}</p>)}

              {dados.podeAlterar && aberto?.id !== id && (
                <div className="stx-cob-acoes" style={{ marginTop: 8 }}>
                  <button className="stx-prev-pill-btn-primary" onClick={() => abrir(c, "confirmar")}>Confirmar saldo</button>
                  <button className="stx-prev-pill-btn" onClick={() => abrir(c, "ajustar")}>Ajustar</button>
                </div>
              )}
              {aberto?.id === id && (
                <div className="stx-wip-form">
                  <label>
                    {aberto.modo === "confirmar" ? "Quantidade confirmada (peças)" : "Ajuste (+ soma / − tira)"}
                    <input className="stx-input stx-cob-input" type="number" inputMode="numeric" aria-label={aberto.modo === "confirmar" ? "Quantidade confirmada" : "Ajuste"} value={qtd} onChange={(e) => setQtd(e.target.value)} />
                  </label>
                  {(aberto.modo === "ajustar" || divergente) && (
                    <label style={{ flex: "1 1 220px" }}>
                      Motivo (obrigatório{aberto.modo === "confirmar" ? ": difere do estimado" : ""})
                      <input className="stx-input" aria-label="Motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                    </label>
                  )}
                  <button
                    className="stx-prev-pill-btn-primary"
                    disabled={gravando || qtd.trim() === "" || ((aberto.modo === "ajustar" || divergente) && motivo.trim().length < 3)}
                    onClick={() => void enviar(
                      aberto.modo === "confirmar"
                        ? { acao: "confirmar", controle_id: id, quantidade: toNumber(qtd) || 0, motivo: motivo.trim() || null, chave: crypto.randomUUID() }
                        : { acao: "ajustar", controle_id: id, quantidade: toNumber(qtd) || 0, motivo: motivo.trim(), chave: crypto.randomUUID() },
                      aberto.modo === "confirmar" ? "Saldo confirmado. A Escala será recalculada." : "Ajuste registrado. A Escala será recalculada."
                    )}
                  >
                    {gravando ? "Salvando…" : aberto.modo === "confirmar" ? "Confirmar" : "Registrar ajuste"}
                  </button>
                  <button className="stx-prev-pill-btn" disabled={gravando} onClick={() => setAberto(null)}>Cancelar</button>
                </div>
              )}
            </div>
          );
        })}

        {dados.podeAlterar && (
          <div style={{ marginTop: 10 }}>
            {!novo ? (
              <button className="stx-prev-pill-btn" onClick={() => setNovo({ produtoId: "", par: "", saldo: "0" })}>Controlar novo par de etapas</button>
            ) : (
              <div className="stx-wip-form">
                <label style={{ flex: "1 1 260px" }}>
                  Produto e etapas
                  <select className="stx-input" value={novo.par} onChange={(e) => setNovo({ ...novo, par: e.target.value })}>
                    <option value="">Selecione…</option>
                    {pares.map((p) => <option key={p.chave} value={p.chave}>{p.rotulo}</option>)}
                  </select>
                </label>
                <label>
                  Saldo inicial (peças)
                  <input className="stx-input stx-cob-input" type="number" inputMode="numeric" min={0} value={novo.saldo} onChange={(e) => setNovo({ ...novo, saldo: e.target.value })} />
                </label>
                <button
                  className="stx-prev-pill-btn-primary"
                  disabled={gravando || !novo.par}
                  onClick={() => {
                    const [produto_id, etapa_origem_id, etapa_seguinte_id] = novo.par.split("|");
                    void enviar({ acao: "criar_controle", produto_id, etapa_origem_id, etapa_seguinte_id, data_inicio: dados.hoje, saldo_inicial: Math.max(0, toNumber(novo.saldo) || 0) }, "Controle criado.");
                  }}
                >
                  Criar controle
                </button>
                <button className="stx-prev-pill-btn" onClick={() => setNovo(null)}>Cancelar</button>
              </div>
            )}
          </div>
        )}
      </Recolhivel>
    </div>
  );
}
