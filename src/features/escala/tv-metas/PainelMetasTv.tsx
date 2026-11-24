"use client";

// PAINEL DE METAS DA FÁBRICA (TV) — apresentação PURA: recebe o modelo já calculado (metasTv.ts). Sem banco, sem relógio de escala, sem nenhum dado financeiro.
// Composição (referência aprovada, 1920×1080): à esquerda o indicador geral da semana (arco aberto embaixo); à direita grade fixa 2×2 de produtos.
// Todas as medidas partem de --u (1 px de uma tela 1920×1080) e escalam juntas em outras TVs 16:9: os cards nunca encolhem para caber mais — mais de 4 produtos paginam.
// Cor: verde Sittech só no progresso e na confirmação; branco/cinza no resto. Movimento: só o preenchimento (700 ms) — respeita prefers-reduced-motion.
import { useEffect, useMemo, useState } from "react";
import { ESCALA_MAX_PCT, formatDiaMes, formatPecas, formatPercentual, larguraBarraPct, posicaoMarcaMeta, type CardMeta, type ModeloTv } from "./metasTv";

export type ConexaoTv = "carregando" | "ok" | "pendente" | "erro";
export interface PainelMetasTvProps {
  modelo: ModeloTv | null;
  /** "HH:MM" da última leitura bem-sucedida (relógio do servidor) */
  atualizadoEm: string | null;
  conexao: ConexaoTv;
  erro?: string | null;
  /** fixa a visão (preview/teste): índice da página; ausente = rotaciona sozinho */
  slideFixo?: number;
  intervaloSlideMs?: number;
  porPagina?: number;
  diagnostico?: string;
}

const CSS = `
.tvm { position:fixed; inset:0; background:#1D1D1B; color:#fff; font-family:var(--font-schibsted-grotesk,"Schibsted Grotesk"),"Helvetica Neue",Helvetica,Arial,sans-serif; overflow:hidden; color-scheme:dark;
  --u: min(calc(100vw / 1920), calc(100vh / 1080));
  --verde:#30B09B; --card:#262624; --borda:#383836; --trilho:#3A3A38; --sec:#B2B2B1; --ter:#8F8F8D; }
.tvm * { box-sizing:border-box; }
.tvm-quadro { position:absolute; left:50%; top:50%; width:calc(var(--u) * 1920); height:calc(var(--u) * 1080); transform:translate(-50%,-50%); }

/* topo */
.tvm-topo { position:absolute; left:calc(var(--u) * 56); right:calc(var(--u) * 56); top:calc(var(--u) * 40); height:calc(var(--u) * 96); display:flex; align-items:center; }
.tvm-logo { height:calc(var(--u) * 76); width:auto; display:block; }
.tvm-sep { width:2px; height:calc(var(--u) * 84); background:var(--borda); margin:0 calc(var(--u) * 44); }
.tvm-titulo h1 { margin:0; font-size:calc(var(--u) * 52); font-weight:700; letter-spacing:-.012em; line-height:1.05; }
.tvm-periodo { display:block; margin-top:calc(var(--u) * 6); font-size:calc(var(--u) * 32); color:var(--sec); font-weight:500; line-height:1.1; }
.tvm-atual { margin-left:auto; display:flex; align-items:center; gap:calc(var(--u) * 14); font-size:calc(var(--u) * 28); color:#fff; font-weight:500; align-self:flex-start; margin-top:calc(var(--u) * 12); }
.tvm-ponto { width:calc(var(--u) * 18); height:calc(var(--u) * 18); border-radius:50%; background:var(--verde); display:inline-block; flex:none; }
.tvm-atual.pendente { font-weight:700; }
.tvm-atual.pendente .tvm-ponto { background:transparent; border:3px solid #fff; }

/* indicador geral */
.tvm-geral { position:absolute; left:calc(var(--u) * 56); top:calc(var(--u) * 178); width:calc(var(--u) * 500); height:calc(var(--u) * 792); display:flex; flex-direction:column; align-items:center; }
.tvm-arco { position:relative; width:calc(var(--u) * 500); height:calc(var(--u) * 500); flex:none; }
.tvm-arco svg { position:absolute; inset:0; width:100%; height:100%; overflow:visible; }
.tvm-arco-trilho { fill:none; stroke:var(--trilho); stroke-width:34; stroke-linecap:round; }
.tvm-arco-fill { fill:none; stroke:var(--verde); stroke-width:34; stroke-linecap:round; transition:stroke-dasharray .7s cubic-bezier(.22,.61,.36,1); }
.tvm-arco-centro { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; padding-bottom:calc(var(--u) * 6); }
.tvm-arco-pct { font-size:calc(var(--u) * 132); font-weight:700; line-height:1; letter-spacing:-.03em; white-space:nowrap; }
.tvm-arco-pct.tres { font-size:calc(var(--u) * 108); }
.tvm-arco-pct small { font-size:.5em; font-weight:700; margin-left:.04em; letter-spacing:0; }
.tvm-arco-rot { margin-top:calc(var(--u) * 6); font-size:calc(var(--u) * 32); color:var(--sec); font-weight:500; }
.tvm-geral-nums { margin-top:calc(var(--u) * 6); width:100%; display:grid; grid-template-columns:1fr 2px 1fr; align-items:center; }
.tvm-geral-nums .vl { width:2px; height:calc(var(--u) * 84); background:var(--borda); }
.tvm-geral-num { text-align:center; }
.tvm-geral-num b { display:block; font-size:calc(var(--u) * 58); font-weight:700; line-height:1.05; letter-spacing:-.015em; }
.tvm-geral-num span { display:block; margin-top:calc(var(--u) * 6); font-size:calc(var(--u) * 28); color:var(--sec); font-weight:500; }
.tvm-geral-hr { width:calc(100% - var(--u) * 20); height:1px; background:var(--borda); margin:calc(var(--u) * 40) 0 calc(var(--u) * 32); }
.tvm-geral-nota { width:calc(100% - var(--u) * 20); display:flex; align-items:flex-start; gap:calc(var(--u) * 16); font-size:calc(var(--u) * 25); line-height:1.3; color:var(--ter); }
.tvm-geral-nota svg { flex:none; width:calc(var(--u) * 34); height:calc(var(--u) * 34); margin-top:calc(var(--u) * 2); }

/* grade 2×2 */
.tvm-grade { position:absolute; left:calc(var(--u) * 598); right:calc(var(--u) * 56); top:calc(var(--u) * 178); height:calc(var(--u) * 792); display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); grid-template-rows:repeat(2, minmax(0,1fr)); gap:calc(var(--u) * 24); }
.tvm-card { background:var(--card); border:1px solid var(--borda); border-radius:calc(var(--u) * 24); padding:calc(var(--u) * 30) calc(var(--u) * 38) calc(var(--u) * 32); display:flex; flex-direction:column; justify-content:space-between; min-width:0; min-height:0; overflow:hidden; }
.tvm-nome { margin:0; font-size:calc(var(--u) * 42); font-weight:700; line-height:1.1; letter-spacing:-.008em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.tvm-nome.longo { font-size:calc(var(--u) * 34); }
.tvm-meio { display:flex; align-items:center; justify-content:space-between; gap:calc(var(--u) * 20); height:calc(var(--u) * 126); }
.tvm-pct { font-size:calc(var(--u) * 112); font-weight:700; line-height:1; letter-spacing:-.035em; white-space:nowrap; }
.tvm-pct small { font-size:.5em; font-weight:700; margin-left:.05em; letter-spacing:0; color:var(--sec); }
.tvm-situacao { border-left:2px solid var(--borda); padding-left:calc(var(--u) * 34); text-align:right; white-space:nowrap; display:flex; flex-direction:column; gap:calc(var(--u) * 6); min-width:calc(var(--u) * 190); }
.tvm-situacao-rotulo { font-size:calc(var(--u) * 28); color:var(--sec); font-weight:500; line-height:1.1; }
.tvm-situacao-valor { font-size:calc(var(--u) * 52); font-weight:700; line-height:1; letter-spacing:-.01em; }
.tvm-situacao-valor small { font-size:.5em; font-weight:500; color:var(--sec); margin-left:.3em; letter-spacing:0; }
.tvm-situacao.ok .tvm-situacao-rotulo { color:var(--verde); font-weight:700; font-size:calc(var(--u) * 27); }
/* meta atingida/acima: o percentual ganha 3 dígitos ("100,0%", "123,0%"), então ele e o bloco de situação encolhem juntos para caber SEM sair do card */
.tvm-card.atingida .tvm-pct, .tvm-card.acima .tvm-pct { font-size:calc(var(--u) * 88); }
.tvm-card.atingida .tvm-situacao, .tvm-card.acima .tvm-situacao { padding-left:calc(var(--u) * 24); min-width:0; }
.tvm-situacao.ok .tvm-situacao-valor { font-size:calc(var(--u) * 42); }
.tvm-check { width:.9em; height:.9em; margin-right:.3em; vertical-align:-.08em; }
.tvm-barra { position:relative; height:calc(var(--u) * 30); }
.tvm-trilho { position:absolute; inset:0; background:var(--trilho); border-radius:999px; overflow:hidden; }
.tvm-fill { position:absolute; left:0; top:0; bottom:0; background:var(--verde); border-radius:999px; transition:width .7s cubic-bezier(.22,.61,.36,1); }
.tvm-excesso { position:absolute; top:0; bottom:0; background:#fff; opacity:.92; transition:left .7s cubic-bezier(.22,.61,.36,1), width .7s cubic-bezier(.22,.61,.36,1); }
.tvm-marca { position:absolute; top:calc(var(--u) * -10); bottom:calc(var(--u) * -10); width:3px; margin-left:-1.5px; background:#fff; border-radius:2px; }
.tvm-dados { display:grid; grid-template-columns:1fr 1fr; gap:calc(var(--u) * 20); margin:0; }
.tvm-dado dt { font-size:calc(var(--u) * 27); color:var(--sec); margin:0 0 calc(var(--u) * 4); font-weight:500; line-height:1.1; }
.tvm-dado dd { margin:0; font-size:calc(var(--u) * 50); font-weight:700; line-height:1.05; letter-spacing:-.012em; }
.tvm-dado:last-child { text-align:right; }

/* rodapé discreto */
.tvm-rodape { position:absolute; left:calc(var(--u) * 56); right:calc(var(--u) * 56); top:calc(var(--u) * 994); height:calc(var(--u) * 56); display:flex; align-items:center; justify-content:space-between; gap:calc(var(--u) * 40); font-size:calc(var(--u) * 24); color:var(--ter); }
.tvm-rodape b { color:var(--sec); font-weight:600; }
.tvm-notas { display:flex; flex-wrap:wrap; gap:calc(var(--u) * 4) calc(var(--u) * 44); min-width:0; }
.tvm-pagina { display:flex; align-items:center; gap:calc(var(--u) * 12); white-space:nowrap; color:var(--sec); }
.tvm-pagina i { width:calc(var(--u) * 14); height:calc(var(--u) * 14); border-radius:50%; background:var(--trilho); display:inline-block; }
.tvm-pagina i.on { background:#fff; }
.tvm-pagina span { margin-left:calc(var(--u) * 10); }
.tvm-vazio { grid-column:1 / -1; grid-row:1 / -1; align-self:center; text-align:center; color:var(--sec); font-size:calc(var(--u) * 40); line-height:1.3; }
.tvm-vazio b { display:block; color:#fff; font-size:1.15em; margin-bottom:calc(var(--u) * 12); font-weight:700; }
@media (prefers-reduced-motion: reduce) { .tvm-fill, .tvm-excesso, .tvm-arco-fill { transition:none; } }
`;

// Arco aberto embaixo: 260° de varredura, de baixo-esquerda por cima até baixo-direita (como na referência). Caminho único com pathLength=100 → o preenchimento é só um dasharray.
const VARREDURA = 260;
function caminhoArco(raio: number, cx: number, cy: number): string {
  // ângulo medido a partir do topo, no sentido horário: parte de -130° (baixo-esquerda) e vai até +130° (baixo-direita)
  const meio = VARREDURA / 2;
  const ponto = (graus: number) => { const a = graus * (Math.PI / 180); return `${(cx + raio * Math.sin(a)).toFixed(2)} ${(cy - raio * Math.cos(a)).toFixed(2)}`; };
  return `M ${ponto(-meio)} A ${raio} ${raio} 0 1 1 ${ponto(meio)}`;
}

function Arco({ percentual }: { percentual: number }) {
  const caminho = useMemo(() => caminhoArco(210, 250, 250), []);
  const cheio = Math.min(Math.max(percentual, 0), 100);
  return (
    <svg viewBox="0 0 500 500" aria-hidden="true" focusable="false">
      <path className="tvm-arco-trilho" d={caminho} pathLength={100} />
      {cheio > 0 && <path className="tvm-arco-fill" d={caminho} pathLength={100} strokeDasharray={`${cheio} 100`} />}
    </svg>
  );
}

function Card({ c }: { c: CardMeta }) {
  const largura = larguraBarraPct(c.percentual);
  const marca = posicaoMarcaMeta();
  const excesso = Math.max(largura - marca, 0);
  const verde = Math.min(largura, marca);
  const rotulo = `${c.nome}: ${formatPercentual(c.percentual)} da meta de ${formatPecas(c.meta)} peças. ${c.estado === "abaixo" ? `Faltam ${formatPecas(c.faltam)} peças.` : c.excedente > 0 ? `Meta atingida, ${formatPecas(c.excedente)} peças acima.` : "Meta atingida."}`;
  const [pct, un] = [formatPercentual(c.percentual).replace("%", ""), "%"];
  return (
    <article className={`tvm-card ${c.estado}`} aria-label={rotulo}>
      <h2 className={`tvm-nome ${c.nome.length > 22 ? "longo" : ""}`}>{c.nome}</h2>
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
            {c.excedente > 0 && <span className="tvm-situacao-valor"><span>+{formatPecas(c.excedente)}</span><small>acima</small></span>}
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

export default function PainelMetasTv({ modelo, atualizadoEm, conexao, erro, slideFixo, intervaloSlideMs = 12000, porPagina = 4, diagnostico }: PainelMetasTvProps) {
  // páginas cheias de `porPagina` (4): a página 1 tem os 4 mais atrasados, a 2 os próximos 4… O tamanho do card é fixo, nunca muda para caber mais.
  const paginas = useMemo<CardMeta[][]>(() => {
    if (!modelo) return [];
    const n = Math.max(Math.ceil(modelo.cards.length / porPagina), 1);
    return Array.from({ length: n }, (_, i) => modelo.cards.slice(i * porPagina, (i + 1) * porPagina));
  }, [modelo, porPagina]);

  const [indice, setIndice] = useState(0);
  useEffect(() => {
    if (slideFixo !== undefined || paginas.length <= 1) return;
    const t = setInterval(() => setIndice((i) => (i + 1) % paginas.length), intervaloSlideMs);
    return () => clearInterval(t);
  }, [paginas.length, slideFixo, intervaloSlideMs]);
  const posicao = paginas.length === 0 ? 0 : (slideFixo ?? indice) % paginas.length;
  const cards = paginas[posicao] ?? [];

  const r = modelo?.resumo;
  const pendente = conexao === "pendente" || conexao === "erro";

  return (
    <div className="tvm">
      <style>{CSS}</style>
      <div className="tvm-quadro">
        <header className="tvm-topo">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="tvm-logo" src="/brand/sittech-horizontal-verde-branco.png" alt="Sittech" width={1969} height={446} />
          <span className="tvm-sep" aria-hidden="true" />
          <div className="tvm-titulo">
            <h1>Produção da Semana</h1>
            {modelo && <span className="tvm-periodo">{formatDiaMes(modelo.semanaInicio)} a {formatDiaMes(modelo.semanaFim)}</span>}
          </div>
          <div className={`tvm-atual ${pendente ? "pendente" : ""}`} role="status">
            <span className="tvm-ponto" />
            {pendente
              ? <span>Atualização pendente. Verifique a conexão{atualizadoEm ? ` · última às ${atualizadoEm}` : ""}</span>
              : <span>{atualizadoEm ? `Atualizado às ${atualizadoEm}` : "Carregando…"}</span>}
          </div>
        </header>

        {r && r.percentual !== null && (
          <section className="tvm-geral" aria-label={`Meta semanal: ${formatPercentual(r.percentual)}. ${formatPecas(r.produzido)} de ${formatPecas(r.meta)} peças.`}>
            <div className="tvm-arco">
              <Arco percentual={r.percentual} />
              <div className="tvm-arco-centro">
                <div className={`tvm-arco-pct ${r.percentual >= 99.95 ? "tres" : ""}`}>{formatPercentual(r.percentual).replace("%", "")}<small>%</small></div>
                <div className="tvm-arco-rot">da meta semanal</div>
              </div>
            </div>
            <div className="tvm-geral-nums">
              <div className="tvm-geral-num"><b>{formatPecas(r.produzido)}</b><span>Produzidas</span></div>
              <span className="vl" aria-hidden="true" />
              <div className="tvm-geral-num"><b>{formatPecas(r.meta)}</b><span>Meta (peças)</span></div>
            </div>
            <div className="tvm-geral-hr" aria-hidden="true" />
            <p className="tvm-geral-nota" style={{ margin: 0 }}>
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M12 11v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><circle cx="12" cy="7.6" r="1.2" fill="currentColor" /></svg>
              <span>Soma simples de peças, não é capacidade da fábrica.</span>
            </p>
          </section>
        )}

        <main className="tvm-grade">
          {!modelo ? (
            <div className="tvm-vazio">{erro ? <><b>Não foi possível carregar as metas</b>{erro}</> : <b>Carregando metas da semana…</b>}</div>
          ) : modelo.cards.length === 0 ? (
            <div className="tvm-vazio"><b>{modelo.existe ? "Nenhum produto com meta nesta semana" : "Previsão da semana ainda não cadastrada"}</b>As metas aparecem aqui assim que a Previsão semanal for registrada.</div>
          ) : (
            cards.map((c) => <Card key={c.produtoId} c={c} />)
          )}
        </main>

        <footer className="tvm-rodape">
          <div className="tvm-notas">
            {modelo?.encerrados.map((e) => <span key={e.produtoId}>Encerrado: <b>{e.nome}</b> · {formatPecas(e.produzido)} peças produzidas</span>)}
            {modelo?.semMeta.map((s) => <span key={s.produtoId}>Sem meta na semana: <b>{s.nome}</b> · {formatPecas(s.produzido)} peças</span>)}
          </div>
          <div className="tvm-pagina" aria-label={paginas.length > 1 ? `Página ${posicao + 1} de ${paginas.length}` : undefined}>
            {paginas.length > 1 && <>{paginas.map((_, i) => <i key={i} className={i === posicao ? "on" : ""} />)}<span>{posicao + 1}/{paginas.length}</span></>}
            {diagnostico && <span>{diagnostico}</span>}
          </div>
        </footer>
      </div>
    </div>
  );
}
