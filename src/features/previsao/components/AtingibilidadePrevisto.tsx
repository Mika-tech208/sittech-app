"use client";

// Cobertura da equipe × Atingibilidade do previsto — duas perguntas diferentes, lado a lado.
// Só apresentação: os números vêm do mesmo motor (rota /api/escala/simular-cobertura) e os textos de `atingibilidadeTexto.ts`.

import type { PessoasComPosto, CoberturaSemana } from "@/features/escala/cobertura";
import type { AtingibilidadeSemana, StatusAtingibilidade } from "@/features/escala/atingibilidade";
import type { RecomendacaoGlobal } from "@/features/escala/recomendacaoMaquina";
import { formatBRL, formatQtd } from "@/lib/format";
import {
  diagnosticoGlobalTexto,
  linhasRecomendacao,
  manchete,
  NOTA_INDEPENDENTES,
  PERGUNTA_ATINGIBILIDADE,
  PERGUNTA_COBERTURA,
  periodosTexto,
  ROTULO_BENEFICIO,
  ROTULO_STATUS,
  TEXTO_CAUSA,
  textoAcao,
} from "@/features/previsao/atingibilidadeTexto";

export const ESTILOS_ATINGIBILIDADE = `
.stx-duo { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin:14px 0 6px; }
@media (max-width: 680px) { .stx-duo { grid-template-columns:1fr; } }
.stx-duo-card { border:1px solid var(--border, rgba(255,255,255,.14)); border-radius:12px; padding:12px 14px; }
.stx-duo-kicker { font-size:11px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; color:var(--text-muted); margin:0; }
.stx-duo-pergunta { font-size:13px; margin:2px 0 8px; color:var(--text-muted); }
.stx-duo-valor { font-size:28px; font-weight:800; line-height:1.1; margin:0; }
.stx-duo-valor.pequeno { font-size:20px; }
.stx-duo-sub { font-size:13px; color:var(--text-muted); margin:4px 0 0; }
.stx-badge { display:inline-block; padding:2px 8px; border-radius:999px; font-size:12px; font-weight:700; }
.stx-badge.atingivel { background:rgba(60,200,140,.16); color:var(--accent); }
.stx-badge.atingivel_no_limite { background:rgba(120,170,255,.16); color:#8db4ff; }
.stx-badge.produtivo { background:var(--accent); color:#06281a; }
.stx-badge.cobertura { background:rgba(120,170,255,.22); color:#9cbcff; }
.stx-badge.margem { background:transparent; color:var(--text-muted); border:1px solid var(--border, rgba(255,255,255,.2)); font-weight:600; }
.stx-rec-passo { margin:8px 0; padding:8px 10px; border-radius:10px; background:rgba(255,255,255,.04); }
.stx-rec-passo.forte { border-left:3px solid var(--accent); }
.stx-rec-passo.fraco { font-size:12px; opacity:.8; }
.stx-rec-passo p { margin:3px 0 0; }
.stx-diag { margin:8px 0; padding:10px 12px; border-radius:10px; background:rgba(240,90,90,.10); border-left:3px solid var(--danger); font-size:13px; }
.stx-diag p { margin:2px 0; }
.stx-badge.em_risco { background:rgba(240,173,78,.18); color:var(--warning); }
.stx-badge.impossivel { background:rgba(240,90,90,.18); color:var(--danger); }
.stx-ating-prod { padding:10px 0; border-bottom:1px solid var(--border, rgba(255,255,255,.08)); font-size:13px; }
.stx-ating-prod b { font-size:14px; }
.stx-ating-prod p { margin:3px 0 0; }
.stx-ating-prod .acao { color:var(--accent); }
`;

const pct = (v: number) => `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const num1 = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
const COR: Record<StatusAtingibilidade, string> = { atingivel: "var(--accent)", atingivel_no_limite: "#8db4ff", em_risco: "var(--warning)", impossivel: "var(--danger)" };

export function CartoesCoberturaAtingibilidade({ cob, pessoas, ating, semAnalise }: { cob: CoberturaSemana; pessoas: PessoasComPosto; ating: AtingibilidadeSemana; semAnalise?: boolean }) {
  return (
    <>
      <div className="stx-duo">
        <section className="stx-duo-card" aria-label="Cobertura da equipe">
          <p className="stx-duo-kicker">Cobertura da equipe</p>
          <p className="stx-duo-pergunta">“{PERGUNTA_COBERTURA}”</p>
          <p className="stx-duo-valor" style={{ color: cob.percentual >= 99.95 ? "var(--accent)" : "var(--warning)" }}>{pct(cob.percentual)}</p>
          <p className="stx-duo-sub">
            {cob.minutosSemPosto === 0 ? "Toda a equipe tem posto em todos os períodos analisados." : `${cob.pessoasPeriodoSemPosto} períodos-pessoa / ${num1(cob.horasSemPosto)} h sem carga`}
          </p>
          {pessoas.periodos > 0 && (
            <p className="stx-duo-sub">Pessoas com posto por período: mín <b>{pessoas.minimo}</b> · média <b>{num1(pessoas.media)}</b> · máx <b>{pessoas.maximo}</b> (de {num1(pessoas.disponiveisMedia)} disponíveis em média)</p>
          )}
        </section>
        <section className="stx-duo-card" aria-label="Atingibilidade do previsto">
          <p className="stx-duo-kicker">Atingibilidade do previsto</p>
          <p className="stx-duo-pergunta">“{PERGUNTA_ATINGIBILIDADE}”</p>
          <p className="stx-duo-valor pequeno" style={{ color: COR[ating.status] }}>{ROTULO_STATUS[ating.status]}</p>
          {ating.diagnosticoGlobal.mensagem && <p className="stx-duo-sub"><b>{ating.diagnosticoGlobal.mensagem}</b></p>}
          <p className="stx-duo-sub">
            {ating.atingiveis} atingíveis · {ating.atingiveisNoLimite} no limite · {ating.emRisco} em risco · {ating.impossiveis} impossíveis
            {ating.faltaTotalPlano > 0 ? ` · faltam ${formatQtd(ating.faltaTotalPlano)} peças (${formatBRL(ating.valorEmRisco)})` : ""}
          </p>
          {semAnalise && <p className="stx-duo-sub">Sem equipe disponível nos períodos restantes.</p>}
        </section>
      </div>
      <p className="stx-cob-dica">{NOTA_INDEPENDENTES}</p>
    </>
  );
}

export function DetalheAtingibilidade({
  ating,
  nomeProd,
  nomeEtapa,
  nomeMaq,
}: {
  ating: AtingibilidadeSemana;
  nomeProd: (id: string) => string;
  nomeEtapa: (id: string | null) => string;
  nomeMaq: (id: string) => string;
}) {
  const comProblema = ating.produtos.filter((p) => p.status !== "atingivel");
  const diag = diagnosticoGlobalTexto(ating.diagnosticoGlobal, nomeProd, nomeMaq);
  return (
    <div className="stx-cob-bloco">
      <h3>Atingibilidade do previsto — diagnóstico da semana</h3>
      {diag.length === 0 ? (
        <p className="stx-cob-ok">A programação semanal cabe na equipe e nos recursos compartilhados.</p>
      ) : (
        diag.map((d, i) => (
          <div className="stx-diag" key={i}>
            <p><b>{d.titulo}</b></p>
            {d.linhas.map((l, k) => <p key={k}>{l}</p>)}
          </div>
        ))
      )}
      <h3 style={{ marginTop: 14 }}>Por produto e etapa</h3>
      {comProblema.length === 0 ? (
        <p className="stx-cob-ok">Todos os produtos previstos fecham com folga (≥ {Math.round(ating.margem * 100)}%) nas máquinas atuais.</p>
      ) : (
        comProblema.map((p) => {
          const acao = textoAcao(p.acao, nomeMaq);
          const per = periodosTexto(p.periodosNecessarios);
          return (
            <div className="stx-ating-prod" key={p.produtoId}>
              <b>{nomeProd(p.produtoId)}</b> <span className={`stx-badge ${p.status}`}>{ROTULO_STATUS[p.status]}</span>
              <p>{manchete(p)}</p>
              {p.gargaloEtapaId && <p>Gargalo: <b>{nomeEtapa(p.gargaloEtapaId)}</b></p>}
              {p.causa && <p style={{ color: "var(--text-muted)" }}>{TEXTO_CAUSA[p.causa]}</p>}
              {per && <p style={{ color: "var(--text-muted)" }}>{per}</p>}
              {acao && <p className="acao">Ação: {acao}</p>}
              <div className="stx-cob-rolagem">
                <table className="stx-cob-tabela">
                  <thead><tr><th>Etapa</th><th>Necessário</th><th>Plano produz</th><th>Falta no plano</th><th>Capacidade das máquinas</th><th>Folga</th><th>Situação</th></tr></thead>
                  <tbody>
                    {p.etapas.map((e) => (
                      <tr key={e.etapaId}>
                        <td>{nomeEtapa(e.etapaId)}</td>
                        <td>{formatQtd(e.necessidade)}</td>
                        <td>{formatQtd(e.produzidoNoPlano)}</td>
                        <td className={e.faltaPlano > 0 ? "stx-cob-neg" : undefined}>{e.faltaPlano > 0 ? formatQtd(e.faltaPlano) : "—"}</td>
                        <td>{formatQtd(e.capacidadeMaquinas)}</td>
                        <td>{num1(e.folgaPercentual)}%</td>
                        <td><span className={`stx-badge ${e.status}`}>{ROTULO_STATUS[e.status]}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })
      )}
      <p className="stx-cob-dica">“Impossível” só é afirmado quando há prova (capacidade das máquinas, máquinas compartilhadas ou equipe). Fora isso, o que o plano não fecha fica “Em risco”, com a ação sugerida.</p>
    </div>
  );
}

export function RecomendacaoMaquinaGlobal({
  g,
  nomeProd,
  nomeEtapa,
  nomeMaq,
  jaAnalisouComSugestao,
}: {
  g: RecomendacaoGlobal | null;
  nomeProd: (id: string) => string;
  nomeEtapa: (id: string | null) => string;
  nomeMaq: (id: string) => string;
  jaAnalisouComSugestao: boolean;
}) {
  if (!jaAnalisouComSugestao) return null;
  const linhas = g ? linhasRecomendacao(g, { maquina: nomeMaq, produto: nomeProd, etapa: (id) => nomeEtapa(id) }) : null;
  return (
    <div className="stx-cob-bloco">
      <h3>Recomendação de máquina (cenário completo)</h3>
      {!g || !linhas ? (
        <p className="stx-cob-dica">Nenhuma máquina compatível melhora o cenário completo (atingibilidade e cobertura) sem piorar outro produto.</p>
      ) : (
        <div className="stx-cob-rec">
          {linhas.passos.map((p, i) => (
            <div key={i} className={`stx-rec-passo ${p.forte ? "forte" : "fraco"}`}>
              <b>{p.titulo}</b>
              <p>{p.beneficios.map((b) => <span key={b} className={`stx-badge ${b}`} style={{ marginRight: 6 }}>{ROTULO_BENEFICIO[b]}</span>)}</p>
              {p.efeitos.map((e, k) => <p key={k}>{e}</p>)}
            </div>
          ))}
          <p style={{ margin: "8px 0 2px" }}><b>Efeito no cenário completo:</b></p>
          <ul>
            {linhas.resumo.map((l, i) => <li key={i}>{l}</li>)}
          </ul>
        </div>
      )}
      <p className="stx-cob-dica">
        Cada máquina é avaliada rodando a semana inteira de novo, com todos os produtos e recursos compartilhados — nunca isoladamente. Só aparece o que melhora a atingibilidade, a cobertura ou ambas, sem piorar nenhum produto. Nada é aplicado automaticamente.
      </p>
    </div>
  );
}
