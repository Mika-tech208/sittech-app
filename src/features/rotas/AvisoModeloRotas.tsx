"use client";

// Aviso/checklist da virada para o modelo de rotas, dentro da Previsão (não é uma tela nova). Antes do início: só informa. Na primeira semana: lista o que a pessoa ainda precisa fazer —
// o sistema NÃO cria a Previsão, NÃO escolhe máquinas e NÃO inventa WIP. Se uma validação crítica falhar, o modelo fica fechado e o motivo aparece aqui.
import type { EstadoAtivacaoRotas } from "@/lib/rotas/ativacao";
import { dataBR } from "@/lib/rotas/ativacao";
import type { PreviaRotas } from "./compartilhada";

const n = (v: number) => Math.round(v).toLocaleString("pt-BR");

export interface ItemDeRotasResumo { quantidade: number; previa: PreviaRotas | null; marcadas: { CONV: boolean; AUTO: boolean; COMUM: boolean } }

export default function AvisoModeloRotas({ estado, semanaInicio, item, nomeProduto }: { estado: EstadoAtivacaoRotas | null; semanaInicio: string; item: ItemDeRotasResumo | null; nomeProduto: string }) {
  if (!estado || !estado.programado || !estado.desdeData) return null;
  const antes = semanaInicio < estado.desdeData;
  const primeira = semanaInicio === estado.desdeData;
  const caixa = { border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", marginBottom: 12, fontSize: 13 } as const;
  if (antes) return <div style={caixa}>Modelo de rotas disponível a partir de <b>{dataBR(estado.desdeData)}</b>. Esta semana segue o modelo atual (produtos legados).</div>;
  if (!estado.liberado) {
    const falhaCritica = estado.validacao && !estado.validacao.ok;
    return (
      <div style={{ ...caixa, borderColor: falhaCritica ? "var(--danger)" : "var(--border)" }}>
        <b>{falhaCritica ? "Modelo de rotas NÃO liberado" : "Modelo de rotas ainda fechado"}</b> — {estado.motivo || "aguardando"}. Os produtos legados continuam normais.
      </div>
    );
  }
  const q = item?.previa?.plano;
  const m = item?.marcadas;
  const ok = (b: boolean) => (b ? "✔" : "•");
  return (
    <div style={{ ...caixa, borderColor: "var(--accent)" }}>
      <b>{primeira ? "Primeira semana no novo modelo." : "Semana no modelo de rotas."}</b> Lance <b>{nomeProduto}</b> como UM produto; as máquinas começam desmarcadas e a escolha é sua.
      <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
        <li>{ok(!!item && item.quantidade > 0)} Demanda final: {item && item.quantidade > 0 ? n(item.quantidade) : "informe a quantidade prevista"}</li>
        {primeira && <li>• WIP inicial: confirme o <b>saldo físico</b> da virada em “Estoque intermediário” (só o que foi contado). Sem confirmação o WIP inicial é <b>0</b>.</li>}
        <li>{ok(!!m && m.CONV && m.COMUM)} Máquinas: {m ? `CONV ${m.CONV ? "marcadas" : "não marcadas"} · AUTO ${m.AUTO ? "marcada" : "não marcada"} · Fluxo comum ${m.COMUM ? "marcadas" : "não marcadas"}` : "marque as máquinas por etapa"}</li>
        <li>{ok(!!q)} Capacidade: {q ? `possível ${n(q.finalAtingivel)} de ${n(q.demandaFinal)} (${q.percentualAtingivel.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%), falta ${n(q.falta)}` : "calculada depois de marcar as máquinas"}</li>
        <li>{ok(!!q && Object.keys(q.alvo).length > 0)} Divisão: {q ? Object.entries(q.alvo).map(([c, v]) => `${c} ${n(v)}`).join(" · ") : "—"}</li>
        <li>{ok(!!q)} Gargalo: {q ? (q.gargalo === null ? "nenhum (demanda atendida)" : q.gargalo.tipo === "comum" ? q.gargalo.operacao : "entrada das rotas") : "—"}</li>
      </ul>
    </div>
  );
}
