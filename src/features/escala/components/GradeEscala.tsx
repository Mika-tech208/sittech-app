"use client";

import { epochMsNoFuso } from "@/features/escala/tempo";
import type { AlocacaoLinha, DiaEscala, Nomes } from "@/hooks/useEscalaProducao";

export type EstadoCelula = "passado" | "atual" | "futuro";

export function estadoDoPeriodo(data: string, inicio: string, fim: string, agoraMs: number): EstadoCelula {
  const ini = epochMsNoFuso(data, inicio);
  const f = epochMsNoFuso(data, fim);
  if (agoraMs >= f) return "passado";
  if (agoraMs >= ini) return "atual";
  return "futuro";
}

export interface GradeEscalaProps {
  dia: DiaEscala;
  alocacoes: AlocacaoLinha[]; // só deste dia
  funcionarios: string[]; // ids, na ordem de exibição
  nomes: Nomes;
  agoraMs: number;
  onEditar: (periodoId: string, funcionarioId: string) => void;
}

// produto de ROTAS: indicação discreta de onde a etapa está (nunca como produto separado). Etapa de produto linear: nada.
const rotuloRota = (g?: string) => (g === "CONV" ? " · rota convencional" : g === "AUTO" ? " · rota automática" : g === "COMUM" ? " · fluxo comum" : "");

export default function GradeEscala({ dia, alocacoes, funcionarios, nomes, agoraMs, onEditar }: GradeEscalaProps) {
  const porChave = new Map(alocacoes.map((a) => [`${a.periodoId}|${a.funcionarioId}`, a]));
  return (
    <div className="stx-esc-scroll">
      <table className="stx-esc-tabela">
        <thead>
          <tr>
            <th className="colf">Funcionário</th>
            {dia.periodos.map((p) => (
              <th key={p.id}>
                {p.nome}
                <div className="stx-esc-resumo-periodo">{p.inicio}–{p.fim}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {funcionarios.map((fid) => (
            <tr key={fid}>
              <td className="colf">{nomes.funcionarios.get(fid) || "Funcionário"}</td>
              {dia.periodos.map((p) => {
                const a = porChave.get(`${p.id}|${fid}`);
                const estado = estadoDoPeriodo(dia.data, p.inicio, p.fim, agoraMs);
                if (!a) {
                  return <td key={p.id}><div className="stx-esc-cell passado"><span className="sem">— ausente / fora da equipe</span></div></td>;
                }
                const clicavel = estado === "futuro";
                return (
                  <td key={p.id}>
                    <div
                      className={`stx-esc-cell ${estado}`}
                      role={clicavel ? "button" : undefined}
                      tabIndex={clicavel ? 0 : undefined}
                      title={clicavel ? "Clique para trocar com outro funcionário" : estado === "atual" ? "Período em andamento — congelado" : "Período concluído"}
                      onClick={clicavel ? () => onEditar(p.id, fid) : undefined}
                      onKeyDown={clicavel ? (e) => { if (e.key === "Enter" || e.key === " ") onEditar(p.id, fid); } : undefined}
                    >
                      {a.maquinaId ? (
                        <>
                          <div className="maq">{nomes.maquinas.get(a.maquinaId) || "Máquina"}</div>
                          <div className="det">{nomes.produtos.get(a.produtoId || "") || "Produto"} · {nomes.operacoes.get(a.operacaoId || "") || "Operação"}{rotuloRota(nomes.etapaRota?.get(a.etapaId || ""))}</div>
                          <div>
                            {a.excecaoRevezamento && <span className="stx-esc-badge exc" title={a.motivoExcecao || "Repete a operação do período anterior"}>⚠ repete operação</span>}
                            {a.origem === "manual" && <span className="stx-esc-badge man">manual</span>}
                          </div>
                        </>
                      ) : (
                        <span className="sem">Sem posto — {a.motivoSemPosto}</span>
                      )}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
