"use client";

import { isoParaBR } from "@/lib/date";
import { resumirEquipe } from "@/features/capacidade/diasEEquipe";
import type { MembroEquipeSemana } from "@/types/domain";
import Recolhivel from "@/features/previsao/components/Recolhivel";

const NOMES_DIA = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];

export interface DiasEEquipeSemanaProps {
  diasDaSemana: string[]; // 7 datas ISO, segunda..domingo
  diasProdutivos: string[];
  onToggleDia: (dia: string) => void;
  equipe: MembroEquipeSemana[];
  nomePorId: Map<string, string>;
  inativos: Set<string>;
  onToggleMembro: (funcionarioId: string) => void;
  onMarcarTodos: () => void;
  onLimpar: () => void;
  operacoes: { id: string; nome: string }[];
  operacaoCadastroPorId: Map<string, string | null>; // operação atual do cadastro, só para sinalizar ajuste da semana
  onDefinirOperacao: (funcionarioId: string, operacaoId: string) => void;
  salvando: boolean;
  horasPorDia: number;
  horasPorMaquinaSemana: number;
}

// Dias trabalhados + Equipe produtiva — ambos pertencem à previsão da
// semana em foco (nunca ao cadastro global). Cada clique grava na hora,
// igual aos demais blocos da tela.
export default function DiasEEquipeSemana({
  diasDaSemana, diasProdutivos, onToggleDia, equipe, nomePorId, inativos, onToggleMembro, onMarcarTodos, onLimpar,
  operacoes, operacaoCadastroPorId, onDefinirOperacao, salvando, horasPorDia, horasPorMaquinaSemana,
}: DiasEEquipeSemanaProps) {
  const resumo = resumirEquipe(equipe);
  const membros = [...equipe].sort((a, b) => (nomePorId.get(a.funcionarioId) || "").localeCompare(nomePorId.get(b.funcionarioId) || "", "pt-BR"));

  return (
    <div className="stx-panel">
      <div className="stx-panel-title-row">
        <p className="stx-panel-title">Dias trabalhados</p>
      </div>
      <p className="stx-panel-sub">
        Marque os dias produtivos desta semana (desmarque feriado ou ponte, marque sábado trabalhado). Vale só para esta semana — o padrão da empresa não muda.
      </p>
      <div className="stx-etapa-maquinas">
        {diasDaSemana.map((dia, i) => (
          <label className="stx-maquina-chip" key={dia}>
            <input type="checkbox" checked={diasProdutivos.includes(dia)} disabled={salvando} onChange={() => onToggleDia(dia)} />
            {NOMES_DIA[i]} {isoParaBR(dia).slice(0, 5)}
          </label>
        ))}
      </div>
      <p className="stx-custos-total" style={{ marginTop: 10 }}>
        {diasProdutivos.length} dia{diasProdutivos.length === 1 ? "" : "s"} produtivo{diasProdutivos.length === 1 ? "" : "s"} × {horasPorDia.toFixed(2)}h = <b>{horasPorMaquinaSemana.toFixed(2)}h</b> de capacidade por máquina na semana
      </p>
      {diasProdutivos.length === 0 && (
        <p className="stx-panel-sub" style={{ color: "var(--warning)", margin: "6px 0 0" }}>
          Nenhum dia produtivo marcado — a capacidade da semana fica zerada.
        </p>
      )}

      <div style={{ marginTop: 22 }}>
      <Recolhivel
        id="previsao-equipe-produtiva"
        titulo="Equipe produtiva da semana"
        resumo={`· ${resumo.produtivos} de ${resumo.total} selecionado${resumo.total === 1 ? "" : "s"}`}
      >
      <p className="stx-panel-sub">
        Quem realmente atua na produção nesta semana. Não altera o cadastro, o salário nem o Custo/hora de ninguém.
      </p>
      {membros.length === 0 ? (
        <p className="stx-panel-sub">Nenhum funcionário ativo cadastrado.</p>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {membros.map((m) => {
              const ajustada = m.operacaoId !== null && operacaoCadastroPorId.get(m.funcionarioId) !== undefined && operacaoCadastroPorId.get(m.funcionarioId) !== m.operacaoId;
              return (
                <div key={m.funcionarioId} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <label className="stx-maquina-chip" style={{ flex: "1 1 130px", minWidth: 0 }}>
                    <input type="checkbox" checked={m.produtivo} disabled={salvando || (inativos.has(m.funcionarioId) && !m.produtivo)} title={inativos.has(m.funcionarioId) && !m.produtivo ? "Funcionário inativo: reative-o em Funcionários para voltar a incluí-lo" : undefined} onChange={() => onToggleMembro(m.funcionarioId)} />
                    {nomePorId.get(m.funcionarioId) || "Funcionário removido"}{inativos.has(m.funcionarioId) ? " (inativo)" : ""}
                  </label>
                  <select
                    className="stx-select"
                    style={{ width: 112, flexShrink: 0, padding: "6px 8px", fontSize: 13 }}
                    aria-label={`Operação de ${nomePorId.get(m.funcionarioId) || "funcionário"} nesta semana`}
                    value={m.operacaoId || ""}
                    disabled={salvando}
                    onChange={(e) => onDefinirOperacao(m.funcionarioId, e.target.value)}
                  >
                    {!m.operacaoId && <option value="">Sem operação</option>}
                    {operacoes.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
                  </select>
                  {ajustada && <span className="stx-panel-sub" style={{ margin: 0 }}>ajustada nesta semana (cadastro não muda)</span>}
                </div>
              );
            })}
          </div>
          <p className="stx-custos-total" style={{ marginTop: 10 }}>
            <b>{resumo.texto}</b>
          </p>
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <button type="button" className="stx-btn-secondary" onClick={onMarcarTodos} disabled={salvando}>Marcar todos</button>
            <button type="button" className="stx-btn-secondary" onClick={onLimpar} disabled={salvando}>Limpar seleção</button>
          </div>
          {resumo.nenhum && (
            <p className="stx-panel-sub" style={{ color: "var(--warning)", margin: "6px 0 0" }}>
              Sem equipe produtiva marcada, o uso da equipe em horas não é calculado (sem divisão por zero).
            </p>
          )}
        </>
      )}
      </Recolhivel>
      </div>
    </div>
  );
}
