"use client";

// "FECHAR PERÍODO E GERAR PRÓXIMA PROGRAMAÇÃO" — tela única do tablet. Apontamentos + estoque intermediário físico + confirmação + recálculo + publicação.
// Campo físico SEMPRE nasce vazio (nunca preenchido com o estimado). A janela de troca pertence a quem abriu esta tela (apontamentos do período só por ele).
import { useEffect, useMemo, useRef, useState } from "react";
import { limiteMotivo } from "@/features/escala/fechamento/validacao";
import { DIFERENCA_EXIGE_CONFIRMACAO } from "@/features/escala/fechamento/tipos";
import PostosProgramadosFechamento from "./PostosProgramadosFechamento";
import { etapaEstoqueLiberada } from "./textos";
import { abrirFechamentoApi, confirmarFechamentoApi, estadoFechamentoApi, retryFechamentoApi, type AberturaApi, type DiagnosticoApi, type ResultadoApi } from "./api";

const MOTIVOS = ["Contagem anterior errada", "Peças perdidas / refugo", "Estoque movido", "Outro"] as const;
const fmt = (n: number) => Math.round(n).toLocaleString("pt-BR");
const seg = (ms: number) => `${(ms / 1000).toFixed(1).replace(".", ",")} s`;

type Fase = "carregando" | "form" | "salvando" | "recalculando" | "confirmado" | "erro_recalculo" | "bloqueado";

export interface FechamentoPeriodoModalProps { data: string; periodoId: string; onFechar: () => void; onConcluido?: () => void }

export default function FechamentoPeriodoModal({ data, periodoId, onFechar, onConcluido }: FechamentoPeriodoModalProps) {
  const [chave] = useState(() => crypto.randomUUID());               // idempotência: duplo clique/reenvio não duplica nada
  const [fase, setFase] = useState<Fase>("carregando");
  const [ab, setAb] = useState<AberturaApi | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [diagnosticos, setDiagnosticos] = useState<DiagnosticoApi[]>([]);
  const [opcoesAbertas, setOpcoesAbertas] = useState(false);
  const [valores, setValores] = useState<Record<string, string>>({}); // vazio por padrão
  const [motivos, setMotivos] = useState<Record<string, string>>({});
  const [confirmaGrande, setConfirmaGrande] = useState<string[] | null>(null);
  const [resultado, setResultado] = useState<ResultadoApi | null>(null);
  const [semPostos, setSemPostos] = useState(false);               // não foi possível carregar os postos programados: volta ao aviso antigo (lançar pelo painel)
  const [excecao, setExcecao] = useState(false);
  const [motivoExcecao, setMotivoExcecao] = useState("");
  const enviando = useRef(false);
  const dialogoRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { if (confirmaGrande) dialogoRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }); }, [confirmaGrande]);

  const [recarregar, setRecarregar] = useState(0);
  useEffect(() => {
    let vivo = true;
    void abrirFechamentoApi(data, periodoId).then((r) => {
      if (!vivo) return;
      if (r.status !== 200 || !("ok" in r.corpo)) { setErro(r.corpo.erro ?? "Não foi possível abrir o fechamento."); setDiagnosticos(("erros" in r.corpo && r.corpo.erros) || []); setFase("bloqueado"); return; }
      setErro(null); setAb(r.corpo); setFase("form");
    }).catch(() => { if (vivo) { setErro("Falha de rede ao abrir o fechamento."); setFase("bloqueado"); } });
    return () => { vivo = false; };
  }, [data, periodoId, recarregar]);
  const abrir = () => setRecarregar((n) => n + 1);

  const linhas = useMemo(() => (ab?.buffers ?? []).map((b) => {
    const txt = valores[b.buffer_id] ?? "";
    const fisico = txt.trim() === "" ? null : Number(txt.replace(/\./g, "").replace(",", "."));
    const valido = fisico !== null && Number.isInteger(fisico) && fisico >= 0;
    const dif = valido && b.estimado !== null ? (fisico as number) - b.estimado : null;
    const exigeMotivo = valido && dif !== null && Math.abs(dif) > limiteMotivo(fisico as number);
    const grande = valido && dif !== null && (b.estimado ?? 0) > 0 && Math.abs(dif) / Math.max(b.estimado ?? 1, 1) > DIFERENCA_EXIGE_CONFIRMACAO;
    return { ...b, txt, fisico: valido ? (fisico as number) : null, valido, dif, exigeMotivo, grande, motivo: motivos[b.buffer_id] ?? "" };
  }), [ab, valores, motivos]);

  const pendentes = ab?.postos.filter((p) => p.status === "pendente") ?? [];
  const tudoPreenchido = linhas.every((l) => l.valido && (!l.exigeMotivo || l.motivo.length > 0));
  const pode = ab && pendentes.length === 0 && (excecao ? motivoExcecao.trim().length >= 5 : tudoPreenchido) && fase === "form";

  async function enviar(confirmouGrande: boolean) {
    if (!ab || enviando.current) return;                              // duplo clique
    enviando.current = true; setFase("salvando"); setErro(null);
    let vivo = true; // resposta atrasada do polling NUNCA pode sobrescrever o estado final (confirmado/erro)
    const timer = setTimeout(() => setFase((f) => (f === "salvando" ? "recalculando" : f)), 700);
    const poll = setInterval(async () => { const e = await estadoFechamentoApi(data, periodoId); if (vivo && e.corpo.estado === "RECALCULANDO") setFase((f) => (f === "salvando" ? "recalculando" : f)); }, 900);
    try {
      const r = await confirmarFechamentoApi({ data, periodoId, chave, confirmouDiferencaGrande: confirmouGrande, ...(excecao ? { excecaoMotivo: motivoExcecao.trim() } : {}),
        buffers: excecao ? [] : linhas.map((l) => ({ buffer_id: l.buffer_id, fisico: l.fisico, motivo: l.motivo || null })) });
      const c = r.corpo;
      if (r.status === 422 && c.exigeConfirmacao?.length) { setConfirmaGrande(c.exigeConfirmacao); setFase("form"); return; }
      if (c.estado === "CONFIRMADO") { setResultado(c); setFase("confirmado"); onConcluido?.(); return; }
      if (c.estado === "ERRO_RECALCULO" || c.estado === "RECALCULANDO") { setResultado(c); setFase("erro_recalculo"); return; }
      setErro(c.erros?.[0]?.mensagem ?? c.mensagem ?? c.erro ?? "Fechamento não aceito."); setFase("form");
    } catch (e) { setErro(e instanceof Error ? e.message : "Falha de rede. Tente novamente."); setFase("form"); }
    finally { vivo = false; clearTimeout(timer); clearInterval(poll); enviando.current = false; }
  }
  async function tentarDeNovo() {
    if (!resultado?.fechamentoId || enviando.current) return;
    enviando.current = true; setFase("recalculando");
    try {
      const r = await retryFechamentoApi(resultado.fechamentoId);
      setResultado(r.corpo);
      setFase(r.corpo.estado === "CONFIRMADO" ? "confirmado" : "erro_recalculo");
      if (r.corpo.estado === "CONFIRMADO") onConcluido?.();
    } catch { setFase("erro_recalculo"); } finally { enviando.current = false; }
  }

  const rotulo = ab?.periodo.rotulo ?? periodoId.toUpperCase();
  const proximo = ab?.periodo.proximo?.rotulo ?? "próximo período";
  return (
    <div className="stx-modal-backdrop" role="dialog" aria-modal="true" aria-label={`Fechamento ${rotulo}`}>
      <style>{`
        .stx-fech-card{background:var(--surface);border-radius:16px;width:100%;max-width:720px;max-height:94vh;overflow-y:auto;padding:22px 24px;font-family:var(--font-body);color:var(--text);box-shadow:0 30px 70px -30px rgba(0,0,0,.95)}
        .stx-fech-h{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
        .stx-fech-t{font-size:24px;font-weight:700;letter-spacing:-.02em;margin:0}
        .stx-fech-sec{margin-top:18px}.stx-fech-sec>h3{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-3);margin:0 0 8px}
        .stx-fech-ok{display:flex;align-items:center;gap:8px;font-size:18px;font-weight:600;color:var(--accent)}
        .stx-fech-warn{color:var(--warning);font-weight:600;font-size:16px}
        .stx-fech-buf{border:1px solid var(--border,rgba(128,128,128,.25));border-radius:12px;padding:12px 14px;margin-bottom:10px}
        .stx-fech-buf .nome{font-size:17px;font-weight:600}.stx-fech-buf .est{font-size:14px;color:var(--text-3);margin-top:2px}
        .stx-fech-in{width:100%;font-size:30px;font-weight:700;text-align:right;padding:10px 14px;border-radius:10px;border:2px solid var(--border,rgba(128,128,128,.35));background:var(--bg,transparent);color:var(--text);margin-top:8px;font-variant-numeric:tabular-nums}
        .stx-fech-in:focus{outline:none;border-color:var(--accent)}
        .stx-fech-dif{font-size:13px;margin-top:6px;color:var(--text-3)}.stx-fech-dif.alerta{color:var(--warning);font-weight:600}
        .stx-fech-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.stx-fech-chip{padding:8px 12px;border-radius:999px;border:1px solid var(--border,rgba(128,128,128,.4));background:transparent;color:var(--text);font-size:14px;cursor:pointer}.stx-fech-chip.on{background:var(--accent);color:var(--on-accent);border-color:var(--accent)}
        .stx-fech-go{width:100%;min-height:64px;font-size:17px;font-weight:700;margin-top:16px;border-radius:14px;border:none;background:var(--accent);color:var(--on-accent);cursor:pointer;letter-spacing:.01em}.stx-fech-go:disabled{opacity:.45;cursor:not-allowed}
        .stx-fech-prog{width:100%;border-collapse:collapse;font-size:14px;margin-top:8px}.stx-fech-prog td,.stx-fech-prog th{padding:6px 8px;text-align:left;border-bottom:1px solid rgba(128,128,128,.2)}.stx-fech-prog td:last-child,.stx-fech-prog th:last-child{text-align:right}
        .stx-fech-estado{font-size:22px;font-weight:700;margin:6px 0}.stx-fech-estado.ok{color:var(--accent)}.stx-fech-estado.err{color:var(--warning)}
        @media (max-width:640px){.stx-fech-card{padding:16px;max-width:none}}
      `}</style>
      <div className="stx-fech-card" onClick={(e) => e.stopPropagation()}>
        <div className="stx-fech-h">
          <h2 className="stx-fech-t">FECHAMENTO {rotulo}</h2>
          {(fase === "form" || fase === "bloqueado" || fase === "confirmado" || fase === "erro_recalculo") && <button type="button" className="stx-ap-modal-close" onClick={onFechar} aria-label="Fechar">✕</button>}
        </div>

        {fase === "carregando" && <p className="stx-fech-sec">Carregando estimativas do sistema…</p>}
        {fase === "bloqueado" && (
          <>
            <p className="stx-save-error" role="alert">{diagnosticos.length > 0 ? "Este período NÃO pode ser fechado oficialmente:" : erro}</p>
            {diagnosticos.map((d, i) => (
              <div key={i} className="stx-fech-buf" role="alert" style={{ borderColor: "var(--warning)" }}>
                <div className="nome">{d.codigo === "BUFFER_FISICO_NAO_CADASTRADO" ? "Buffer físico não cadastrado" : d.codigo === "SEMANA_SEM_CORTE_V1" ? "Semana sem corte-v1" : d.codigo}</div>
                <div className="est">{d.detalhes?.produto ? `${d.detalhes.produto} · ${d.detalhes.etapaOrigem} → ${d.detalhes.etapaDestino}` : d.mensagem}</div>
                {d.detalhes?.rota && <div className="est">Rota: {d.detalhes.rota} · semana {d.detalhes.semana} · período {String(d.detalhes.periodo ?? "").toUpperCase()}</div>}
              </div>
            ))}
            {diagnosticos.length > 0 && <p style={{ fontSize: 13, color: "var(--text-3)" }}>Avise o administrador: o cadastro de buffers precisa estar completo para o fechamento físico valer.</p>}
            <button type="button" className="stx-ap-btn-secondary" onClick={onFechar}>Fechar</button>
          </>
        )}

        {ab && (fase === "form" || fase === "salvando" || fase === "recalculando") && (
          <>
            <div className="stx-fech-sec">
              {semPostos ? (
                <>
                  <h3>Apontamentos</h3>
                  {pendentes.length === 0
                    ? <div className="stx-fech-ok">✓ {ab.postos.length}/{ab.postos.length} coletados</div>
                    : <div><div className="stx-fech-warn" role="alert">⚠ {ab.postos.length - pendentes.length}/{ab.postos.length} — faltam: {pendentes.map((p) => p.nome).join(", ")}</div>
                        <p style={{ fontSize: 13, color: "var(--text-3)", margin: "6px 0" }}>Lance os apontamentos pendentes no painel (fica liberado só para você nesta troca) e toque em Atualizar.</p>
                        <button type="button" className="stx-ap-btn-secondary" onClick={() => abrir()} disabled={fase !== "form"}>Atualizar</button></div>}
                </>
              ) : (
                // postos PROGRAMADOS do período, pré-preenchidos pela escala; gravação pelas RPCs legadas do painel
                <PostosProgramadosFechamento data={data} periodoId={periodoId} rotulo={rotulo} fimMs={ab.periodo.fim_ms} bloqueado={fase !== "form"} onIndisponivel={() => setSemPostos(true)} onSalvo={() => abrir()} />
              )}
            </div>

            {!etapaEstoqueLiberada(ab.postos) && <p className="stx-fech-sec" style={{ fontSize: 14, color: "var(--text-3)" }} role="status">O estoque físico é pedido depois que todos os postos estiverem resolvidos.</p>}
            {etapaEstoqueLiberada(ab.postos) && (
            <div className="stx-fech-sec">
              <h3>Estoque intermediário</h3>
              {excecao ? (
                <div className="stx-ap-field"><label className="stx-ap-field-label">Motivo da exceção (obrigatório, fica auditado)</label>
                  <textarea className="stx-ap-input" rows={3} value={motivoExcecao} onChange={(e) => setMotivoExcecao(e.target.value)} placeholder="Ex.: galpão interditado — não foi possível acessar o estoque" /></div>
              ) : linhas.map((l) => (
                <div key={l.buffer_id} className="stx-fech-buf">
                  <div className="nome">{l.rotulo}</div>
                  <div className="est">Estimado pelo sistema: {l.estimado === null ? "—" : fmt(l.estimado)}{l.estimado_lo !== null && l.estimado_hi !== null && l.estimado_lo !== l.estimado_hi ? ` (${fmt(l.estimado_lo)}–${fmt(l.estimado_hi)})` : ""}</div>
                  <input className="stx-fech-in" inputMode="numeric" pattern="[0-9]*" autoComplete="off" aria-label={`Físico: ${l.rotulo}`} placeholder="Físico" value={l.txt === "" ? "" : fmt(Number(l.txt))} disabled={fase !== "form"}
                    onChange={(e) => setValores((v) => ({ ...v, [l.buffer_id]: e.target.value.replace(/[^0-9]/g, "").slice(0, 9) }))} />
                  {l.dif !== null && <div className={`stx-fech-dif ${l.exigeMotivo ? "alerta" : ""}`}>Diferença: {l.dif > 0 ? "+" : ""}{fmt(l.dif)} peças{l.exigeMotivo ? " — escolha o motivo" : ""}</div>}
                  {l.exigeMotivo && <div className="stx-fech-chips">{MOTIVOS.map((m) => <button type="button" key={m} className={`stx-fech-chip ${l.motivo === m ? "on" : ""}`} onClick={() => setMotivos((x) => ({ ...x, [l.buffer_id]: m }))}>{m}</button>)}</div>}
                </div>
              ))}
              {ab.pode_excecao && (
                <div style={{ marginTop: 10, fontSize: 12.5 }}>
                  <button type="button" onClick={() => setOpcoesAbertas((x) => !x)} disabled={fase !== "form"} style={{ background: "none", border: "none", color: "var(--text-3)", cursor: "pointer", padding: 0, textDecoration: "underline" }}>Opções do administrador</button>
                  {opcoesAbertas && <div style={{ marginTop: 6 }}><button type="button" className="stx-ap-btn-secondary" onClick={() => setExcecao((x) => !x)} disabled={fase !== "form"}>{excecao ? "Voltar à contagem" : "Fechar SEM contagem (emergência — fica auditado e a programação será parcialmente estimada)"}</button></div>}
                </div>
              )}
            </div>
            )}

            {ab.alertas.length > 0 && <p style={{ fontSize: 13, color: "var(--warning)", marginTop: 10 }} role="status">[modo sombra] {ab.alertas.length} alerta(s) de cadastro: {ab.pares_sem_buffer.map((p) => `${p.produto} ${p.etapaOrigem}→${p.etapaDestino}`).join("; ")}. Em modo ativo isto BLOQUEARIA o fechamento.</p>}
            {erro && <p className="stx-save-error" role="alert" style={{ marginTop: 12 }}>{erro}</p>}
            {confirmaGrande && (
              <div ref={dialogoRef} className="stx-fech-buf" role="alertdialog" style={{ borderColor: "var(--warning)" }}>
                <div className="nome">Confirme os valores</div>
                {linhas.filter((l) => confirmaGrande.includes(l.buffer_id)).map((l) => <div key={l.buffer_id} className="est">{l.rotulo}: <b>{fmt(l.fisico ?? 0)}</b> em vez de {fmt(l.estimado ?? 0)}</div>)}
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button type="button" className="stx-ap-btn-primary" style={{ flex: 1 }} onClick={() => { setConfirmaGrande(null); void enviar(true); }}>Confirmo</button>
                  <button type="button" className="stx-ap-btn-secondary" style={{ flex: 1 }} onClick={() => setConfirmaGrande(null)}>Corrigir</button>
                </div>
              </div>
            )}
            {(fase === "salvando" || fase === "recalculando") ? (
              <div className="stx-fech-estado" role="status" aria-live="polite">{fase === "salvando" ? "Salvando estado físico…" : `Recalculando ${proximo}…`}</div>
            ) : (
              <button type="button" className="stx-fech-go" disabled={!pode} onClick={() => void enviar(false)}>FECHAR {rotulo} E GERAR {proximo}</button>
            )}
          </>
        )}

        {fase === "confirmado" && resultado && (
          <div className="stx-fech-sec" role="status">
            <div className={`stx-fech-estado ${resultado.parcial ? "err" : "ok"}`}>{resultado.mensagem ?? `${proximo} CONFIRMADO`}</div>
            {resultado.tempos && <p style={{ fontSize: 13, color: "var(--text-3)", margin: 0 }}>Fechamento concluído em {seg(resultado.tempos.total)}</p>}
            {resultado.programacao && resultado.programacao.length > 0 && (
              <table className="stx-fech-prog"><thead><tr><th>Posto</th><th>Pessoa</th><th>Produto</th><th>Peças</th></tr></thead>
                <tbody>{resultado.programacao.map((p, i) => <tr key={i}><td>{p.maquina}</td><td>{p.pessoa}</td><td>{p.produto}</td><td>{fmt(p.pecas)}</td></tr>)}</tbody></table>
            )}
            <button type="button" className="stx-fech-go" onClick={onFechar}>Liberar as máquinas</button>
          </div>
        )}

        {fase === "erro_recalculo" && (
          <div className="stx-fech-sec" role="alert">
            <div className="stx-fech-estado err">Estoque salvo. Programação ainda não gerada.</div>
            <p style={{ fontSize: 14, color: "var(--text-3)" }}>{(resultado?.erros?.[0]?.mensagem ?? "O recálculo não foi concluído.").replace(/\.?$/, ".")} A contagem não precisa ser refeita.</p>
            <button type="button" className="stx-fech-go" onClick={() => void tentarDeNovo()}>Tentar gerar a programação de novo</button>
          </div>
        )}
      </div>
    </div>
  );
}
