"use client";

// REGULARIZAR APONTAMENTOS ANTERIORES — modo administrativo (admin / perfil superior) para registrar o que REALMENTE aconteceu num dia passado liberado.
// Campos livres (período, máquina, operador, produto, operação, produzido, refugo); NÃO depende da escala planejada nem do período estar confirmado.
// Toda a regra e a auditoria estão no banco (RPCs regularizar_*): esta tela só coleta os dados. Não recalcula escala/inventário/fechamento.
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/services/supabase-client";

interface Periodo { id: string; nome: string; inicio: string; fim: string }
interface Item { id: string; nome: string }
interface Combinacao { maquina_id: string; produto_id: string; etapa_id: string; operacao: string | null; metas: Record<string, number | null> }
interface Linha {
  id: string; periodo_id: string; maquina_id: string; maquina: string; funcionario_id: string | null; funcionario: string | null; produto_id: string | null; produto: string | null;
  etapa_id: string | null; operacao: string | null; status: string; motivo_sem_producao: string | null; produzido: number; refugo: number; regularizado: boolean;
  planejado: { funcionario: string | null; produto: string | null } | null;
}
interface Estado {
  datas: string[]; periodos: Periodo[]; maquinas: Item[]; funcionarios: Item[]; produtos: Item[]; combinacoes: Combinacao[];
  estado_periodos?: { periodo_id: string; estado: string }[]; apontamentos?: Linha[];
}

const MENSAGENS: [string, string][] = [
  ["COMBINACAO_INVALIDA", "Esta máquina não tem este produto/operação cadastrado no roteiro."],
  ["OPERACAO_AMBIGUA", "Há mais de uma operação possível para este produto nesta máquina: escolha a operação."],
  ["META_NAO_CADASTRADA", "Este produto/operação não tem meta cadastrada para este período. Cadastre a meta no roteiro do produto para poder lançar."],
  ["REGULARIZACAO_JA_EXISTE", "Já existe apontamento desta máquina neste período. Use Editar na lista."],
  ["QUANTIDADE_INVALIDA", "Confira produzido e refugo (zero ou mais; refugo não pode passar do produzido)."],
  ["FUNCIONARIO_INVALIDO", "Operador inválido ou inativo."],
  ["MAQUINA_INVALIDA", "Máquina inválida ou inativa."],
  ["PRODUTO_INVALIDO", "Produto inválido ou inativo."],
  ["REGULARIZACAO_DATA_NAO_LIBERADA", "Esta data não está liberada para regularização."],
  ["REGULARIZACAO_DATA_INVALIDA", "Só é possível regularizar datas anteriores a hoje."],
  ["REGULARIZACAO_SEM_PERMISSAO", "Apenas administradores/perfil superior podem regularizar."],
];
function traduzir(msg: string | undefined): string {
  const m = msg ?? "";
  const achou = MENSAGENS.find(([c]) => m.includes(c));
  return achou ? achou[1] : "Não foi possível salvar. Confira os campos e tente de novo.";
}
const dataBr = (d: string) => d.split("-").reverse().join("/");

export default function RegularizacaoHistoricaModal({ onFechar, dataInicial, periodoInicial }: { onFechar: () => void; dataInicial?: string; periodoInicial?: string }) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [data, setData] = useState<string | null>(null);
  const [periodoId, setPeriodoId] = useState<string>(periodoInicial ?? "m1");
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  // formulário
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [maquinaId, setMaquinaId] = useState("");
  const [funcionarioId, setFuncionarioId] = useState("");
  const [produtoId, setProdutoId] = useState("");
  const [etapaId, setEtapaId] = useState("");
  const [produzido, setProduzido] = useState("");
  const [refugo, setRefugo] = useState("");
  const [confirmandoExclusao, setConfirmandoExclusao] = useState<string | null>(null);

  const buscar = useCallback(async (d: string | null): Promise<{ e?: Estado; erro?: string }> => {
    const { data: r, error } = await supabase.rpc("regularizacao_historica_estado", { p_data: d });
    if (error || !r) return { erro: error?.message?.includes("REGULARIZACAO_SEM_PERMISSAO") ? "Apenas administradores/perfil superior podem regularizar." : "Não foi possível carregar os dados da regularização." };
    return { e: r as Estado };
  }, []);
  const aplicar = useCallback((res: { e?: Estado; erro?: string }, primeira: boolean) => {
    setCarregando(false);
    if (res.erro || !res.e) { setErro(res.erro ?? "Não foi possível carregar."); return; }
    setEstado(res.e);
    if (primeira && res.e.datas.length > 0) setData(dataInicial && res.e.datas.includes(dataInicial) ? dataInicial : res.e.datas[0]);
  }, [dataInicial]);
  const recarregar = useCallback(async (d: string) => { aplicar(await buscar(d), false); }, [buscar, aplicar]);
  useEffect(() => { let vivo = true; buscar(null).then((r) => { if (vivo) aplicar(r, true); }); return () => { vivo = false; }; }, [buscar, aplicar]);
  useEffect(() => { if (!data) return; let vivo = true; buscar(data).then((r) => { if (vivo) aplicar(r, false); }); return () => { vivo = false; }; }, [data, buscar, aplicar]);

  function limparFormulario() { setEditandoId(null); setMaquinaId(""); setFuncionarioId(""); setProdutoId(""); setEtapaId(""); setProduzido(""); setRefugo(""); }
  function trocarContexto(fn: () => void) { limparFormulario(); setOk(null); setErro(null); fn(); }

  const linhasDoPeriodo = useMemo(() => (estado?.apontamentos ?? []).filter((a) => a.periodo_id === periodoId), [estado, periodoId]);
  const existenteNaMaquina = useMemo(() => (maquinaId ? linhasDoPeriodo.find((a) => a.maquina_id === maquinaId) : undefined), [linhasDoPeriodo, maquinaId]);
  const produtosDaMaquina = useMemo(() => {
    if (!estado || !maquinaId) return [];
    const ids = new Set(estado.combinacoes.filter((c) => c.maquina_id === maquinaId).map((c) => c.produto_id));
    return estado.produtos.filter((p) => ids.has(p.id));
  }, [estado, maquinaId]);
  const etapas = useMemo(() => (estado && maquinaId && produtoId ? estado.combinacoes.filter((c) => c.maquina_id === maquinaId && c.produto_id === produtoId) : []), [estado, maquinaId, produtoId]);
  const etapaEfetiva = etapas.length === 1 ? etapas[0].etapa_id : etapaId;
  const estadoDoPeriodo = estado?.estado_periodos?.find((e) => e.periodo_id === periodoId)?.estado;

  function editar(l: Linha) {
    setEditandoId(l.id); setMaquinaId(l.maquina_id); setFuncionarioId(l.funcionario_id ?? ""); setProdutoId(l.produto_id ?? ""); setEtapaId(l.etapa_id ?? "");
    setProduzido(String(l.produzido)); setRefugo(String(l.refugo)); setOk(null); setErro(null);
  }
  const valido = !!data && !!maquinaId && !!funcionarioId && !!produtoId && !!etapaEfetiva && produzido !== "" && Number(produzido) >= 0 && Number(refugo || 0) >= 0 && Number(refugo || 0) <= Number(produzido);

  async function salvar() {
    if (!valido || !data || salvando) return;
    setSalvando(true); setErro(null); setOk(null);
    const { data: r, error } = await supabase.rpc("regularizar_apontamento_historico", {
      p_data: data, p_periodo_id: periodoId, p_maquina_id: maquinaId, p_funcionario_id: funcionarioId, p_produto_id: produtoId, p_produzido: Number(produzido),
      p_refugo: Number(refugo || 0), p_etapa_id: etapaEfetiva, p_apontamento_id: editandoId, p_substituir: false,
    });
    setSalvando(false);
    if (error || !r) { setErro(traduzir(error?.message)); return; }
    const acao = (r as { acao?: string }).acao;
    setOk(acao === "INCLUIDO" ? "Apontamento incluído. Pode lançar o próximo." : "Apontamento atualizado. Pode lançar o próximo.");
    limparFormulario();
    await recarregar(data);
  }
  async function excluir(id: string) {
    setSalvando(true); setErro(null); setOk(null);
    const { error } = await supabase.rpc("regularizar_excluir_apontamento_historico", { p_apontamento_id: id });
    setSalvando(false); setConfirmandoExclusao(null);
    if (error) { setErro(traduzir(error.message)); return; }
    setOk("Apontamento excluído (registro anterior guardado na auditoria).");
    if (editandoId === id) limparFormulario();
    if (data) await recarregar(data);
  }

  const estiloCampo = { width: "100%", boxSizing: "border-box" as const, marginBottom: 8 };
  return (
    <div className="stx-modal-backdrop" onClick={salvando ? undefined : onFechar}>
      <div className="stx-ap-modal-card" style={{ maxWidth: 760, width: "96%", maxHeight: "92vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div className="stx-ap-modal-head">
          <p className="stx-ap-modal-title" style={{ margin: 0 }}>REGULARIZAÇÃO HISTÓRICA ADMINISTRATIVA</p>
          <button type="button" className="stx-ap-modal-close" onClick={onFechar} aria-label="Fechar">✕</button>
        </div>
        <p className="stx-ap-modal-eyebrow" style={{ margin: "4px 0 12px" }}>Registre o que realmente aconteceu. Não depende da escala planejada e vale mesmo com o período confirmado. Cada inclusão, alteração ou exclusão fica auditada (origem REGULARIZACAO_HISTORICA). Não recalcula nem altera a escala, o inventário ou o fechamento de hoje.</p>

        {carregando && !estado && <p>Carregando…</p>}
        {estado && estado.datas.length === 0 && <p className="stx-ap-error">Nenhuma data está liberada para regularização.</p>}
        {estado && estado.datas.length > 0 && (
          <>
            <label className="stx-ap-field-label">1. Data</label>
            <select className="stx-ap-select" style={estiloCampo} value={data ?? ""} onChange={(e) => trocarContexto(() => setData(e.target.value))}>
              {estado.datas.map((d) => <option key={d} value={d}>{dataBr(d)}</option>)}
            </select>

            <label className="stx-ap-field-label">2. Período</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
              {estado.periodos.map((p) => {
                const n = (estado.apontamentos ?? []).filter((a) => a.periodo_id === p.id).length;
                const ativo = p.id === periodoId;
                return <button key={p.id} type="button" className={ativo ? "stx-ap-btn-primary" : "stx-apr-pill-btn"} onClick={() => trocarContexto(() => setPeriodoId(p.id))}>{p.nome} ({n})</button>;
              })}
            </div>
            {estadoDoPeriodo && <p className="stx-ap-modal-eyebrow">Fechamento deste período: {estadoDoPeriodo}. A regularização é permitida mesmo assim.</p>}

            <p style={{ fontWeight: 600, margin: "8px 0 4px" }}>Apontamentos existentes ({linhasDoPeriodo.length})</p>
            {linhasDoPeriodo.length === 0 && <p className="stx-ap-modal-eyebrow">Nenhum apontamento neste período.</p>}
            {linhasDoPeriodo.map((l) => (
              <div key={l.id} style={{ border: "1px solid var(--stx-border, #8884)", borderRadius: 8, padding: 8, marginBottom: 6, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <strong>{l.maquina}</strong> · {l.status === "produzindo" ? `${l.produto ?? "—"} (${l.operacao ?? "—"})` : "Sem produção"}<br />
                  <span style={{ fontSize: 13 }}>{l.funcionario ?? "—"} · produzido {l.produzido} · refugo {l.refugo}{l.regularizado ? " · REGULARIZADO" : ""}</span>
                  {l.planejado && <span style={{ fontSize: 12, display: "block", opacity: 0.7 }}>Planejado: {l.planejado.funcionario ?? "—"} / {l.planejado.produto ?? "—"}</span>}
                </div>
                <button type="button" className="stx-apr-pill-btn" onClick={() => editar(l)} disabled={salvando}>Editar</button>
                {confirmandoExclusao === l.id
                  ? <button type="button" className="stx-ap-btn-danger solido" onClick={() => excluir(l.id)} disabled={salvando}>Confirmar exclusão</button>
                  : <button type="button" className="stx-apr-pill-btn" onClick={() => setConfirmandoExclusao(l.id)} disabled={salvando}>Excluir</button>}
              </div>
            ))}

            <p style={{ fontWeight: 600, margin: "14px 0 6px" }}>{editandoId ? "Editando apontamento" : "Adicionar apontamento"}</p>
            <label className="stx-ap-field-label">3. Máquina</label>
            <select className="stx-ap-select" style={estiloCampo} value={maquinaId} disabled={!!editandoId && false} onChange={(e) => { setMaquinaId(e.target.value); setProdutoId(""); setEtapaId(""); }}>
              <option value="">Selecione…</option>
              {estado.maquinas.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
            </select>
            {existenteNaMaquina && !editandoId && (
              <p className="stx-ap-error" style={{ margin: "0 0 8px" }}>Já existe apontamento desta máquina neste período ({existenteNaMaquina.produto ?? "sem produção"}, produzido {existenteNaMaquina.produzido}). <button type="button" className="stx-apr-pill-btn" onClick={() => editar(existenteNaMaquina)}>Editar o existente</button></p>
            )}
            <label className="stx-ap-field-label">4. Operador</label>
            <select className="stx-ap-select" style={estiloCampo} value={funcionarioId} onChange={(e) => setFuncionarioId(e.target.value)}>
              <option value="">Selecione…</option>
              {estado.funcionarios.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </select>
            <label className="stx-ap-field-label">5. Produto {maquinaId ? "(somente os cadastrados para a máquina)" : ""}</label>
            <select className="stx-ap-select" style={estiloCampo} value={produtoId} disabled={!maquinaId} onChange={(e) => { setProdutoId(e.target.value); setEtapaId(""); }}>
              <option value="">{maquinaId ? "Selecione…" : "Escolha a máquina primeiro"}</option>
              {produtosDaMaquina.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
            <label className="stx-ap-field-label">6. Operação</label>
            {etapas.length > 1
              ? <select className="stx-ap-select" style={estiloCampo} value={etapaId} onChange={(e) => setEtapaId(e.target.value)}><option value="">Selecione…</option>{etapas.map((c) => <option key={c.etapa_id} value={c.etapa_id}>{c.operacao ?? "Operação"}</option>)}</select>
              : <input className="stx-ap-input" style={estiloCampo} value={etapas[0]?.operacao ?? (produtoId ? "—" : "Definida pela máquina + produto")} readOnly />}
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: 1 }}><label className="stx-ap-field-label">7. Produzido</label><input className="stx-ap-input" style={estiloCampo} type="number" min={0} inputMode="decimal" value={produzido} onChange={(e) => setProduzido(e.target.value)} /></div>
              <div style={{ flex: 1 }}><label className="stx-ap-field-label">8. Refugo</label><input className="stx-ap-input" style={estiloCampo} type="number" min={0} inputMode="decimal" value={refugo} onChange={(e) => setRefugo(e.target.value)} placeholder="0" /></div>
            </div>

            {erro && <p className="stx-ap-error">{erro}</p>}
            {ok && <p className="stx-ap-confirm-check">✓ {ok}</p>}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="stx-ap-btn-primary" onClick={salvar} disabled={!valido || salvando}>{salvando ? "Salvando…" : editandoId ? "Salvar alteração" : "Salvar e adicionar outro"}</button>
              {editandoId && <button type="button" className="stx-apr-pill-btn" onClick={limparFormulario} disabled={salvando}>Cancelar edição</button>}
              <button type="button" className="stx-apr-pill-btn" onClick={onFechar} disabled={salvando}>Concluir</button>
            </div>
          </>
        )}
        {erro && !estado && <p className="stx-ap-error">{erro}</p>}
      </div>
    </div>
  );
}
