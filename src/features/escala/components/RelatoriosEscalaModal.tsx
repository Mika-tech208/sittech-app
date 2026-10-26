"use client";

// "GERAR PDF" da Escala: gera uma NOVA VERSÃO imutável (Escala planejada ou Revezamento executado) e lista as versões da semana. O sistema decide parcial/final;
// o usuário só escolhe o tipo. O conteúdo vem do banco no servidor — nada digitável aqui. Download = o PDF armazenado, nunca reconstruído.
import { useCallback, useEffect, useRef, useState } from "react";
import { formatarDataHoraBR, weekLabel } from "@/lib/date";
import { buscarLista, finalAutomaticoDisponivel, tokenDaSessao as token, type ListaRelatorios as Lista } from "../relatoriosApi";

export default function RelatoriosEscalaModal({ semanaInicio, onFechar }: { semanaInicio: string; onFechar: () => void }) {
  const [lista, setLista] = useState<Lista | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const versoesRef = useRef<HTMLDivElement | null>(null);

  const aplicarResultado = useCallback((r: { ok: true; dados: Lista } | { ok: false; erro: string }) => {
    if (r.ok) { setErro(null); setLista(r.dados); } else setErro(r.erro);
  }, []);
  useEffect(() => {
    let vivo = true;
    void (async () => {
      const r = await buscarLista(semanaInicio);
      if (vivo) aplicarResultado(r);
    })();
    return () => { vivo = false; };
  }, [semanaInicio, aplicarResultado]);

  async function baixar(id: string, nome: string) {
    const t = await token();
    if (!t) return;
    const r = await fetch(`/api/escala/relatorios/${id}/pdf`, { headers: { Authorization: `Bearer ${t}` } });
    if (!r.ok) { setErro("Não foi possível baixar o PDF."); return; }
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement("a");
    a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async function gerar(tipo: "planejada" | "executada") {
    setOcupado(tipo); setErro(null); setAviso(null);
    const t = await token();
    if (!t) { setOcupado(null); setErro("Sessão expirada."); return; }
    const r = await fetch("/api/escala/relatorios", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify({ semana_inicio: semanaInicio, tipo }) });
    const j = await r.json().catch(() => ({}));
    setOcupado(null);
    if (!r.ok) { setErro(j?.erro || "Falha ao gerar o relatório."); return; }
    setAviso(`Gerado ${j.codigo} v${j.versao} (${j.status === "final" ? "FINAL" : "PARCIAL"}).`);
    aplicarResultado(await buscarLista(semanaInicio));
    await baixar(j.id, j.nomeArquivo);
  }

  const nomeTipo = (t: string) => (t === "executada" ? "Revezamento executado" : "Escala planejada");
  const proxima = (tipo: "planejada" | "executada") => (lista?.relatorios.filter((r) => r.tipo === tipo).reduce((m, r) => Math.max(m, r.versao), 0) ?? 0) + 1;
  const statusSistema = lista?.status === "final" ? "FINAL" : "PARCIAL";

  return (
    <div className="stx-modal-backdrop" onClick={onFechar}>
      <div className="stx-modal-card" role="dialog" aria-label="Relatórios em PDF" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 760, maxHeight: "88vh", overflow: "auto" }}>
        <p className="stx-modal-titulo">Relatórios em PDF — {weekLabel(semanaInicio)}</p>
        <p className="stx-panel-sub" style={{ marginTop: 0 }}>
          Cada geração cria uma <b>nova versão imutável</b> (conteúdo congelado + hash SHA-256 + QR de verificação). Se a semana ainda está em andamento o relatório sai como <b>PARCIAL</b>;
          a partir do fechamento (<b>sexta-feira 18:00</b>; sábado 18:00 se o sábado for produtivo), como <b>FINAL</b> — o sistema decide.
          {lista?.status && <> Agora, um relatório gerado seria <b>{statusSistema}</b>{lista.status === "parcial" && lista.elegivelFinalEm ? ` (final a partir de ${formatarDataHoraBR(lista.elegivelFinalEm)})` : ""}.</>}
        </p>
        {lista && (
          <p className="stx-panel-sub" style={{ marginTop: 0 }}>
            <b>Fechamento automático:</b>{" "}
            {lista.fechamento.ativo && lista.fechamento.desdeSemana && semanaInicio >= lista.fechamento.desdeSemana
              ? <>ligado — o Revezamento executado é finalizado e arquivado{lista.fechamento.fechamentoLogicoEm ? ` em ${formatarDataHoraBR(lista.fechamento.fechamentoLogicoEm)}` : ""}; depois é só baixar e imprimir (sem envio por e-mail).</>
              : <>não se aplica a esta semana (desligado ou anterior à semana inicial).</>}
            {lista.fechamento.geracaoStatus === "erro" && <span style={{ color: "var(--danger)" }}> Falha ao gerar ({lista.fechamento.geracaoTentativas} tentativa(s)): {lista.fechamento.geracaoUltimoErro}. O sistema tenta novamente sozinho.</span>}
          </p>
        )}
        {(() => {
          const f = finalAutomaticoDisponivel(lista);
          if (!f) return null;
          const fim = new Date(Date.parse(`${semanaInicio}T12:00:00Z`) + 6 * 86400_000).toISOString().slice(0, 10);
          const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
          return (
            <div style={{ border: "1px solid var(--accent)", borderRadius: 8, padding: "10px 12px", margin: "8px 0", fontSize: 13 }}>
              <div style={{ fontWeight: 700 }}>RELATÓRIO FINAL DISPONÍVEL</div>
              <div>Semana: {br(semanaInicio)} a {br(fim)}</div>
              <div>Gerado: {formatarDataHoraBR(f.geradoEm)}</div>
              <div>Código: {f.codigo} · Versão: v{f.versao}</div>
              <div style={{ color: "var(--text-muted)" }}>Disponível para impressão e coleta das assinaturas.</div>
              {f.alteracoesPosteriores && <div style={{ color: "var(--warning)" }}>Existem alterações posteriores aos dados utilizados neste relatório.</div>}
              <div style={{ display: "flex", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
                <button type="button" className="stx-btn-primary" onClick={() => void baixar(f.id, `SITTECH_Revezamento_${semanaInicio}_v${f.versao}_executado.pdf`)}>BAIXAR PDF</button>
                <a href={`/relatorios/escala/verificar/${f.id}`} target="_blank" rel="noreferrer" className="stx-btn-secondary" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>VERIFICAR</a>
                <button type="button" className="stx-btn-secondary" onClick={() => versoesRef.current?.scrollIntoView({ behavior: "smooth" })}>VER VERSÕES</button>
              </div>
            </div>
          );
        })()}
        <div className="stx-form-actions" style={{ justifyContent: "flex-start", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="stx-btn-primary" disabled={!!ocupado || !lista} onClick={() => void gerar("executada")}>
            {ocupado === "executada" ? "Gerando…" : `Revezamento executado (nova versão v${proxima("executada")})`}
          </button>
          <button type="button" className="stx-btn-secondary" disabled={!!ocupado || !lista} onClick={() => void gerar("planejada")}>
            {ocupado === "planejada" ? "Gerando…" : `Escala planejada (nova versão v${proxima("planejada")})`}
          </button>
        </div>
        {aviso && <p className="stx-panel-sub" style={{ color: "var(--accent)" }}>{aviso}</p>}
        {erro && <p style={{ color: "var(--danger)", fontSize: 13 }}>{erro}</p>}

        <div ref={versoesRef} style={{ marginTop: 14 }}>
          <b style={{ fontSize: 13 }}>Versões geradas desta semana</b>
          {!lista && !erro && <p className="stx-panel-sub">Carregando…</p>}
          {lista && lista.relatorios.length === 0 && <p className="stx-panel-sub">Nenhum relatório gerado para esta semana ainda.</p>}
          {lista?.relatorios.map((r) => (
            <div key={r.id} style={{ borderTop: "1px solid var(--border)", padding: "8px 0", fontSize: 13 }}>
              <div><b>{r.codigo}</b> · v{r.versao} · {nomeTipo(r.tipo)} · <b>{r.status === "final" ? "FINAL" : "PARCIAL"}</b>{r.fechamentoAutomatico && <> · <b>Gerado automaticamente</b></>}</div>
              <div style={{ color: "var(--text-muted)" }}>
                Gerado em {formatarDataHoraBR(r.geradoEm)}{r.geradoPor ? ` por ${r.geradoPor}` : r.fechamentoAutomatico ? " pelo sistema" : ""}{r.status === "parcial" ? ` · dados até ${formatarDataHoraBR(r.consolidadoAte)}` : ""} · SHA-256 {r.hash.slice(0, 12)}…
              </div>
              {r.alteracoesPosteriores && <div style={{ color: "var(--warning)" }}>Existem alterações posteriores aos dados utilizados neste relatório. A v{r.versao} não é alterada; gere uma nova versão manualmente para incluí-las (nenhuma versão nova é gerada automaticamente).</div>}
              <div style={{ display: "flex", gap: 10, marginTop: 4, flexWrap: "wrap" }}>
                <button type="button" className="stx-btn-secondary" onClick={() => void baixar(r.id, `SITTECH_Revezamento_${semanaInicio}_v${r.versao}_${r.tipo === "executada" ? "executado" : "planejado"}.pdf`)}>Baixar PDF</button>
                <a href={`/relatorios/escala/verificar/${r.id}`} target="_blank" rel="noreferrer" className="stx-btn-secondary" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>Página de verificação</a>
              </div>
            </div>
          ))}
        </div>
        <div className="stx-form-actions" style={{ justifyContent: "flex-end", marginTop: 12 }}>
          <button type="button" className="stx-btn-secondary" onClick={onFechar}>Fechar</button>
        </div>
      </div>
    </div>
  );
}
