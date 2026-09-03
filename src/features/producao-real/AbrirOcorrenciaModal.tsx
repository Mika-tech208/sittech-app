"use client";

// Fluxo "Informar máquina parada" (abrir ocorrência) — independente do
// apontamento de período. Máquina é um campo aqui (não vem definida por
// clique de card): a lista já vem filtrada pelo chamador pra só máquinas
// ativas sem ocorrência aberta (abrir_ocorrencia_maquina bloqueia uma
// segunda ocorrência no servidor de qualquer forma — o filtro aqui é só
// pra não deixar a supervisora escolher algo que sabidamente vai falhar).
// Produto é filtrado pelos elegíveis da máquina escolhida, mesma lógica
// (e mesmo hook) do formulário de apontamento. Motivo vem de
// motivos_parada, só ativos e vinculavel_ocorrencia=true (na prática,
// Quebra/Manutenção). Não pede horário — abertura é sempre "agora",
// resolvida pelo backend.

import { useEffect, useState } from "react";
import { supabase } from "@/services/supabase-client";
import { useProdutosElegiveisPorMaquina } from "@/hooks/useProdutosElegiveisPorMaquina";
import type { OcorrenciaAberta } from "@/hooks/useProducaoRealPainel";
import { mensagemErroOcorrencia } from "./calculations";

interface MaquinaSimples {
  id: string;
  nome: string;
}

interface FuncionarioSimples {
  id: string;
  nome: string;
}

interface MotivoOcorrencia {
  id: string;
  nome: string;
}

interface OcorrenciaRpcResult {
  id: string;
  aberta_em: string;
}

export interface AbrirOcorrenciaModalProps {
  maquinasDisponiveis: MaquinaSimples[];
  funcionariosAtivos: FuncionarioSimples[];
  onFechar: () => void;
  onAberta: (maquinaId: string, ocorrencia: OcorrenciaAberta) => void;
}

type Etapa = "preenchendo" | "salvando" | "confirmado";

export default function AbrirOcorrenciaModal({ maquinasDisponiveis, funcionariosAtivos, onFechar, onAberta }: AbrirOcorrenciaModalProps) {
  const [etapa, setEtapa] = useState<Etapa>("preenchendo");
  const [erro, setErro] = useState<string | null>(null);

  const [motivos, setMotivos] = useState<MotivoOcorrencia[]>([]);
  const [motivosCarregando, setMotivosCarregando] = useState(true);

  const [maquinaId, setMaquinaId] = useState("");
  const [produtoId, setProdutoId] = useState("");
  const [funcionarioId, setFuncionarioId] = useState("");
  const [motivoId, setMotivoId] = useState("");
  const [descricao, setDescricao] = useState("");

  const [maquinaNomeSalva, setMaquinaNomeSalva] = useState("");

  const { produtos, loading: produtosCarregando } = useProdutosElegiveisPorMaquina(maquinaId || null);

  useEffect(() => {
    let montado = true;
    (async () => {
      const { data, error } = await supabase
        .from("motivos_parada")
        .select("id, nome")
        .eq("ativo", true)
        .eq("vinculavel_ocorrencia", true)
        .order("nome");
      if (!montado) return;
      if (!error) setMotivos(data || []);
      setMotivosCarregando(false);
    })();
    return () => { montado = false; };
  }, []);

  // trocar de máquina invalida a escolha de produto anterior — evita
  // enviar um produto de outra máquina por engano
  function selecionarMaquina(id: string) {
    setMaquinaId(id);
    setProdutoId("");
  }

  const podeSalvar =
    etapa !== "salvando" && !!maquinaId && !!produtoId && !!funcionarioId && !!motivoId && descricao.trim().length > 0;

  async function salvar() {
    if (!podeSalvar) return;
    setEtapa("salvando");
    setErro(null);

    const { data, error } = await supabase.rpc("abrir_ocorrencia_maquina", {
      p_maquina_id: maquinaId,
      p_produto_id: produtoId,
      p_funcionario_id: funcionarioId,
      p_motivo_id: motivoId,
      p_descricao: descricao.trim(),
    });

    if (error || !data) {
      setErro(mensagemErroOcorrencia(error?.message));
      setEtapa("preenchendo");
      return;
    }

    const ocorrencia = data as OcorrenciaRpcResult;
    const maquina = maquinasDisponiveis.find((m) => m.id === maquinaId);
    const produto = produtos.find((p) => p.id === produtoId);
    const funcionario = funcionariosAtivos.find((f) => f.id === funcionarioId);
    const motivo = motivos.find((mo) => mo.id === motivoId);

    setMaquinaNomeSalva(maquina?.nome || "");
    setEtapa("confirmado");
    onAberta(maquinaId, {
      id: ocorrencia.id,
      produtoNome: produto?.nome || "",
      funcionarioNome: funcionario?.nome || "",
      motivoNome: motivo?.nome || "",
      descricao: descricao.trim(),
      abertaEm: ocorrencia.aberta_em,
    });
  }

  return (
    <div className="stx-modal-backdrop" onClick={etapa === "preenchendo" ? onFechar : undefined}>
      <div className="stx-modal-card stx-pr-modal" onClick={(e) => e.stopPropagation()}>
        {etapa === "confirmado" ? (
          <div className="stx-pr-confirmacao">
            <p className="stx-pr-confirmacao-check">🔴 Máquina parada</p>
            <p className="stx-pr-confirmacao-produto">{maquinaNomeSalva}</p>
            <div className="stx-pr-confirmacao-acoes">
              <button type="button" className="stx-btn-primary" onClick={onFechar}>Fechar</button>
            </div>
          </div>
        ) : (
          <>
            <p className="stx-modal-titulo">Informar máquina parada</p>

            <div style={{ marginBottom: 12 }}>
              <label className="stx-label">Máquina</label>
              <select className="stx-select" value={maquinaId} onChange={(e) => selecionarMaquina(e.target.value)}>
                <option value="">Selecione…</option>
                {maquinasDisponiveis.map((m) => (
                  <option key={m.id} value={m.id}>{m.nome}</option>
                ))}
              </select>
              {maquinasDisponiveis.length === 0 && (
                <p className="stx-save-error" style={{ marginTop: 6 }}>Nenhuma máquina disponível — todas já têm ocorrência aberta.</p>
              )}
            </div>

            <div style={{ marginBottom: 12 }}>
              <label className="stx-label">Produto</label>
              <select className="stx-select" value={produtoId} onChange={(e) => setProdutoId(e.target.value)} disabled={!maquinaId || produtosCarregando}>
                <option value="">{!maquinaId ? "Selecione a máquina primeiro" : produtosCarregando ? "Carregando…" : "Selecione…"}</option>
                {produtos.map((p) => (
                  <option key={p.id} value={p.id}>{p.nome}</option>
                ))}
              </select>
              {maquinaId && !produtosCarregando && produtos.length === 0 && (
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

            <div style={{ marginBottom: 12 }}>
              <label className="stx-label">Tipo/motivo</label>
              <select className="stx-select" value={motivoId} onChange={(e) => setMotivoId(e.target.value)} disabled={motivosCarregando}>
                <option value="">{motivosCarregando ? "Carregando…" : "Selecione…"}</option>
                {motivos.map((mo) => (
                  <option key={mo.id} value={mo.id}>{mo.nome}</option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label className="stx-label">O que aconteceu?</label>
              <input type="text" className="stx-input" value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Descreva o problema" />
            </div>

            {erro && <p className="stx-save-error" style={{ marginBottom: 12 }}>{erro}</p>}

            <div className="stx-form-actions" style={{ flexDirection: "column" }}>
              <button type="button" className="stx-btn-primary" disabled={!podeSalvar} onClick={salvar}>
                {etapa === "salvando" ? "Salvando…" : "INFORMAR MÁQUINA PARADA"}
              </button>
              <button type="button" className="stx-btn-secondary" onClick={onFechar} disabled={etapa === "salvando"}>Cancelar</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
