"use client";

// Cobertura da equipe na Previsão Semanal.
//
// Pergunta que responde ANTES de gerar a Escala: "a carga programada é suficiente para manter
// 100% da equipe produtiva ocupada?". A resposta vem do MESMO motor que depois gera a Escala
// (rota /api/escala/simular-cobertura) — aqui não existe nenhuma fórmula paralela.
//
// - Previsto = compromisso da semana e NUNCA muda por causa desta tela.
// - Adicional = carga extra (produto acabado) só para ocupar capacidade ociosa. É uma camada
//   separada: o usuário aplica a sugestão (revisável) ou digita; ao editar, a consequência é
//   recalculada na hora. Nada é salvo sem o clique em "Salvar carga adicional".
// - Nenhuma comparação entre funcionários.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { analisarCoberturaNoServidor } from "@/lib/escala/disparar";
import type { SimulacaoCobertura } from "@/lib/escala/simularCobertura";
import type { CoberturaSemana, CausaOciosidade } from "@/features/escala/cobertura";
import { formatBRL, formatQtd, toNumber } from "@/lib/format";
import type { PrevisaoItem } from "@/types/domain";

const ESTILOS = `
.stx-cob-topo { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap; }
.stx-cob-acoes { display:flex; gap:8px; flex-wrap:wrap; }
.stx-cob-hero { margin:14px 0 6px; }
.stx-cob-pct { font-size:30px; font-weight:800; line-height:1.1; }
.stx-cob-sub { color:var(--text-muted); font-size:13px; margin:2px 0; }
.stx-cob-alerta { margin:8px 0; padding:10px 12px; border-radius:10px; font-size:13px; background:rgba(240,173,78,.14); color:var(--warning); }
.stx-cob-ok { margin:8px 0; padding:10px 12px; border-radius:10px; font-size:13px; background:rgba(60,200,140,.12); color:var(--accent); }
.stx-cob-bloco { margin-top:16px; }
.stx-cob-bloco h3 { font-size:13px; font-weight:700; margin:0 0 6px; text-transform:uppercase; letter-spacing:.04em; color:var(--text-muted); }
.stx-cob-linha { display:flex; justify-content:space-between; gap:12px; padding:7px 0; border-bottom:1px solid var(--border, rgba(255,255,255,.08)); font-size:13px; flex-wrap:wrap; }
.stx-cob-linha small { display:block; color:var(--text-muted); }
.stx-cob-tabela { width:100%; border-collapse:collapse; font-size:13px; }
.stx-cob-tabela th { text-align:right; font-weight:600; color:var(--text-muted); padding:6px 6px; border-bottom:1px solid var(--border, rgba(255,255,255,.12)); white-space:nowrap; }
.stx-cob-tabela th:first-child, .stx-cob-tabela td:first-child { text-align:left; }
.stx-cob-tabela td { text-align:right; padding:7px 6px; border-bottom:1px solid var(--border, rgba(255,255,255,.08)); vertical-align:top; }
.stx-cob-input { width:96px; text-align:right; }
.stx-cob-dica { color:var(--text-muted); font-size:12px; margin:4px 0 0; }
.stx-cob-grade { display:grid; gap:4px; font-size:12px; overflow-x:auto; }
.stx-cob-cel { padding:4px 6px; border-radius:6px; text-align:center; min-width:46px; }
.stx-cob-rolagem { overflow-x:auto; }
.stx-cob-neg { color:var(--danger); }
`;

const ROTULO_CAUSA: Record<CausaOciosidade, { titulo: string; explica: string }> = {
  carga: { titulo: "Falta de carga", explica: "Existe máquina selecionada livre, mas a quantidade programada acabou." },
  maquina_nao_selecionada: { titulo: "Falta de máquina/posto selecionado", explica: "Há recurso compatível do roteiro que não foi selecionado na Previsão." },
  recurso_indisponivel: { titulo: "Recurso indisponível", explica: "A máquina que a etapa usaria está indisponível." },
  sem_recurso_compativel: { titulo: "Sem recurso possível", explica: "Não há máquina livre nem compatível para ocupar essas pessoas." },
};
const ORDEM_CAUSAS: CausaOciosidade[] = ["carga", "maquina_nao_selecionada", "recurso_indisponivel", "sem_recurso_compativel"];
const NOMES_PERIODO: Record<string, string> = { m1: "M1", m2: "M2", m3: "M3", t1: "T1", t2: "T2", t3: "T3" };

function pct(v: number): string {
  return `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}
function horas(min: number): string {
  return `${(min / 60).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h`;
}
function dataCurta(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

export interface CoberturaEquipeProps {
  semanaInicio: string;
  itens: PrevisaoItem[]; // previstos (salvos ou, em modo simulação, os simulados)
  modoSimulacao: boolean;
  salvando: boolean;
  onSalvarAdicional: (adicionalPorItemId: Record<string, number>) => Promise<boolean>;
}

export default function CoberturaEquipe({ semanaInicio, itens, modoSimulacao, salvando, onSalvarAdicional }: CoberturaEquipeProps) {
  const salvos = useMemo(() => Object.fromEntries(itens.map((i) => [i.id, String(i.quantidadeAdicional ?? 0)])), [itens]);
  const assinatura = useMemo(() => `${semanaInicio}|${itens.map((i) => `${i.id}:${i.quantidade}:${i.quantidadeAdicional ?? 0}:${JSON.stringify(i.maquinasPorEtapa ?? {})}`).join(",")}`, [semanaInicio, itens]);

  const [rascunho, setRascunho] = useState<Record<string, string>>(salvos);
  const [analise, setAnalise] = useState<SimulacaoCobertura | null>(null);
  const [sugestao, setSugestao] = useState<SimulacaoCobertura["sugestao"]>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [expandido, setExpandido] = useState(false);
  const [gravando, setGravando] = useState(false);
  const seq = useRef(0);
  const jaAnalisou = useRef(false);

  // Mudou a semana/itens salvos: volta ao que está gravado e descarta análise e sugestão antigas.
  useEffect(() => {
    setRascunho(salvos);
    setAnalise(null);
    setSugestao(null);
    setErro(null);
    setAviso(null);
    jaAnalisou.current = false;
  }, [assinatura, salvos]);

  const itensPayload = useCallback(
    (r: Record<string, string>) =>
      itens.map((i) => ({
        produto_id: i.produtoId,
        quantidade: i.quantidade,
        valor_unitario: i.valorUnitario,
        quantidade_adicional: Math.max(0, toNumber(r[i.id] ?? 0) || 0),
        maquinas_por_etapa: i.maquinasPorEtapa ?? {},
      })),
    [itens]
  );

  const executar = useCallback(
    async (r: Record<string, string>, comSugestao: boolean) => {
      const minha = ++seq.current;
      setCarregando(true);
      setErro(null);
      const resp = await analisarCoberturaNoServidor(semanaInicio, { sugerir: comSugestao, itens: itensPayload(r) });
      if (minha !== seq.current) return; // chegou uma análise mais nova
      setCarregando(false);
      if (!resp.ok) {
        setErro(resp.erro);
        return;
      }
      jaAnalisou.current = true;
      setAnalise(resp.dados);
      if (comSugestao) setSugestao(resp.dados.sugestao);
    },
    [semanaInicio, itensPayload]
  );

  // edição manual: recalcula a cobertura e mostra a consequência (depois da 1ª análise)
  useEffect(() => {
    if (!jaAnalisou.current) return;
    const t = setTimeout(() => void executar(rascunho, false), 700);
    return () => clearTimeout(t);
  }, [rascunho, executar]);

  const nomeMaq = (id: string) => analise?.nomes.maquinas[id] ?? "máquina";
  const nomeProd = (id: string) => (analise?.nomes.produtos[id] ?? itens.find((i) => i.produtoId === id)?.produtoNome ?? "produto").trim();
  const nomeEtapa = (id: string | null) => (id ? analise?.nomes.etapas[id] ?? "etapa" : "—");

  const alterado = itens.some((i) => (toNumber(rascunho[i.id] ?? 0) || 0) !== (i.quantidadeAdicional ?? 0));

  function aplicarSugestao() {
    if (!sugestao) return;
    const novo: Record<string, string> = { ...rascunho };
    const primeiroPorProduto = new Map<string, string>();
    itens.forEach((i) => {
      if (!primeiroPorProduto.has(i.produtoId)) primeiroPorProduto.set(i.produtoId, i.id);
      novo[i.id] = "0";
    });
    sugestao.porProduto.forEach((p) => {
      const itemId = primeiroPorProduto.get(p.produtoId);
      if (itemId) novo[itemId] = String(p.adicionalSugerido);
    });
    setRascunho(novo);
    setAviso("Sugestão carregada na coluna Adicional para você revisar. Nada foi salvo ainda.");
  }

  async function salvar() {
    if (modoSimulacao || gravando) return;
    setGravando(true);
    setAviso(null);
    const ok = await onSalvarAdicional(Object.fromEntries(itens.map((i) => [i.id, Math.max(0, toNumber(rascunho[i.id] ?? 0) || 0)])));
    setGravando(false);
    setAviso(ok ? "Carga adicional salva. O previsto não foi alterado." : "Não foi possível salvar a carga adicional.");
  }

  const cob: CoberturaSemana | null = analise?.atual ?? null;
  const c = cob?.porCausa;
  const horasDeCausa = (k: CausaOciosidade) => (c ? c[k].minutos : 0);
  const pessoasDeCausa = (k: CausaOciosidade) => (c ? c[k].pessoasPeriodo : 0);
  const cargaMin = horasDeCausa("carga");
  const maqMin = horasDeCausa("maquina_nao_selecionada");

  let conclusao: string | null = null;
  if (cob && cob.minutosSemPosto > 0) {
    if (cargaMin > 0 && maqMin === 0) conclusao = "Falta de PEÇAS: existe capacidade ociosa nas máquinas já selecionadas. Programar mais produção (carga adicional) pode ocupar a equipe.";
    else if (maqMin > 0 && cargaMin === 0) conclusao = "Aumentar a quantidade NÃO resolve: faltam postos/máquinas selecionados na Previsão.";
    else if (maqMin > 0 && cargaMin > 0) conclusao = `Parte é falta de peças (${horas(cargaMin)}) e parte é falta de postos/máquinas (${horas(maqMin)}): só programar mais quantidade não resolve tudo.`;
  }

  return (
    <div className="stx-panel">
      <style>{ESTILOS}</style>
      <div className="stx-cob-topo">
        <div>
          <p className="stx-panel-title">Cobertura da equipe</p>
          <p className="stx-panel-sub">
            Simula a Escala desta semana com o mesmo motor que a gera, para saber se a programação ocupa toda a equipe produtiva.
            Considera dias produtivos, equipe selecionada e ausências já registradas, nos períodos ainda não iniciados.
          </p>
        </div>
        <div className="stx-cob-acoes">
          <button className="stx-prev-pill-btn" disabled={carregando || salvando} onClick={() => void executar(rascunho, false)}>
            {carregando && !cob ? "Analisando…" : "Analisar cobertura"}
          </button>
          <button className="stx-prev-pill-btn" disabled={carregando || salvando} onClick={() => void executar(rascunho, true)} title="Calcula a carga adicional que fecha produto acabado, usando o mesmo motor">
            Sugerir carga adicional
          </button>
        </div>
      </div>

      {erro && <p className="stx-save-error">{erro}</p>}
      {aviso && <p className="stx-cob-sub">{aviso}</p>}

      {!cob && !erro && <p className="stx-cob-dica">Clique em “Analisar cobertura” para ver a situação da semana.</p>}

      {cob && analise && (
        <>
          {cob.minutosDisponiveis === 0 ? (
            <p className="stx-cob-alerta">Nenhum funcionário disponível nos períodos ainda não iniciados desta semana (verifique equipe produtiva, dias produtivos e se a semana já passou).</p>
          ) : (
            <>
              <div className="stx-cob-hero">
                <p className="stx-cob-pct" style={{ color: cob.percentual >= 99.95 ? "var(--accent)" : "var(--warning)" }}>
                  Cobertura da equipe: {pct(cob.percentual)}
                </p>
                <p className="stx-cob-sub">
                  {cob.minutosSemPosto === 0
                    ? "Toda a equipe tem posto em todos os períodos analisados."
                    : `${cob.pessoasPeriodoSemPosto} períodos-pessoa / ${horas(cob.minutosSemPosto)} de trabalho sem carga`}
                </p>
              </div>
              {cob.minutosSemPosto > 0 ? <p className="stx-cob-alerta">Programação insuficiente para ocupar toda a equipe.</p> : <p className="stx-cob-ok">A programação ocupa toda a equipe.</p>}
              {analise.somentePrevisto.minutosSemPosto !== cob.minutosSemPosto && (
                <p className="stx-cob-sub">
                  Só com o previsto: {pct(analise.somentePrevisto.percentual)} ({horas(analise.somentePrevisto.minutosSemPosto)} sem posto). Com a carga adicional informada: {pct(cob.percentual)}.
                </p>
              )}

              {cob.minutosSemPosto > 0 && (
                <div className="stx-cob-bloco">
                  <h3>Por que a equipe fica sem posto?</h3>
                  {ORDEM_CAUSAS.filter((k) => pessoasDeCausa(k) > 0).map((k) => (
                    <div className="stx-cob-linha" key={k}>
                      <span>
                        <b>{ROTULO_CAUSA[k].titulo}</b>
                        <small>{ROTULO_CAUSA[k].explica}</small>
                      </span>
                      <span>{pessoasDeCausa(k)} períodos-pessoa · {horas(horasDeCausa(k))}</span>
                    </div>
                  ))}
                  {conclusao && <p className="stx-cob-sub" style={{ marginTop: 8 }}><b>{conclusao}</b></p>}
                </div>
              )}

              {(analise.recursosCompativeis.length > 0 || analise.etapasSemMaquina.length > 0) && (
                <div className="stx-cob-bloco">
                  <h3>Recursos compatíveis do roteiro que não estão selecionados</h3>
                  {analise.etapasSemMaquina.map((e) => (
                    <div className="stx-cob-linha" key={`${e.produtoId}|${e.etapaId}`}>
                      <span><b>{nomeProd(e.produtoId)} › {nomeEtapa(e.etapaId)}</b><small>Etapa sem nenhuma máquina selecionada — o produto não fecha. Compatíveis: {e.compativeis.map(nomeMaq).join(", ") || "nenhuma cadastrada"}</small></span>
                    </div>
                  ))}
                  {analise.recursosCompativeis.slice(0, 8).map((r) => (
                    <div className="stx-cob-linha" key={r.maquinaId}>
                      <span>
                        <b>{nomeMaq(r.maquinaId)}</b>
                        <small>para {r.poolsAfetados.map((p) => `${nomeProd(p.produtoId)} › ${nomeEtapa(p.etapaId)}`).join(", ")}</small>
                      </span>
                      <span>
                        sozinha: −{horas(r.ganhoMinutos)} sem posto · cobertura → {pct(r.coberturaApos)}
                        {r.comCargaAdicional && r.comCargaAdicional.pecas > 0 && (
                          <small><b>com carga adicional (+{formatQtd(r.comCargaAdicional.pecas)} peças): cobertura → {pct(r.comCargaAdicional.coberturaApos)}</b></small>
                        )}
                      </span>
                    </div>
                  ))}
                  {analise.recursosCombinado && (
                    <p className="stx-cob-sub">
                      Todos juntos: cobertura → {pct(analise.recursosCombinado.coberturaApos)} (−{horas(analise.recursosCombinado.ganhoMinutos)} sem posto)
                      {analise.recursosCombinado.comCargaAdicional && analise.recursosCombinado.comCargaAdicional.pecas > 0 && <> — e com a carga adicional correspondente (+{formatQtd(analise.recursosCombinado.comCargaAdicional.pecas)} peças): <b>{pct(analise.recursosCombinado.comCargaAdicional.coberturaApos)}</b></>}.
                    </p>
                  )}
                  {!sugestao && analise.recursosCompativeis.length > 0 && (
                    <p className="stx-cob-dica">Um recurso novo sozinho só antecipa o trabalho já programado; o ganho maior aparece junto com carga adicional — clique em “Sugerir carga adicional” para ver o efeito combinado.</p>
                  )}
                  <p className="stx-cob-dica">Nada é selecionado automaticamente: se concordar, adicione a máquina ao item da Previsão.</p>
                </div>
              )}

              <div className="stx-cob-bloco">
                <button className="stx-prev-pill-btn" onClick={() => setExpandido((v) => !v)}>{expandido ? "Ocultar" : "Ver"} por dia/período</button>
                {expandido && (
                  <div className="stx-cob-rolagem" style={{ marginTop: 8 }}>
                    <table className="stx-cob-tabela">
                      <thead>
                        <tr><th>Dia</th><th>Cobertura</th>{["m1", "m2", "m3", "t1", "t2", "t3"].map((p) => <th key={p}>{NOMES_PERIODO[p]}</th>)}</tr>
                      </thead>
                      <tbody>
                        {cob.dias.map((d) => (
                          <tr key={d.data}>
                            <td>{dataCurta(d.data)}</td>
                            <td>{pct(d.percentual)}</td>
                            {["m1", "m2", "m3", "t1", "t2", "t3"].map((pid) => {
                              const p = d.periodos.find((x) => x.periodoId === pid);
                              if (!p) return <td key={pid}>—</td>;
                              const causas = ORDEM_CAUSAS.filter((k) => p.causas[k] > 0).map((k) => `${ROTULO_CAUSA[k].titulo}: ${p.causas[k]}`).join(" · ");
                              return (
                                <td key={pid} title={causas || "equipe toda ocupada"} style={{ color: p.semPosto > 0 ? "var(--warning)" : "var(--text-muted)" }}>
                                  {p.semPosto > 0 ? `${p.semPosto} sem posto` : "ok"}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="stx-cob-dica">Passe o mouse (ou toque) numa célula para ver a causa. Números são pessoas sem posto no período — sem identificar funcionários.</p>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}

      <div className="stx-cob-bloco">
        <h3>Previsto × Adicional × Total programado</h3>
        <div className="stx-cob-rolagem">
          <table className="stx-cob-tabela">
            <thead>
              <tr><th>Produto</th><th>Previsto</th><th>Adicional</th><th>Total programado</th>{analise && <th>Absorvido</th>}{sugestao && <th>Sugerido</th>}</tr>
            </thead>
            <tbody>
              {itens.map((i) => {
                const adic = Math.max(0, toNumber(rascunho[i.id] ?? 0) || 0);
                const linha = analise?.adicional.find((a) => a.produtoId === i.produtoId);
                const sug = sugestao?.porProduto.find((p) => p.produtoId === i.produtoId);
                return (
                  <tr key={i.id}>
                    <td>{i.produtoNome}</td>
                    <td>{formatQtd(i.quantidade)}</td>
                    <td>
                      <input
                        className="stx-input stx-cob-input"
                        type="number"
                        min={0}
                        inputMode="numeric"
                        aria-label={`Quantidade adicional de ${i.produtoNome}`}
                        value={rascunho[i.id] ?? "0"}
                        onChange={(e) => setRascunho((r) => ({ ...r, [i.id]: e.target.value }))}
                      />
                    </td>
                    <td>{formatQtd(i.quantidade + adic)}</td>
                    {analise && (
                      <td className={linha && adic > 0 && linha.adicionalAbsorvido < adic ? "stx-cob-neg" : undefined} title="O que a capacidade ociosa realmente absorve (todas as etapas do produto)">
                        {adic > 0 && linha ? formatQtd(linha.adicionalAbsorvido) : "—"}
                      </td>
                    )}
                    {sugestao && <td>{sug ? (sug.adicionalSugerido > 0 ? formatQtd(sug.adicionalSugerido) : "0") : "—"}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {analise && itens.some((i) => {
          const adic = Math.max(0, toNumber(rascunho[i.id] ?? 0) || 0);
          const l = analise.adicional.find((a) => a.produtoId === i.produtoId);
          return adic > 0 && l && l.adicionalAbsorvido < adic;
        }) && <p className="stx-cob-dica stx-cob-neg">Parte do adicional programado não cabe na capacidade ociosa (em vermelho): essa parte não ocupará ninguém.</p>}
        <p className="stx-cob-dica">
          O adicional é uma camada separada e só ocupa quem ficaria sem posto; o previsto, o atingimento e o faturamento previsto continuam exatamente como estão.
        </p>
        <div className="stx-cob-acoes" style={{ marginTop: 10 }}>
          {sugestao && sugestao.totalPecas > 0 && (
            <button className="stx-prev-pill-btn" onClick={aplicarSugestao} disabled={carregando}>Aplicar sugestão</button>
          )}
          <button className="stx-prev-pill-btn-primary" disabled={!alterado || modoSimulacao || gravando || salvando} onClick={() => void salvar()}>
            {gravando ? "Salvando…" : "Salvar carga adicional"}
          </button>
          {alterado && <button className="stx-prev-pill-btn" onClick={() => setRascunho(salvos)} disabled={gravando}>Desfazer edição</button>}
        </div>
        {modoSimulacao && <p className="stx-cob-dica">Em modo simulação a carga adicional só pode ser analisada — saia da simulação para salvar.</p>}
      </div>

      {sugestao && (
        <div className="stx-cob-bloco">
          <h3>Sugestão de carga adicional (produto acabado)</h3>
          {sugestao.totalPecas > 0 ? (
            <p className="stx-cob-sub">
              <b>+{formatQtd(sugestao.totalPecas)} peças</b> de produto acabado. Cobertura sobe de {pct(analise?.somentePrevisto.percentual ?? 0)} para <b>{pct(sugestao.coberturaApos.percentual)}</b>;
              ainda sem posto: {sugestao.coberturaApos.pessoasPeriodoSemPosto} períodos-pessoa / {horas(sugestao.coberturaApos.minutosSemPosto)}.
              {" "}Faturamento potencial do adicional (indicador à parte, <u>não</u> soma ao previsto): <b>{formatBRL(sugestao.valorPotencial)}</b>.
            </p>
          ) : (
            <p className="stx-cob-alerta">Nenhuma carga adicional fecha produto acabado com as máquinas atualmente selecionadas — veja abaixo o que limita cada produto.</p>
          )}
          {sugestao.porProduto.map((p) => (
            <div className="stx-cob-linha" key={p.produtoId}>
              <span>
                <b>{nomeProd(p.produtoId)}</b>
                <small>
                  {p.adicionalSugerido > 0
                    ? "todas as etapas do produto absorvem o mesmo adicional (fecha produto acabado, sem estoque intermediário)"
                    : p.motivoSemSugestao === "etapa_sem_maquina"
                      ? "há etapa sem máquina selecionada: o produto não fecha"
                      : `a etapa ${nomeEtapa(p.etapaLimitanteId)} não tem capacidade ociosa para absorver adicional${p.recursosEtapaLimitante.length > 0 ? ` — para fechar produto acabado, selecione: ${p.recursosEtapaLimitante.map(nomeMaq).join(" ou ")}` : ""}`}
                </small>
                {p.adicionalSugerido === 0 && p.motivoSemSugestao !== "etapa_sem_maquina" && (
                  <small>capacidade ociosa por etapa: {p.porEtapa.map((e) => `${nomeEtapa(e.etapaId)} ${formatQtd(e.absorveria)}`).join(" · ")}</small>
                )}
              </span>
              <span>{p.adicionalSugerido > 0 ? `+${formatQtd(p.adicionalSugerido)}` : "0"}</span>
            </div>
          ))}
          {sugestao.recursosRestantes.length > 0 && (
            <p className="stx-cob-sub">
              Mesmo com a sugestão, selecionar {sugestao.recursosRestantes.slice(0, 3).map((r) => nomeMaq(r.maquinaId)).join(", ")} reduziria ainda mais a ociosidade.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
