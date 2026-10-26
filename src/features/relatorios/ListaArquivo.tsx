"use client";

// Lista do arquivo (tabela no desktop, cards no celular) — PURAMENTE apresentacional: recebe o modelo pronto e callbacks. Não lê o banco, não gera PDF.
import { Fragment } from "react";
import { formatarDataHoraBR } from "@/lib/date";
import type { LinhaRelatorio } from "@/features/escala/relatoriosApi";
import { nomeArquivoPdf, rotuloOrigem, rotuloStatus, urlVerificar, type LinhaModelo, type TipoRelatorio } from "./arquivo";

export type VersoesAbertas = Record<string, LinhaRelatorio[] | "carregando">;
export const chaveFamilia = (i: { semanaInicio: string; tipoChave: TipoRelatorio }) => `${i.semanaInicio}|${i.tipoChave}`;

export interface ListaArquivoProps {
  linhas: LinhaModelo[]; abertas: VersoesAbertas; ocupado: string | null;
  onBaixar: (id: string, nome: string) => void; onVersoes: (l: LinhaModelo) => void; onGerarNova: (l: LinhaModelo) => void;
}

export default function ListaArquivo({ linhas, abertas, ocupado, onBaixar, onVersoes, onGerarNova }: ListaArquivoProps) {
  const painelVersoes = (l: LinhaModelo) => {
    const v = abertas[chaveFamilia(l)];
    if (!v) return null;
    return (
      <div className="stx-rel-versoes-lista">
        {v === "carregando" && <span className="stx-esc-muted">Carregando versões…</span>}
        {v !== "carregando" && v.length === 0 && <span className="stx-esc-muted">Nenhuma versão encontrada.</span>}
        {v !== "carregando" && v.map((x) => (
          <div className="stx-rel-versao" key={x.id}>
            <span><b>v{x.versao}</b> · {rotuloStatus(x.status)} · {rotuloOrigem(x.fechamentoAutomatico)} · {formatarDataHoraBR(x.geradoEm)} · SHA-256 {x.hash.slice(0, 12)}…{x.alteracoesPosteriores ? " · alterações posteriores" : ""}</span>
            <span className="stx-rel-acoes">
              <button type="button" onClick={() => onBaixar(x.id, nomeArquivoPdf({ semanaInicio: l.semanaInicio, tipo: l.tipoChave, versao: x.versao }))}>Baixar PDF</button>
              <a href={urlVerificar(x.id)} target="_blank" rel="noreferrer">Verificar</a>
            </span>
          </div>
        ))}
      </div>
    );
  };
  const acoes = (l: LinhaModelo) => (
    <div className="stx-rel-acoes">
      <button type="button" className="primaria" onClick={() => onBaixar(l.id, nomeArquivoPdf({ semanaInicio: l.semanaInicio, tipo: l.tipoChave, versao: Number(l.versao.slice(1)) }))}>Baixar PDF</button>
      <a href={urlVerificar(l.id)} target="_blank" rel="noreferrer">Verificar</a>
      {l.acoes.versoes && <button type="button" onClick={() => onVersoes(l)}>{abertas[chaveFamilia(l)] ? "Ocultar versões" : `Versões (${l.nVersoes})`}</button>}
      {l.acoes.gerarNova && <button type="button" disabled={ocupado === l.id} onClick={() => onGerarNova(l)}>{ocupado === l.id ? "Gerando…" : "Gerar nova versão"}</button>}
    </div>
  );

  return (
    <>
      <div className="stx-rel-scroll">
        <table className="stx-rel-tabela">
          <thead>
            <tr><th>Semana</th><th>Tipo</th><th>Código</th><th>Versão</th><th>Status</th><th>Gerado em</th><th>Cobertura</th><th>Conformidade</th><th>Alterações posteriores</th><th>Ações</th></tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <Fragment key={l.id}>
                <tr>
                  <td>{l.semana}</td>
                  <td><span className={`stx-rel-badge ${l.tipoChave === "executada" ? "principal" : ""}`}>{l.tipo.toUpperCase()}</span></td>
                  <td>{l.codigo}</td>
                  <td>{l.versao}{l.nVersoes > 1 && <span className="stx-rel-discreto">{l.nVersoes} versões</span>}</td>
                  <td><span className={`stx-rel-badge ${l.statusChave === "final" ? "final" : ""}`}>{l.status}</span><span className="stx-rel-discreto">{l.origem}</span></td>
                  <td>{formatarDataHoraBR(l.geradoEmIso)}</td>
                  <td>{l.cobertura}</td>
                  <td>{l.conformidade}</td>
                  <td>{l.alteracoesPosteriores ? <span className="stx-rel-alerta" title="Os dados-fonte mudaram depois deste relatório. O PDF arquivado não é alterado.">⚠ Existem alterações posteriores.</span> : l.alteracoes}</td>
                  <td>{acoes(l)}</td>
                </tr>
                {abertas[chaveFamilia(l)] && <tr className="stx-rel-versoes"><td colSpan={10}>{painelVersoes(l)}</td></tr>}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div className="stx-rel-cards">
        {linhas.map((l) => (
          <div className="stx-rel-card" key={l.id}>
            <div className="linha"><b>{l.semana}</b><span className={`stx-rel-badge ${l.statusChave === "final" ? "final" : ""}`}>{l.status}</span></div>
            <div className="linha"><span><span className="rot">Tipo </span>{l.tipo}</span><span><span className="rot">Versão </span>{l.versao}</span></div>
            <div><span className="rot">Código </span>{l.codigo}</div>
            <div><span className="rot">Conformidade </span>{l.conformidade} · <span className="rot">Cobertura </span>{l.cobertura}</div>
            <div className="stx-rel-discreto">{l.origem} · {formatarDataHoraBR(l.geradoEmIso)}</div>
            {l.alteracoesPosteriores && <div className="stx-rel-alerta">⚠ Existem alterações posteriores.</div>}
            {acoes(l)}
            {abertas[chaveFamilia(l)] && painelVersoes(l)}
          </div>
        ))}
      </div>
    </>
  );
}
