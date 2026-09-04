"use client";

// Recursos pressionados (§19/§22-D) e Evidências da semana (§22-E) —
// produto fora da previsão (§15) e sem produção (§16), sempre separados,
// nunca somados a peças de produtos previstos.

import type { ResultadoValidacaoPrevisao } from "@/features/producao-real/validacao-previsao/types";
import { formatarMinutos, formatarPecas, formatarPercentualIndicador } from "@/features/producao-real/indicadores/format";

const LABEL_MOTIVO: Record<string, string> = {
  sem_programacao: "Sem programação", falta_material: "Falta de material",
  falta_operador: "Falta de operador", manutencao_programada: "Manutenção programada", outro: "Outro",
};

export default function RecursosEEvidencias({ resultado }: { resultado: ResultadoValidacaoPrevisao }) {
  return (
    <div>
      <div className="stx-panel">
        <p className="stx-panel-title">Recursos mais pressionados</p>
        <p className="stx-panel-sub">Horas restantes por máquina até o fim da semana útil — nunca "total de peças da fábrica" somando produtos diferentes.</p>
        {resultado.recursosPressionados.length === 0 ? (
          <div className="stx-empty">Nenhuma máquina com demanda restante calculada.</div>
        ) : (
          <div className="stx-ind-tabela-wrap" style={{ marginTop: 8 }}>
            <div className="stx-ind-tabela-header" style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr" }}>
              <span>Máquina</span><span>Necessário</span><span>Disponível</span><span>% de uso</span>
            </div>
            {resultado.recursosPressionados.sort((a, b) => b.pctUso - a.pctUso).map((r) => (
              <div key={r.maquinaId} className="stx-ind-tabela-linha" style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr", cursor: "default" }}>
                <span style={{ fontFamily: "inherit", color: r.gargalo ? "var(--danger)" : undefined }}>{r.maquinaNome}{r.gargalo ? " (gargalo)" : ""}</span>
                <span>{r.horasNecessariasRestantes.toFixed(1)}h</span>
                <span>{r.horasRestantes.toFixed(1)}h</span>
                <span>{formatarPercentualIndicador(r.pctUso)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="stx-panel" style={{ marginTop: 12 }}>
        <p className="stx-panel-title">Produção não programada</p>
        <p className="stx-panel-sub">
          Produto fora da previsão utilizou recurso compartilhado durante a semana — evidência do que já aconteceu, nunca desconta da capacidade futura (o tempo já passou) e nunca vira item previsto.
        </p>
        {resultado.produtosForaDaPrevisao.length === 0 ? (
          <div className="stx-empty">Nenhuma produção fora da previsão observada.</div>
        ) : (
          resultado.produtosForaDaPrevisao.map((p, i) => (
            <p key={i} className="stx-panel-sub">
              {p.produtoNome} em {p.maquinaNome}: {formatarMinutos(p.minutosObservados)} em {p.periodos} período(s), {formatarPecas(p.quantidadeObservada)} peças.
            </p>
          ))
        )}
      </div>

      <div className="stx-panel" style={{ marginTop: 12 }}>
        <p className="stx-panel-title">Sem produção (registros explícitos)</p>
        <p className="stx-panel-sub">Nunca inventa minutos/custo — só contagem de registros explícitos. &quot;Sem programação&quot; não é tratado automaticamente como perda evitável.</p>
        {resultado.evidenciasSemProducao.length === 0 ? (
          <div className="stx-empty">Nenhum registro de sem produção nesta semana.</div>
        ) : (
          resultado.evidenciasSemProducao.map((e, i) => (
            <p key={i} className="stx-panel-sub">{e.maquinaNome} — {LABEL_MOTIVO[e.motivo] || e.motivo}: {e.quantidadeRegistros} registro(s)</p>
          ))
        )}
      </div>
    </div>
  );
}
