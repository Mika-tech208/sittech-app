"use client";

// Resumo completo de um apontamento realizado + edição — máquina, data e
// período NUNCA são editáveis nesta V1 (mostrados só como texto). Troca
// de status (produzindo <-> sem_producao) não é possível. Histórico é
// gravado automaticamente pelo backend (editar_apontamento_producao/
// editar_apontamento_sem_producao) — não é exposto aqui pra supervisora.

import { useEffect, useState } from "react";
import { supabase } from "@/services/supabase-client";
import { useProdutosElegiveisPorMaquina } from "@/hooks/useProdutosElegiveisPorMaquina";
import { useMotivosParada } from "@/hooks/useMotivosParada";
import { MOTIVOS, LABEL_MOTIVO_SEM_PRODUCAO } from "./SemProducaoModal";
import { mensagemErroRegistrarLancamento } from "./calculations";
import ParadasManuaisEditor, { type ParadaManual, type ParadaAutomatica } from "./ParadasManuaisEditor";
import type { ApontamentoRealizado } from "@/hooks/useApontamentosRealizados";

interface ParadaRow {
  motivo_id: string;
  minutos: number;
  descricao: string | null;
  ocorrencia_id: string | null;
  motivos_parada: { nome: string } | null;
}

interface FuncionarioSimples {
  id: string;
  nome: string;
}

export interface ResumoApontamentoModalProps {
  apontamento: ApontamentoRealizado;
  funcionariosAtivos: FuncionarioSimples[];
  onFechar: () => void;
  onEditado: (id: string, patch: Partial<ApontamentoRealizado>) => void;
}

type Modo = "resumo" | "editando" | "salvo";

const LABEL_STATUS: Record<string, string> = { produzindo: "Apontado", sem_producao: "Sem produção" };

export default function ResumoApontamentoModal({ apontamento, funcionariosAtivos, onFechar, onEditado }: ResumoApontamentoModalProps) {
  const [modo, setModo] = useState<Modo>("resumo");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // campos de edição — produzindo
  const [produtoId, setProdutoId] = useState(apontamento.produtoId || "");
  const [funcionarioId, setFuncionarioId] = useState(apontamento.funcionarioId || "");
  const [quantidadeProduzida, setQuantidadeProduzida] = useState(String(apontamento.quantidadeProduzida));
  const [quantidadeRefugo, setQuantidadeRefugo] = useState(String(apontamento.quantidadeRefugo));
  const [observacao, setObservacao] = useState(apontamento.observacao || "");

  // campos de edição — sem_producao
  const [motivo, setMotivo] = useState(apontamento.motivoSemProducao || "");
  const [descricao, setDescricao] = useState(apontamento.descricaoSemProducao || "");

  const { produtos, loading: produtosCarregando } = useProdutosElegiveisPorMaquina(
    modo === "editando" && apontamento.status === "produzindo" ? apontamento.maquinaId : null
  );
  const { motivos: motivosParada } = useMotivosParada(apontamento.status === "produzindo");

  // Paradas do período (manuais + automáticas de ocorrência) — só faz
  // sentido pra "produzindo"; "sem_producao" não é tocado nesta etapa (ver
  // calculations.ts / decisão pendente reportada ao final). Carregada uma
  // vez na abertura do modal, independente do modo, pra já alimentar o
  // "Tempo parado" no resumo.
  const [paradasAutomaticas, setParadasAutomaticas] = useState<ParadaAutomatica[]>([]);
  const [paradasManuais, setParadasManuais] = useState<ParadaManual[]>([]);
  useEffect(() => {
    if (apontamento.status !== "produzindo") return;
    let montado = true;
    (async () => {
      const { data } = await supabase
        .from("apontamento_paradas")
        .select("motivo_id, minutos, descricao, ocorrencia_id, motivos_parada(nome)")
        .eq("apontamento_id", apontamento.id)
        .returns<ParadaRow[]>();
      if (!montado || !data) return;
      setParadasAutomaticas(
        data.filter((p) => p.ocorrencia_id !== null).map((p) => ({ motivoNome: p.motivos_parada?.nome || "Motivo", minutos: Number(p.minutos) }))
      );
      setParadasManuais(
        data.filter((p) => p.ocorrencia_id === null).map((p) => ({ motivoId: p.motivo_id, minutos: Number(p.minutos), descricao: p.descricao }))
      );
    })();
    return () => { montado = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apontamento.id, apontamento.status]);

  const tempoParadoTotal =
    paradasAutomaticas.reduce((soma, p) => soma + p.minutos, 0) + paradasManuais.reduce((soma, p) => soma + p.minutos, 0);

  // garante que o funcionário atual do apontamento apareça na lista mesmo
  // que hoje esteja inativo — senão a edição "perderia" a seleção original
  const funcionariosParaSelecionar =
    !apontamento.funcionarioId || funcionariosAtivos.some((f) => f.id === apontamento.funcionarioId)
      ? funcionariosAtivos
      : [...funcionariosAtivos, { id: apontamento.funcionarioId, nome: apontamento.funcionarioNome || "Funcionário" }];

  const precisaDescricao = motivo === "outro";

  const podeSalvarProducao =
    !salvando && !!produtoId && !!funcionarioId && quantidadeProduzida !== "" &&
    !Number.isNaN(Number(quantidadeProduzida)) && Number(quantidadeProduzida) >= 0 &&
    !Number.isNaN(Number(quantidadeRefugo || 0)) && Number(quantidadeRefugo || 0) >= 0 &&
    Number(quantidadeRefugo || 0) <= Number(quantidadeProduzida);

  const podeSalvarSemProducao = !salvando && !!motivo && (!precisaDescricao || descricao.trim().length > 0);

  async function salvarProducao() {
    if (!podeSalvarProducao) return;
    setSalvando(true);
    setErro(null);
    const { data, error } = await supabase.rpc("editar_apontamento_producao", {
      p_apontamento_id: apontamento.id,
      p_produto_id: produtoId,
      p_funcionario_id: funcionarioId,
      p_quantidade_produzida: Number(quantidadeProduzida),
      p_quantidade_refugo: Number(quantidadeRefugo || 0),
      p_observacao: observacao.trim() || null,
      p_paradas: paradasManuais.map((p) => ({ motivo_id: p.motivoId, minutos: p.minutos, descricao: p.descricao })),
    });
    if (error || !data) {
      setErro(mensagemErroRegistrarLancamento(error?.message));
      setSalvando(false);
      return;
    }
    const produtoSelecionado = produtos.find((p) => p.id === produtoId);
    const funcionarioSelecionado = funcionariosParaSelecionar.find((f) => f.id === funcionarioId);
    onEditado(apontamento.id, {
      produtoId,
      produtoNome: produtoSelecionado?.nome || apontamento.produtoNome,
      funcionarioId,
      funcionarioNome: funcionarioSelecionado?.nome || apontamento.funcionarioNome,
      quantidadeProduzida: Number(quantidadeProduzida),
      quantidadeRefugo: Number(quantidadeRefugo || 0),
      observacao: observacao.trim() || null,
    });
    setSalvando(false);
    setModo("salvo");
  }

  async function salvarSemProducao() {
    if (!podeSalvarSemProducao) return;
    setSalvando(true);
    setErro(null);
    const { data, error } = await supabase.rpc("editar_apontamento_sem_producao", {
      p_apontamento_id: apontamento.id,
      p_motivo_sem_producao: motivo,
      p_descricao_sem_producao: precisaDescricao ? descricao.trim() : null,
    });
    if (error || !data) {
      setErro(mensagemErroRegistrarLancamento(error?.message));
      setSalvando(false);
      return;
    }
    onEditado(apontamento.id, {
      motivoSemProducao: motivo,
      descricaoSemProducao: precisaDescricao ? descricao.trim() : null,
    });
    setSalvando(false);
    setModo("salvo");
  }

  const dataFormatada = apontamento.data.split("-").reverse().join("/");

  return (
    <div className="stx-modal-backdrop" onClick={!salvando ? onFechar : undefined}>
      <div className="stx-modal-card stx-pr-modal" onClick={(e) => e.stopPropagation()}>
        {modo === "salvo" ? (
          <div className="stx-pr-confirmacao">
            <p className="stx-pr-confirmacao-check">✓ Apontamento atualizado</p>
            <div className="stx-pr-confirmacao-acoes">
              <button type="button" className="stx-btn-primary" onClick={onFechar}>Fechar</button>
            </div>
          </div>
        ) : modo === "resumo" ? (
          <>
            <p className="stx-modal-titulo">{apontamento.maquinaNome}</p>
            <p className="stx-panel-sub" style={{ marginTop: -10, marginBottom: 16 }}>
              {dataFormatada} · {apontamento.periodoNome}
            </p>
            <div className="stx-pr-resumo-linhas">
              <div className="stx-pr-resumo-linha"><span>Status</span><b>{LABEL_STATUS[apontamento.status]}</b></div>
              {apontamento.status === "produzindo" ? (
                <>
                  <div className="stx-pr-resumo-linha"><span>Produto</span><b>{apontamento.produtoNome}</b></div>
                  <div className="stx-pr-resumo-linha"><span>Funcionário</span><b>{apontamento.funcionarioNome}</b></div>
                  <div className="stx-pr-resumo-linha"><span>Produzido</span><b>{apontamento.quantidadeProduzida} un.</b></div>
                  <div className="stx-pr-resumo-linha"><span>Refugo</span><b>{apontamento.quantidadeRefugo} un.</b></div>
                  {tempoParadoTotal > 0 && <div className="stx-pr-resumo-linha"><span>Tempo parado</span><b>{tempoParadoTotal} min</b></div>}
                  {apontamento.observacao && <div className="stx-pr-resumo-linha"><span>Observação</span><b>{apontamento.observacao}</b></div>}
                </>
              ) : (
                <>
                  <div className="stx-pr-resumo-linha">
                    <span>Motivo</span>
                    <b>{LABEL_MOTIVO_SEM_PRODUCAO[apontamento.motivoSemProducao || ""] || apontamento.motivoSemProducao}</b>
                  </div>
                  {apontamento.descricaoSemProducao && (
                    <div className="stx-pr-resumo-linha"><span>Descrição</span><b>{apontamento.descricaoSemProducao}</b></div>
                  )}
                </>
              )}
            </div>
            <div className="stx-form-actions" style={{ flexDirection: "column", marginTop: 16 }}>
              <button type="button" className="stx-btn-primary" onClick={() => setModo("editando")}>EDITAR APONTAMENTO</button>
              <button type="button" className="stx-btn-secondary" onClick={onFechar}>Fechar</button>
            </div>
          </>
        ) : apontamento.status === "produzindo" ? (
          <>
            <p className="stx-modal-titulo">{apontamento.maquinaNome}</p>
            <p className="stx-panel-sub" style={{ marginTop: -10, marginBottom: 16 }}>
              {dataFormatada} · {apontamento.periodoNome} — máquina/data/período não são editáveis
            </p>

            <div style={{ marginBottom: 12 }}>
              <label className="stx-label">Produto</label>
              <select className="stx-select" value={produtoId} onChange={(e) => setProdutoId(e.target.value)} disabled={produtosCarregando}>
                <option value="">{produtosCarregando ? "Carregando…" : "Selecione…"}</option>
                {produtos.map((p) => (
                  <option key={p.id} value={p.id}>{p.nome}</option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label className="stx-label">Funcionário</label>
              <select className="stx-select" value={funcionarioId} onChange={(e) => setFuncionarioId(e.target.value)}>
                <option value="">Selecione…</option>
                {funcionariosParaSelecionar.map((f) => (
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

            <ParadasManuaisEditor
              paradasManuais={paradasManuais}
              onChange={setParadasManuais}
              motivosParada={motivosParada}
              paradasAutomaticas={paradasAutomaticas}
            />

            <div style={{ marginBottom: 16 }}>
              <label className="stx-label">Observação (opcional)</label>
              <input type="text" className="stx-input" value={observacao} onChange={(e) => setObservacao(e.target.value)} />
            </div>

            {erro && <p className="stx-save-error" style={{ marginBottom: 12 }}>{erro}</p>}

            <div className="stx-form-actions" style={{ flexDirection: "column" }}>
              <button type="button" className="stx-btn-primary" disabled={!podeSalvarProducao} onClick={salvarProducao}>
                {salvando ? "Salvando…" : "SALVAR ALTERAÇÕES"}
              </button>
              <button type="button" className="stx-btn-secondary" onClick={() => setModo("resumo")} disabled={salvando}>Cancelar</button>
            </div>
          </>
        ) : (
          <>
            <p className="stx-modal-titulo">{apontamento.maquinaNome}</p>
            <p className="stx-panel-sub" style={{ marginTop: -10, marginBottom: 16 }}>
              {dataFormatada} · {apontamento.periodoNome} — máquina/data/período não são editáveis
            </p>

            <label className="stx-label">Motivo</label>
            <div className="stx-pr-motivos-grid">
              {MOTIVOS.map((m) => (
                <button
                  key={m.valor}
                  type="button"
                  className={`stx-pr-motivo-btn ${motivo === m.valor ? "selecionado" : ""}`}
                  onClick={() => setMotivo(m.valor)}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {precisaDescricao && (
              <div style={{ marginTop: 14, marginBottom: 4 }}>
                <label className="stx-label">Descrição</label>
                <input type="text" className="stx-input" value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Descreva o motivo" />
              </div>
            )}

            {erro && <p className="stx-save-error" style={{ marginTop: 12, marginBottom: 4 }}>{erro}</p>}

            <div className="stx-form-actions" style={{ flexDirection: "column", marginTop: 16 }}>
              <button type="button" className="stx-btn-primary" disabled={!podeSalvarSemProducao} onClick={salvarSemProducao}>
                {salvando ? "Salvando…" : "SALVAR ALTERAÇÕES"}
              </button>
              <button type="button" className="stx-btn-secondary" onClick={() => setModo("resumo")} disabled={salvando}>Cancelar</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
