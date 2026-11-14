"use client";

// PAINEL DE METAS DA FÁBRICA (TV) — apresentação PURA: recebe o modelo já calculado (metasTv.ts). Sem banco, sem relógio de escala, sem nenhum dado financeiro.
// Leitura a distância: poucos textos, números grandes, a MARCA DE 100% alinhada em todos os cards (a barra passa dela quando a meta — que é mínimo — é superada).
// Cor: verde Sittech só no progresso e na confirmação; neutros para o resto; âmbar apenas para conexão pendente (problema real). Movimento: só o preenchimento
// da barra (700 ms) — respeita prefers-reduced-motion.
import { useEffect, useMemo, useState } from "react";
import { ESCALA_MAX_PCT, formatDiaMes, formatPecas, formatPercentual, larguraBarraPct, paginar, posicaoMarcaMeta, prioridades, type CardMeta, type ModeloTv } from "./metasTv";

export type ConexaoTv = "carregando" | "ok" | "pendente" | "erro";
export interface PainelMetasTvProps {
  modelo: ModeloTv | null;
  /** "HH:MM" da última leitura bem-sucedida (relógio do servidor) */
  atualizadoEm: string | null;
  conexao: ConexaoTv;
  erro?: string | null;
  /** fixa a visão (preview/teste): índice do slide; ausente = rotaciona sozinho */
  slideFixo?: number;
  intervaloSlideMs?: number;
  porPagina?: number;
  diagnostico?: string;
}

const CSS = `
.tvm { position:fixed; inset:0; background:#1D1D1B; color:#fff; font-family:var(--font-schibsted-grotesk),"Helvetica Neue",Helvetica,Arial,sans-serif; display:flex; flex-direction:column; overflow:hidden; color-scheme:dark;
  --verde:#30B09B; --card:#2B2B29; --trilho:#383836; --sec:#B2B2B1; --ter:#939392; --ambar:#F2A93B; }
.tvm * { box-sizing:border-box; }
.tvm-topo { display:grid; grid-template-columns: auto 1fr auto; align-items:center; gap:3vw; padding:3.2vh 3vw 2.4vh; }
.tvm-logo { height:5.6vh; width:auto; display:block; }
.tvm-titulo { display:flex; flex-direction:column; gap:.5vh; min-width:0; }
.tvm-titulo h1 { margin:0; font-size:clamp(20px,3.4vh,44px); font-weight:600; letter-spacing:-.01em; line-height:1.1; }
.tvm-periodo { font-size:clamp(15px,2.3vh,30px); color:var(--sec); font-weight:400; }
.tvm-geral { display:grid; grid-template-columns:auto auto; column-gap:1.6vw; align-items:center; justify-items:end; text-align:right; }
.tvm-geral-pct { font-size:clamp(34px,8.6vh,112px); font-weight:700; line-height:1; letter-spacing:-.02em; }
.tvm-geral-pct small { font-size:.5em; font-weight:600; margin-left:.06em; color:var(--sec); }
.tvm-geral-det { display:flex; flex-direction:column; gap:.4vh; align-items:flex-start; text-align:left; }
.tvm-geral-pecas { font-size:clamp(16px,3vh,40px); font-weight:600; }
.tvm-geral-nota { font-size:clamp(12px,1.9vh,24px); color:var(--ter); max-width:22vw; line-height:1.25; }
.tvm-atual { grid-column:1 / -1; display:flex; align-items:center; justify-content:flex-end; gap:1vw; font-size:clamp(12px,1.9vh,24px); color:var(--sec); margin-top:-.8vh; }
.tvm-ponto { width:1.1vh; height:1.1vh; min-width:8px; min-height:8px; border-radius:50%; background:var(--verde); display:inline-block; margin-right:.6vw; }
.tvm-atual.pendente { color:var(--ambar); font-weight:600; }
.tvm-atual.pendente .tvm-ponto { background:var(--ambar); }
.tvm-corpo { flex:1; min-height:0; padding:1vh 3vw 2vh; display:grid; gap:2.4vh 1.6vw; grid-template-columns:repeat(var(--colunas,3), minmax(0,1fr)); grid-template-rows:repeat(var(--linhas,2), minmax(0,1fr)); align-content:center; align-items:center; }
.tvm-card { background:var(--card); border:1px solid #383836; border-radius:12px; padding:2.4vh 1.6vw 2.2vh; display:flex; flex-direction:column; min-height:0; max-height:46vh; }
.tvm-card.atingida, .tvm-card.acima { border-color:rgba(48,176,155,.55); }
.tvm-nome { margin:0; font-size:clamp(17px,3.3vh,42px); font-weight:600; line-height:1.15; letter-spacing:-.005em; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; min-height:2.3em; text-wrap:balance; }
.tvm-meio { display:flex; align-items:flex-end; justify-content:space-between; gap:1vw; margin-top:auto; }
.tvm-pct { font-size:clamp(38px,9.6vh,124px); font-weight:700; line-height:.95; letter-spacing:-.025em; white-space:nowrap; }
.tvm-pct small { font-size:.46em; font-weight:600; margin-left:.05em; color:var(--sec); }
.tvm-card.atingida .tvm-pct, .tvm-card.acima .tvm-pct { color:var(--verde); }
.tvm-situacao { white-space:nowrap; text-align:right; display:flex; flex-direction:column; align-items:flex-end; gap:.3vh; padding-bottom:.6vh; min-width:0; }
.tvm-situacao-rotulo { font-size:clamp(13px,2vh,26px); color:var(--sec); }
.tvm-situacao-valor { font-size:clamp(20px,4.2vh,56px); font-weight:700; line-height:1; white-space:nowrap; }
.tvm-situacao.ok .tvm-situacao-rotulo { color:var(--verde); font-weight:600; font-size:clamp(14px,2.2vh,28px); }
.tvm-check { width:.95em; height:.95em; margin-right:.35em; vertical-align:-.1em; }
.tvm-situacao.ok .tvm-situacao-valor { color:#fff; }
.tvm-barra { position:relative; height:2.6vh; min-height:14px; margin:2vh 0 1.8vh; }
.tvm-trilho { position:absolute; inset:0; background:var(--trilho); border-radius:999px; overflow:hidden; }
.tvm-fill { position:absolute; left:0; top:0; bottom:0; background:var(--verde); border-radius:999px; transition:width .7s cubic-bezier(.22,.61,.36,1); }
.tvm-excesso { position:absolute; top:0; bottom:0; background:#fff; opacity:.92; transition:left .7s cubic-bezier(.22,.61,.36,1), width .7s cubic-bezier(.22,.61,.36,1); }
.tvm-marca { position:absolute; top:-.9vh; bottom:-.9vh; width:3px; margin-left:-1.5px; background:#fff; border-radius:2px; }
.tvm-dados { display:grid; grid-template-columns:1fr 1fr; gap:1vw; margin:0; }
.tvm-dado dt { font-size:clamp(12px,1.9vh,24px); color:var(--sec); margin:0 0 .2vh; font-weight:400; }
.tvm-dado dd { margin:0; font-size:clamp(17px,3.3vh,44px); font-weight:600; }
.tvm-dado:last-child { text-align:right; }
.tvm-rodape { display:flex; align-items:center; justify-content:space-between; gap:2vw; padding:1.6vh 3vw 2.4vh; border-top:1px solid #383836; font-size:clamp(13px,2vh,26px); color:var(--sec); min-height:6.5vh; }
.tvm-rodape b { color:#fff; font-weight:600; }
.tvm-notas { display:flex; flex-wrap:wrap; gap:.6vh 2.4vw; min-width:0; }
.tvm-pagina { display:flex; align-items:center; gap:.8vw; white-space:nowrap; }
.tvm-pagina i { width:1.4vh; height:1.4vh; min-width:9px; min-height:9px; border-radius:50%; background:var(--trilho); display:inline-block; }
.tvm-pagina i.on { background:#fff; }
.tvm-vazio { grid-column:1 / -1; align-self:center; text-align:center; color:var(--sec); font-size:clamp(20px,4vh,52px); line-height:1.3; }
.tvm-vazio b { display:block; color:#fff; font-size:1.15em; margin-bottom:1vh; font-weight:600; }
.tvm-uma .tvm-card { min-height:44vh; }
.tvm-grande .tvm-card { max-height:56vh; min-height:50vh; }
.tvm-grande .tvm-nome { font-size:clamp(20px,4.2vh,54px); }
.tvm-grande .tvm-meio { flex-direction:column; align-items:flex-start; gap:1.4vh; }
.tvm-grande .tvm-pct { font-size:clamp(52px,14.5vh,184px); }
.tvm-grande .tvm-situacao { flex-direction:row; align-items:baseline; gap:1vw; text-align:left; padding-bottom:0; }
.tvm-grande .tvm-situacao-rotulo { font-size:clamp(16px,2.8vh,36px); }
.tvm-grande .tvm-situacao-valor { font-size:clamp(26px,6vh,78px); }
.tvm-grande .tvm-barra { height:3.4vh; }
.tvm-grande .tvm-dado dd { font-size:clamp(19px,4vh,52px); }
@media (max-width: 1100px) { .tvm-topo { grid-template-columns:1fr; gap:1.4vh; } .tvm-geral { justify-items:start; text-align:left; } .tvm-atual { justify-content:flex-start; } .tvm-corpo { grid-template-columns:1fr; grid-template-rows:none; overflow:auto; } .tvm-card { max-height:none; } }
@media (prefers-reduced-motion: reduce) { .tvm-fill, .tvm-excesso { transition:none; } }
`;

function Card({ c }: { c: CardMeta }) {
  const largura = larguraBarraPct(c.percentual);
  const marca = posicaoMarcaMeta();
  const excesso = Math.max(largura - marca, 0);
  const verde = Math.min(largura, marca);
  const rotulo = `${c.nome}: ${formatPercentual(c.percentual)} da meta de ${formatPecas(c.meta)} peças. ${c.estado === "abaixo" ? `Faltam ${formatPecas(c.faltam)} peças.` : c.excedente > 0 ? `Meta atingida, ${formatPecas(c.excedente)} peças acima.` : "Meta atingida."}`;
  const [pct, un] = [formatPercentual(c.percentual).replace("%", ""), "%"];
  return (
    <article className={`tvm-card ${c.estado}`} aria-label={rotulo}>
      <h2 className="tvm-nome">{c.nome}</h2>
      <div className="tvm-meio">
        <div className="tvm-pct">{pct}<small>{un}</small></div>
        {c.estado === "abaixo" ? (
          <div className="tvm-situacao">
            <span className="tvm-situacao-rotulo">Faltam</span>
            <span className="tvm-situacao-valor">{formatPecas(c.faltam)}</span>
          </div>
        ) : (
          <div className="tvm-situacao ok">
            <span className="tvm-situacao-rotulo"><svg className="tvm-check" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false"><path d="M4 10.5l4 4 8-9" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>Meta atingida</span>
            {c.excedente > 0 && <span className="tvm-situacao-valor">+{formatPecas(c.excedente)}</span>}
          </div>
        )}
      </div>
      <div className="tvm-barra" role="progressbar" aria-valuemin={0} aria-valuemax={ESCALA_MAX_PCT} aria-valuenow={Math.min(Math.round(c.percentual), ESCALA_MAX_PCT)} aria-valuetext={rotulo}>
        <div className="tvm-trilho">
          <div className="tvm-fill" style={{ width: `${verde}%` }} />
          {excesso > 0 && <div className="tvm-excesso" style={{ left: `${marca}%`, width: `${excesso}%` }} />}
        </div>
        <span className="tvm-marca" style={{ left: `${marca}%` }} aria-hidden="true" />
      </div>
      <dl className="tvm-dados">
        <div className="tvm-dado"><dt>Produzido</dt><dd>{formatPecas(c.produzido)}</dd></div>
        <div className="tvm-dado"><dt>Meta</dt><dd>{formatPecas(c.meta)}</dd></div>
      </dl>
    </article>
  );
}

type Slide = { tipo: "geral" | "foco"; cards: CardMeta[]; rotulo: string };

export default function PainelMetasTv({ modelo, atualizadoEm, conexao, erro, slideFixo, intervaloSlideMs = 12000, porPagina = 6, diagnostico }: PainelMetasTvProps) {
  const slides = useMemo<Slide[]>(() => {
    if (!modelo) return [];
    const paginas = paginar(modelo.cards, porPagina);
    const lista: Slide[] = paginas.map((cards, i) => ({ tipo: "geral", cards, rotulo: paginas.length > 1 ? `Visão geral ${i + 1}/${paginas.length}` : "Visão geral" }));
    const foco = prioridades(modelo.cards, 3);
    if (modelo.cards.length > 3 && foco.length >= 2) lista.push({ tipo: "foco", cards: foco, rotulo: "Foco: abaixo da meta" });
    return lista;
  }, [modelo, porPagina]);

  const [indice, setIndice] = useState(0);
  useEffect(() => {
    if (slideFixo !== undefined || slides.length <= 1) return;
    const t = setInterval(() => setIndice((i) => (i + 1) % slides.length), intervaloSlideMs);
    return () => clearInterval(t);
  }, [slides.length, slideFixo, intervaloSlideMs]);
  const atual = slides.length === 0 ? null : slides[(slideFixo ?? indice) % slides.length];

  const r = modelo?.resumo;
  const n = atual?.cards.length ?? 0;
  const colunas = n <= 3 ? Math.max(n, 1) : n === 4 ? 2 : 3; // 4 cards = 2×2 (nunca 3+1)
  const linhas = !atual ? 1 : Math.max(Math.ceil(atual.cards.length / colunas), 1);

  return (
    <div className="tvm">
      <style>{CSS}</style>
      <header className="tvm-topo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="tvm-logo" src="/brand/sittech-horizontal-verde-branco.png" alt="Sittech" width={1969} height={446} />
        <div className="tvm-titulo">
          <h1>Produção da semana</h1>
          {modelo && <span className="tvm-periodo">{formatDiaMes(modelo.semanaInicio)} a {formatDiaMes(modelo.semanaFim)}</span>}
        </div>
        {r && r.percentual !== null && (
          <div className="tvm-geral">
            <div className="tvm-geral-pct">{formatPercentual(r.percentual).replace("%", "")}<small>%</small></div>
            <div className="tvm-geral-det">
              <span className="tvm-geral-pecas">{formatPecas(r.produzido)} / {formatPecas(r.meta)}&nbsp;peças</span>
              <span className="tvm-geral-nota">Soma simples de peças, não é capacidade da fábrica</span>
            </div>
          </div>
        )}
        <div className={`tvm-atual ${conexao === "pendente" || conexao === "erro" ? "pendente" : ""}`} role="status">
          {conexao === "pendente" || conexao === "erro"
            ? <span><span className="tvm-ponto" />Atualização pendente. Verifique a conexão{atualizadoEm ? ` · última às ${atualizadoEm}` : ""}</span>
            : <span><span className="tvm-ponto" />{atualizadoEm ? `Atualizado às ${atualizadoEm}` : "Carregando…"}</span>}
        </div>
      </header>

      <main className={`tvm-corpo ${atual?.tipo === "foco" ? "tvm-grande" : ""} ${linhas === 1 ? "tvm-uma" : ""}`} style={{ ["--colunas" as string]: colunas, ["--linhas" as string]: linhas }}>
        {!modelo ? (
          <div className="tvm-vazio">{erro ? <><b>Não foi possível carregar as metas</b>{erro}</> : <b>Carregando metas da semana…</b>}</div>
        ) : modelo.cards.length === 0 ? (
          <div className="tvm-vazio"><b>{modelo.existe ? "Nenhum produto com meta nesta semana" : "Previsão da semana ainda não cadastrada"}</b>As metas aparecem aqui assim que a Previsão semanal for registrada.</div>
        ) : (
          atual?.cards.map((c) => <Card key={c.produtoId} c={c} />)
        )}
      </main>

      <footer className="tvm-rodape">
        <div className="tvm-notas">
          {modelo?.encerrados.map((e) => <span key={e.produtoId}>Encerrado: <b>{e.nome}</b> · {formatPecas(e.produzido)} peças produzidas</span>)}
          {modelo?.semMeta.map((s) => <span key={s.produtoId}>Sem meta na semana: <b>{s.nome}</b> · {formatPecas(s.produzido)} peças</span>)}
        </div>
        <div className="tvm-pagina" aria-label={atual?.rotulo}>
          {slides.length > 1 && <>{slides.map((_, i) => <i key={i} className={i === ((slideFixo ?? indice) % slides.length) ? "on" : ""} />)}<span>{atual?.rotulo}</span></>}
          {diagnostico && <span style={{ color: "var(--ter)", fontSize: ".85em" }}>{diagnostico}</span>}
        </div>
      </footer>
    </div>
  );
}
