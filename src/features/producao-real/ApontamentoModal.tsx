"use client";

// Formulário de "Registrar produção" da Produção Real V1 — máquina e
// período já vêm definidos (não são campos), etapa/operação e meta nunca
// aparecem aqui. Produto é filtrado pelos elegíveis pra esta máquina
// (useProdutosElegiveisPorMaquina) — a mesma elegibilidade que a RPC
// valida no servidor, só pra não deixar a supervisora escolher algo que o
// backend rejeitaria.
//
// `modoRetroativo` (opcional): quando presente, o lançamento é pra um
// período JÁ ENCERRADO (dia anterior, ou período de hoje que já
// terminou) — chama registrar_apontamento_producao_retroativo com
// data+periodo_id em vez de deixar o backend resolver "agora". O
// restante do formulário/fluxo é idêntico.

import { useState } from "react";
import { supabase } from "@/services/supabase-client";
import { useProdutosElegiveisPorMaquina } from "@/hooks/useProdutosElegiveisPorMaquina";
import { useMotivosParada } from "@/hooks/useMotivosParada";
import { calcularPerformance, mensagemErroRegistrarLancamento } from "./calculations";
import ParadasManuaisEditor, { type ParadaManual } from "./ParadasManuaisEditor";

interface FuncionarioAtivo {
  id: string;
  nome: string;
}

interface ApontamentoRpcResult {
  id: string;
  quantidade_produzida: number;
  meta_periodo_vigente: number | null;
  duracao_periodo_horas_vigente: number | null;
}

export interface ApontamentoModalProps {
  maquinaId: string;
  maquinaNome: string;
  periodoNome: string;
  periodoHorario: string;
  funcionariosAtivos: FuncionarioAtivo[];
  modoRetroativo?: { data: string; periodoId: string } | null;
  onFechar: () => void;
  onApontado: (info: { maquinaId: string; produtoNome: string; quantidadeProduzida: number }) => void;
  onProximaMaquina: () => void;
  temProximaPendente: boolean;
}

type Etapa = "preenchendo" | "salvando" | "confirmado";

export default function ApontamentoModal({
  maquinaId, maquinaNome, periodoNome, periodoHorario, funcionariosAtivos, modoRetroativo,
  onFechar, onApontado, onProximaMaquina, temProximaPendente,
}: ApontamentoModalProps) {
  // Gerada uma vez, na abertura deste formulário — reutilizada em
  // qualquer retry (não remonta o componente, então não muda).
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [etapa, setEtapa] = useState<Etapa>("preenchendo");

  const { produtos, loading: produtosCarregando } = useProdutosElegiveisPorMaquina(maquinaId);
  const { motivos: motivosParada } = useMotivosParada(true);

  const [produtoId, setProdutoId] = useState("");
  const [funcionarioId, setFuncionarioId] = useState("");
  const [quantidadeProduzida, setQuantidadeProduzida] = useState("");
  const [quantidadeRefugo, setQuantidadeRefugo] = useState("0");
  const [observacao, setObservacao] = useState("");
  const [paradasManuais, setParadasManuais] = useState<ParadaManual[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  const [performance, setPerformance] = useState<number | null>(null);
  const [produtoNomeSalvo, setProdutoNomeSalvo] = useState("");
  const [quantidadeSalva, setQuantidadeSalva] = useState(0);
  const [tempoParadoSalvo, setTempoParadoSalvo] = useState(0);

  const quantidadeProduzidaNum = Number(quantidadeProduzida);
  const podeSalvar =
    etapa !== "salvando" &&
    !!produtoId &&
    !!funcionarioId &&
    quantidadeProduzida !== "" &&
    !Number.isNaN(quantidadeProduzidaNum) &&
    quantidadeProduzidaNum >= 0;

  async function salvar() {
    if (!podeSalvar) return;
    setEtapa("salvando");
    setErro(null);

    const paradasPayload = paradasManuais.map((p) => ({ motivo_id: p.motivoId, minutos: p.minutos, descricao: p.descricao }));

    const { data, error } = modoRetroativo
      ? await supabase.rpc("registrar_apontamento_producao_retroativo", {
          p_maquina_id: maquinaId,
          p_produto_id: produtoId,
          p_funcionario_id: funcionarioId,
          p_quantidade_produzida: quantidadeProduzidaNum,
          p_quantidade_refugo: Number(quantidadeRefugo || 0),
          p_idempotency_key: idempotencyKey,
          p_data: modoRetroativo.data,
          p_periodo_id: modoRetroativo.periodoId,
          p_observacao: observacao.trim() || null,
          p_paradas: paradasPayload,
        })
      : await supabase.rpc("registrar_apontamento_producao", {
          p_maquina_id: maquinaId,
          p_produto_id: produtoId,
          p_funcionario_id: funcionarioId,
          p_quantidade_produzida: quantidadeProduzidaNum,
          p_quantidade_refugo: Number(quantidadeRefugo || 0),
          p_idempotency_key: idempotencyKey,
          p_observacao: observacao.trim() || null,
          p_paradas: paradasPayload,
        });

    if (error || !data) {
      setErro(mensagemErroRegistrarLancamento(error?.message));
      setEtapa("preenchendo");
      return;
    }

    const apontamento = (Array.isArray(data) ? data[0] : data) as ApontamentoRpcResult;

    const { data: paradasData } = await supabase
      .from("apontamento_paradas")
      .select("minutos")
      .eq("apontamento_id", apontamento.id);
    const somaParadasMinutos = (paradasData || []).reduce((soma, p) => soma + Number(p.minutos), 0);

    const perf =
      apontamento.meta_periodo_vigente != null && apontamento.duracao_periodo_horas_vigente != null
        ? calcularPerformance({
            quantidadeProduzida: Number(apontamento.quantidade_produzida),
            metaPeriodoVigente: Number(apontamento.meta_periodo_vigente),
            duracaoPeriodoHorasVigente: Number(apontamento.duracao_periodo_horas_vigente),
            somaParadasMinutos,
          })
        : null;

    const produtoSelecionado = produtos.find((p) => p.id === produtoId);
    setPerformance(perf);
    setProdutoNomeSalvo(produtoSelecionado?.nome || "");
    setQuantidadeSalva(Number(apontamento.quantidade_produzida));
    setTempoParadoSalvo(somaParadasMinutos);
    setEtapa("confirmado");
    onApontado({
      maquinaId,
      produtoNome: produtoSelecionado?.nome || "",
      quantidadeProduzida: Number(apontamento.quantidade_produzida),
    });
  }

  return (
    <div className="stx-modal-backdrop" onClick={etapa === "preenchendo" ? onFechar : undefined}>
      <div className="stx-modal-card stx-pr-modal" onClick={(e) => e.stopPropagation()}>
        {etapa === "confirmado" ? (
          <div className="stx-pr-confirmacao">
            <p className="stx-pr-confirmacao-check">✓ Apontamento salvo</p>
            <p className="stx-pr-confirmacao-produto">{produtoNomeSalvo} · {quantidadeSalva} un.</p>
            <p className="stx-pr-performance-label">PERFORMANCE</p>
            <p className="stx-pr-performance-valor">{performance == null ? "N/A" : `${performance.toFixed(0)}%`}</p>
            {tempoParadoSalvo > 0 && <p className="stx-pr-parada-total">Tempo parado: {tempoParadoSalvo} min</p>}
            <div className="stx-pr-confirmacao-acoes">
              {temProximaPendente && (
                <button type="button" className="stx-btn-primary" onClick={onProximaMaquina}>PRÓXIMA MÁQUINA</button>
              )}
              <button type="button" className="stx-btn-secondary" onClick={onFechar}>VER TODAS</button>
            </div>
          </div>
        ) : (
          <>
            <p className="stx-modal-titulo">{maquinaNome}</p>
            <p className="stx-panel-sub" style={{ marginTop: -10, marginBottom: 16 }}>{periodoNome} · {periodoHorario}</p>

            <div style={{ marginBottom: 12 }}>
              <label className="stx-label">Produto</label>
              <select className="stx-select" value={produtoId} onChange={(e) => setProdutoId(e.target.value)} disabled={produtosCarregando}>
                <option value="">{produtosCarregando ? "Carregando…" : "Selecione…"}</option>
                {produtos.map((p) => (
                  <option key={p.id} value={p.id}>{p.nome}</option>
                ))}
              </select>
              {!produtosCarregando && produtos.length === 0 && (
                <p className="stx-save-error" style={{ marginTop: 6 }}>Nenhum produto elegível cadastrado para esta máquina.</p>
              )}
            </div>

            <div style={{ marginBottom: 12 }}>
              <label className="stx-label">Funcionário</label>
              <select className="stx-select" value={funcionarioId} onChange={(e) => setFuncionarioId(e.target.value)}>
                <option value="">Selecione…</option>
                {funcionariosAtivos.map((f) => (
                  <option key={f.id} value={f.id}>{f.nome}</option>
                ))}
              </select>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <label className="stx-label">Quantidade produzida</label>
                <input type="number" inputMode="numeric" min={0} className="stx-input" value={quantidadeProduzida} onChange={(e) => setQuantidadeProduzida(e.target.value)} />
              </div>
              <div>
                <label className="stx-label">Refugo</label>
                <input type="number" inputMode="numeric" min={0} className="stx-input" value={quantidadeRefugo} onChange={(e) => setQuantidadeRefugo(e.target.value)} />
              </div>
            </div>

            <ParadasManuaisEditor paradasManuais={paradasManuais} onChange={setParadasManuais} motivosParada={motivosParada} />

            <div style={{ marginBottom: 16 }}>
              <label className="stx-label">Observação (opcional)</label>
              <input type="text" className="stx-input" value={observacao} onChange={(e) => setObservacao(e.target.value)} />
            </div>

            {erro && <p className="stx-save-error" style={{ marginBottom: 12 }}>{erro}</p>}

            <div className="stx-form-actions" style={{ flexDirection: "column" }}>
              <button type="button" className="stx-btn-primary" disabled={!podeSalvar} onClick={salvar}>
                {etapa === "salvando" ? "Salvando…" : "SALVAR APONTAMENTO"}
              </button>
              <button type="button" className="stx-btn-secondary" onClick={onFechar} disabled={etapa === "salvando"}>Cancelar</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
