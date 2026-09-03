"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { useAuthSession } from "@/hooks/useAuthSession";
import { useCadastrosBase } from "@/hooks/useCadastrosBase";
import { useFuncionarios } from "@/hooks/useFuncionarios";
import { useMaquinas } from "@/hooks/useMaquinas";
import { useProdutos } from "@/hooks/useProdutos";
import { usePrevisoes } from "@/hooks/usePrevisoes";
import { useCustos } from "@/hooks/useCustos";
import LoginScreen from "@/components/shell/LoginScreen";
import RecoveryPasswordScreen from "@/components/shell/RecoveryPasswordScreen";
import Sidebar from "@/components/shell/Sidebar";
import TopBarActions from "@/components/shell/TopBarActions";
import AccountModal from "@/components/shell/AccountModal";
import AcessoNegado from "@/components/shell/AcessoNegado";
import GlobalStyles from "@/components/shell/GlobalStyles";
import { temPermissao } from "@/lib/permissoes";
import { THEMES } from "@/lib/constants";
import { formatBRL, toNumber, setModoPrivadoAtivo } from "@/lib/format";
import { weekLabel, shiftWeek, toISODate, mondayOf } from "@/lib/date";
import {
  calcularPeriodosComDuracao, filtrarPeriodosValidos, calcularHorasPorDia, calcularDuracaoMediaPeriodo, calcularHorasPorMaquinaSemana,
} from "@/lib/calculations/periodos";
import {
  calcularTotalFixoAtivo, calcularTotalCustoFuncionariosAtivos, calcularCustoHoraEOperacoes, calcularMargemProduto, calcularMetaFaturamento,
} from "@/features/custo-hora/calculations";
import { selecionarSemana, calcularResumoSemana } from "@/features/capacidade/selectors";
import {
  calcularAnaliseCapacidadeSemanal, calcularCapacidadeMaximaSemana, calcularObservacoesSetup, calcularHistoricoSemanas,
} from "@/features/capacidade/calculations";
import { uid } from "@/lib/id";
import ItensPrevistos, { type PrevItemFormState } from "@/features/previsao/components/ItensPrevistos";
import AjustarCapacidadeModal from "@/features/previsao/components/AjustarCapacidadeModal";
import { baixarProgramacaoSemanaPDF } from "@/features/previsao/pdf";
import type { Produto, PrevisaoItem } from "@/types/domain";

const emptyPrevItemForm: PrevItemFormState = { produtoId: "", quantidade: "", maquinasPorEtapa: {} };

export default function PrevisaoSemanalPage() {
  const router = useRouter();
  const [tema, setTema] = useState<"dark" | "light">("dark");
  const cores = THEMES[tema];
  const [modoPrivado, setModoPrivado] = useState(false);
  function toggleModoPrivado() {
    const next = !modoPrivado;
    setModoPrivadoAtivo(next);
    setModoPrivado(next);
  }
  const [gruposAbertos, setGruposAbertos] = useState({ gestao: true, financeiro: true, planejamento: true, producaoReal: true, administracao: true });
  function toggleGrupo(grupo: keyof typeof gruposAbertos) {
    setGruposAbertos((prev) => ({ ...prev, [grupo]: !prev[grupo] }));
  }

  const auth = useAuthSession();
  // periodos/diasUteis/diasUteisSemana são cadastro-base — vêm do Supabase,
  // mesma fonte usada em /produtos, /maquinas, /custo-hora, /capacidade.
  const cadastrosBase = useCadastrosBase(auth.autenticado);
  const { periodos, diasUteis, diasUteisSemana } = cadastrosBase;
  // Ordem exigida: auth -> cadastros-base -> funcionários -> máquinas -> produtos -> previsões -> custos.
  const funcionariosHook = useFuncionarios(auth.autenticado && !cadastrosBase.loading);
  const { funcionarios } = funcionariosHook;
  const maquinasHook = useMaquinas(auth.autenticado && !cadastrosBase.loading && !funcionariosHook.loading);
  const { maquinas } = maquinasHook;
  const produtosHook = useProdutos(auth.autenticado && !cadastrosBase.loading && !funcionariosHook.loading && !maquinasHook.loading);
  const { produtos } = produtosHook;
  const previsoesHook = usePrevisoes(
    auth.autenticado && !cadastrosBase.loading && !funcionariosHook.loading && !maquinasHook.loading && !produtosHook.loading
  );
  const { previsoes } = previsoesHook;
  const custosHook = useCustos(
    auth.autenticado && !cadastrosBase.loading && !funcionariosHook.loading && !maquinasHook.loading && !produtosHook.loading && !previsoesHook.loading
  );
  const { fixedCosts } = custosHook;

  // ---- derivações compartilhadas com o resto do app (mesmas fórmulas, ver Fase 1) ----
  const periodosComDuracao = useMemo(() => calcularPeriodosComDuracao(periodos), [periodos]);
  const periodosValidos = useMemo(() => filtrarPeriodosValidos(periodosComDuracao), [periodosComDuracao]);
  const horasPorDiaCalc = useMemo(() => calcularHorasPorDia(periodosValidos), [periodosValidos]);
  const duracaoMediaPeriodo = calcularDuracaoMediaPeriodo(periodosValidos, horasPorDiaCalc);
  const horasPorMaquinaSemana = calcularHorasPorMaquinaSemana(horasPorDiaCalc, toNumber(diasUteisSemana));

  const funcionariosAtivos = useMemo(() => funcionarios.filter((f) => f.ativo), [funcionarios]);
  const totalFixo = useMemo(() => calcularTotalFixoAtivo(fixedCosts), [fixedCosts]);
  const { custoHoraPorOperacao, custoHoraEmpresa } = useMemo(
    () => calcularCustoHoraEOperacoes(funcionarios, fixedCosts, horasPorDiaCalc, diasUteis),
    [funcionarios, fixedCosts, horasPorDiaCalc, diasUteis]
  );
  const getLucroHora = (produto: Produto) => calcularMargemProduto(produto, custoHoraPorOperacao, custoHoraEmpresa, periodosComDuracao).lucroHora;

  // ---- semana em foco ----
  const [semanaAtual, setSemanaAtual] = useState(() => toISODate(mondayOf(new Date())));
  const semanaAtualRec = useMemo(() => selecionarSemana(previsoes, semanaAtual), [previsoes, semanaAtual]);
  const resumoSemana = useMemo(() => calcularResumoSemana(semanaAtualRec), [semanaAtualRec]);
  const historicoSemanas = useMemo(() => calcularHistoricoSemanas(previsoes), [previsoes]);

  async function upsertSemana(campos: Partial<typeof semanaAtualRec>) {
    await previsoesHook.upsertSemana(semanaAtual, campos);
  }

  // ---- modo simulação ----
  const [modoSimulacao, setModoSimulacao] = useState(false);
  const [itensSimulados, setItensSimulados] = useState<PrevisaoItem[] | null>(null);
  const itensParaAnalise = modoSimulacao && itensSimulados ? itensSimulados : semanaAtualRec.itens;

  // ---- análise de capacidade (mesmas funções puras testadas no Checkpoint 1/1.5) ----
  const analiseCapacidadeSemana = useMemo(
    () => calcularAnaliseCapacidadeSemanal(itensParaAnalise, produtos, maquinas, periodosComDuracao, horasPorMaquinaSemana),
    [itensParaAnalise, produtos, maquinas, periodosComDuracao, horasPorMaquinaSemana]
  );
  const capacidadeMaximaSemana = useMemo(
    () => calcularCapacidadeMaximaSemana(itensParaAnalise, produtos, maquinas, periodosComDuracao, horasPorMaquinaSemana),
    [itensParaAnalise, produtos, maquinas, periodosComDuracao, horasPorMaquinaSemana]
  );
  const observacoesSetup = useMemo(
    () => calcularObservacoesSetup(analiseCapacidadeSemana, produtos, getLucroHora),
    [analiseCapacidadeSemana, produtos, custoHoraPorOperacao, custoHoraEmpresa, periodosComDuracao]
  );

  // ---- meta de faturamento ----
  const [margemDesejada, setMargemDesejada] = useState("20");
  const totalCustoFuncionariosAtivos = useMemo(
    () => calcularTotalCustoFuncionariosAtivos(funcionariosAtivos),
    [funcionariosAtivos]
  );
  const custoTotalMensalAtual = totalFixo + totalCustoFuncionariosAtivos;
  const { metaInvalida, faturamentoMensalNecessario, faturamentoSemanalNecessario, lucroMeta } = useMemo(
    () => calcularMetaFaturamento(custoTotalMensalAtual, toNumber(margemDesejada)),
    [custoTotalMensalAtual, margemDesejada]
  );
  const previstoSemanaHoje = resumoSemana.valorPrevisto; // usado pro card "Meta semanal" (semana em foco == semana de hoje na maior parte do uso)
  const metaSemanalUsaPrevisto = previstoSemanaHoje > 0;
  const metaSemanalFinal = metaSemanalUsaPrevisto ? previstoSemanaHoje : faturamentoSemanalNecessario;

  // ---- item previsto: formulário ----
  const [showPrevItemForm, setShowPrevItemForm] = useState(false);
  const [editingPrevItemId, setEditingPrevItemId] = useState<string | null>(null);
  const [prevItemForm, setPrevItemForm] = useState<PrevItemFormState>(emptyPrevItemForm);

  function resetPrevItemForm() {
    setPrevItemForm(emptyPrevItemForm);
    setEditingPrevItemId(null);
    setShowPrevItemForm(false);
  }
  function selecionarProdutoPrevItem(produtoId: string) {
    const produto = produtos.find((p) => p.id === produtoId);
    const sugestao: Record<string, string[]> = {};
    (produto?.roteiro || []).forEach((e) => { sugestao[e.id] = e.maquinasIds || []; });
    setPrevItemForm({ ...prevItemForm, produtoId, maquinasPorEtapa: sugestao });
  }
  function toggleMaquinaPrevItem(etapaId: string, maquinaId: string) {
    const atuais = prevItemForm.maquinasPorEtapa[etapaId] || [];
    const novas = atuais.includes(maquinaId) ? atuais.filter((id) => id !== maquinaId) : [...atuais, maquinaId];
    setPrevItemForm({ ...prevItemForm, maquinasPorEtapa: { ...prevItemForm.maquinasPorEtapa, [etapaId]: novas } });
  }
  async function submitPrevItem() {
    if (!prevItemForm.produtoId || !prevItemForm.quantidade) return;
    const produto = produtos.find((p) => p.id === prevItemForm.produtoId);
    if (!produto) return;
    const quantidadeNum = toNumber(prevItemForm.quantidade);
    const item: PrevisaoItem = {
      id: editingPrevItemId || uid(), produtoId: produto.id, produtoNome: produto.nome, valorUnitario: produto.valorUnitario,
      quantidade: quantidadeNum, maquinasPorEtapa: prevItemForm.maquinasPorEtapa,
    };
    const novosItens = editingPrevItemId
      ? semanaAtualRec.itens.map((it) => (it.id === editingPrevItemId ? item : it))
      : [...semanaAtualRec.itens, item];
    await upsertSemana({ itens: novosItens });
    resetPrevItemForm();
  }
  function editPrevItem(it: PrevisaoItem) {
    setPrevItemForm({ produtoId: it.produtoId, quantidade: String(it.quantidade), maquinasPorEtapa: it.maquinasPorEtapa || {} });
    setEditingPrevItemId(it.id);
    setShowPrevItemForm(true);
  }
  async function deletePrevItem(id: string) {
    await upsertSemana({ itens: semanaAtualRec.itens.filter((it) => it.id !== id) });
  }

  // ---- ajuste automático pra capacidade ----
  const [showAjustarModal, setShowAjustarModal] = useState(false);
  async function aplicarAjusteCapacidade() {
    const base = modoSimulacao && itensSimulados ? itensSimulados : semanaAtualRec.itens;
    const itensAjustados = base.map((it) => {
      const resultado = capacidadeMaximaSemana.resultadosPorItem.find((r) => r.itemId === it.id);
      if (!resultado) return it;
      return { ...it, quantidade: resultado.maximoPossivel };
    });
    if (modoSimulacao) setItensSimulados(itensAjustados);
    else await upsertSemana({ itens: itensAjustados });
    setShowAjustarModal(false);
  }

  if (auth.emModoRecovery) {
    return (
      <div className="stx-root">
        <GlobalStyles cores={cores} />
        <RecoveryPasswordScreen
          tema={tema}
          novaSenha={auth.novaSenhaRecovery}
          setNovaSenha={auth.setNovaSenhaRecovery}
          confirmarSenha={auth.confirmarSenhaRecovery}
          setConfirmarSenha={auth.setConfirmarSenhaRecovery}
          mensagem={auth.recoveryMsg}
          salvando={auth.recoverySalvando}
          sucesso={auth.recoverySucesso}
          onSubmit={auth.definirNovaSenhaRecovery}
          onContinuar={auth.concluirRecovery}
        />
      </div>
    );
  }

  if (cadastrosBase.loading || funcionariosHook.loading || maquinasHook.loading || produtosHook.loading || previsoesHook.loading || custosHook.loading || auth.restaurandoSessao || !auth.autenticado) {
    return (
      <div className="stx-root">
        <GlobalStyles cores={cores} />
        <LoginScreen
          loading={auth.restaurandoSessao || (auth.autenticado && (cadastrosBase.loading || funcionariosHook.loading || maquinasHook.loading || produtosHook.loading || previsoesHook.loading || custosHook.loading))}
          tema={tema}
          loginUsuario={auth.loginUsuario}
          setLoginUsuario={auth.setLoginUsuario}
          loginSenha={auth.loginSenha}
          setLoginSenha={auth.setLoginSenha}
          loginErro={auth.loginErro}
          loginCarregando={auth.loginCarregando}
          onSubmit={auth.handleLogin}
          campoLogin="email"
        />
      </div>
    );
  }

  if (!temPermissao(auth.usuarioLogado, "previsao")) {
    return (
      <div className="stx-root">
        <GlobalStyles cores={cores} />
        <div className="stx-layout">
          <Sidebar
            tema={tema}
            abaAtiva="previsao"
            onNavigateTab={() => { router.push("/"); }}
            gruposAbertos={gruposAbertos}
            toggleGrupo={toggleGrupo}
            usuarioLogado={auth.usuarioLogado}
            metaSemanalUsaPrevisto={metaSemanalUsaPrevisto}
            metaInvalida={metaInvalida}
            metaSemanalFinal={metaSemanalFinal}
            formatBRL={formatBRL}
            onMetaClick={() => { router.push("/"); }}
          />
          <AcessoNegado />
        </div>
      </div>
    );
  }

  return (
    <div className="stx-root">
      <GlobalStyles cores={cores} />
      <div className="stx-layout">
        <Sidebar
          tema={tema}
          abaAtiva="previsao"
          onNavigateTab={() => { router.push("/"); }}
          gruposAbertos={gruposAbertos}
          toggleGrupo={toggleGrupo}
          usuarioLogado={auth.usuarioLogado}
          metaSemanalUsaPrevisto={metaSemanalUsaPrevisto}
          metaInvalida={metaInvalida}
          metaSemanalFinal={metaSemanalFinal}
          formatBRL={formatBRL}
          onMetaClick={() => { router.push("/"); }}
        />

        <div className="stx-content-wrapper">
          {cadastrosBase.erro && <p className="stx-save-error">{cadastrosBase.erro}</p>}
          {funcionariosHook.erro && <p className="stx-save-error">{funcionariosHook.erro}</p>}
          {maquinasHook.erro && <p className="stx-save-error">{maquinasHook.erro}</p>}
          {produtosHook.erro && <p className="stx-save-error">{produtosHook.erro}</p>}
          {previsoesHook.erro && <p className="stx-save-error">{previsoesHook.erro}</p>}
          {custosHook.erro && <p className="stx-save-error">{custosHook.erro}</p>}
          <div className="stx-header">
            <div>
              <h1 className="stx-title">Previsão semanal</h1>
            </div>
            <div className="stx-header-right">
              <TopBarActions
                modoPrivado={modoPrivado}
                onToggleModoPrivado={toggleModoPrivado}
                tema={tema}
                onToggleTema={() => setTema((t) => (t === "dark" ? "light" : "dark"))}
                onAbrirMinhaConta={auth.abrirMinhaConta}
                onSair={() => auth.handleLogout()}
              />
              <div className="stx-total-box">
                <p className="stx-total-label">Previsão da semana</p>
                <p className="stx-total-value">{formatBRL(resumoSemana.valorPrevisto)}</p>
                <p className="stx-total-split">realizado {formatBRL(resumoSemana.valorRealizado)} · {resumoSemana.percentualConcluido.toFixed(1)}%</p>
              </div>
            </div>
          </div>

          <div>
            <div className="stx-month-nav" style={{ marginBottom: 18, justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
                <button className="stx-nav-btn" onClick={() => setSemanaAtual(shiftWeek(semanaAtual, -1))}>‹</button>
                <span className="stx-month-label" style={{ minWidth: 220 }}>{weekLabel(semanaAtual)}</span>
                <button className="stx-nav-btn" onClick={() => setSemanaAtual(shiftWeek(semanaAtual, 1))}>›</button>
              </div>
              {semanaAtualRec.itens.length > 0 && (
                <div style={{ textAlign: "right", display: "flex", gap: 8, alignItems: "flex-start" }}>
                  {!modoSimulacao ? (
                    <button className="stx-btn-secondary" onClick={() => { setItensSimulados(semanaAtualRec.itens.map((it) => ({ ...it }))); setModoSimulacao(true); }}>🧪 Modo simulação</button>
                  ) : (
                    <>
                      <button className="stx-btn-secondary" onClick={() => { setModoSimulacao(false); setItensSimulados(null); }}>Sair sem aplicar</button>
                      <button className="stx-btn-primary" onClick={async () => { await upsertSemana({ itens: itensSimulados! }); setModoSimulacao(false); setItensSimulados(null); }}>Aplicar simulação</button>
                    </>
                  )}
                  <div>
                    <button className="stx-btn-secondary" onClick={() => baixarProgramacaoSemanaPDF({
                      semanaAtual, semanaAtualRec, produtos, maquinas, periodosComDuracao, horasPorMaquinaSemana,
                      duracaoMediaPeriodo, diasUteisSemana, funcionariosAtivos, getLucroHora,
                    })}>GERAR PDF</button>
                    <p className="stx-panel-sub" style={{ margin: "4px 0 0 0", fontSize: 11 }}>Baixa um arquivo — abre ele e usa Cmd+P (ou Ctrl+P) → Salvar como PDF</p>
                  </div>
                </div>
              )}
            </div>

            {modoSimulacao && (
              <div className="stx-simulacao-faixa">
                <p className="stx-simulacao-titulo">🧪 MODO SIMULAÇÃO — nada aqui está salvo ainda</p>
                <p className="stx-simulacao-sub">Muda as quantidades abaixo pra testar cenários. Os painéis de capacidade recalculam na hora. Só grava de verdade se você clicar &quot;Aplicar simulação&quot;.</p>
                {itensSimulados && itensSimulados.length > 0 && (
                  <div className="stx-simulacao-lista">
                    {itensSimulados.map((it) => (
                      <div className="stx-simulacao-item" key={it.id}>
                        <span className="stx-simulacao-item-nome">{it.produtoNome}</span>
                        <input
                          className="stx-input stx-simulacao-input"
                          type="number"
                          value={it.quantidade}
                          onChange={(e) => setItensSimulados((prev) => prev!.map((x) => (x.id === it.id ? { ...x, quantidade: toNumber(e.target.value) } : x)))}
                        />
                        <span className="stx-simulacao-item-valor">{formatBRL(it.quantidade * it.valorUnitario)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {semanaAtualRec.itens.length > 0 && capacidadeMaximaSemana.temDados && (
              <div className={`stx-panel stx-analise-capacidade ${capacidadeMaximaSemana.temGargalo ? "alerta" : "ok"}`}>
                <div className="stx-analise-resumo">
                  <span className={`stx-analise-icone ${capacidadeMaximaSemana.temGargalo ? "alerta" : "ok"}`}>
                    {capacidadeMaximaSemana.temGargalo ? <AlertTriangle size={22} /> : <CheckCircle2 size={22} />}
                  </span>
                  <div>
                    <p className="stx-analise-titulo">
                      {capacidadeMaximaSemana.temGargalo ? "A previsão excede a capacidade atual" : "A previsão está dentro da capacidade"}
                      {modoSimulacao && <span className="stx-simulacao-tag">simulado</span>}
                    </p>
                    <p className="stx-analise-sub">Capacidade da semana — comparando o que foi planejado com o que a fábrica consegue entregar de verdade.</p>
                  </div>
                </div>

                <div className="stx-capacidade-reais-grid">
                  <div>
                    <p className="stx-capacidade-reais-label">Previsto</p>
                    <p className="stx-capacidade-reais-valor">{formatBRL(capacidadeMaximaSemana.previstoTotalReais)}</p>
                  </div>
                  <div>
                    <p className="stx-capacidade-reais-label">{capacidadeMaximaSemana.temGargalo ? "Máximo estimado" : "Capacidade estimada"}</p>
                    <p className="stx-capacidade-reais-valor">{formatBRL(capacidadeMaximaSemana.capacidadeEstimadaReais)}</p>
                  </div>
                  <div>
                    <p className="stx-capacidade-reais-label">{capacidadeMaximaSemana.temGargalo ? "Atingível" : "Uso da capacidade"}</p>
                    <p className="stx-capacidade-reais-valor" style={{ color: capacidadeMaximaSemana.temGargalo ? "var(--danger)" : "var(--accent)" }}>
                      {capacidadeMaximaSemana.temGargalo
                        ? `${((capacidadeMaximaSemana.capacidadeEstimadaReais / capacidadeMaximaSemana.previstoTotalReais) * 100).toFixed(1)}%`
                        : `${((capacidadeMaximaSemana.previstoTotalReais / capacidadeMaximaSemana.capacidadeEstimadaReais) * 100).toFixed(1)}%`}
                    </p>
                  </div>
                  <div>
                    <p className="stx-capacidade-reais-label">{capacidadeMaximaSemana.temGargalo ? "Excesso planejado" : "Folga estimada"}</p>
                    <p className="stx-capacidade-reais-valor" style={{ color: capacidadeMaximaSemana.temGargalo ? "var(--danger)" : "var(--accent)" }}>
                      {formatBRL(Math.abs(capacidadeMaximaSemana.capacidadeEstimadaReais - capacidadeMaximaSemana.previstoTotalReais))}
                    </p>
                  </div>
                </div>

                {capacidadeMaximaSemana.maquinaLimitante && (
                  <p className="stx-analise-sub" style={{ marginTop: 10 }}>
                    Máquina {capacidadeMaximaSemana.temGargalo ? "limitante" : "mais carregada"}: <b>{capacidadeMaximaSemana.maquinaLimitante.nome} — {capacidadeMaximaSemana.maquinaLimitante.pct.toFixed(0)}%</b>
                  </p>
                )}

                {capacidadeMaximaSemana.resultadosPorItem.some((r) => r.maximoPossivel !== r.previsto) && (
                  <div className="stx-analise-lista">
                    <p className="stx-analise-secao-titulo">Produção possível por produto</p>
                    <div className="stx-tabela-producao-header">
                      <span>Produto</span><span>Previsto</span><span>Possível</span><span>Diferença</span>
                    </div>
                    {capacidadeMaximaSemana.resultadosPorItem.map((r) => {
                      const diferenca = r.maximoPossivel - r.previsto;
                      return (
                        <div className="stx-tabela-producao-linha" key={r.itemId}>
                          <span>{r.produtoNome}</span>
                          <span>{r.previsto}</span>
                          <span>{r.maximoPossivel}</span>
                          <span style={{ color: diferenca < 0 ? "var(--danger)" : "var(--text-muted)" }}>
                            {diferenca === 0 ? "0" : diferenca > 0 ? `+${diferenca}` : diferenca}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {capacidadeMaximaSemana.temGargalo && (
                  <div className="stx-ajustar-box">
                    <div>
                      <p className="stx-ajustar-titulo">Sugestão para tornar a previsão atingível</p>
                      <p className="stx-analise-sub">
                        Reduz cada produto na mesma proporção da carga que ele representa nas máquinas sobrecarregadas, até caber na capacidade da semana.
                      </p>
                    </div>
                    <button className="stx-btn-primary" onClick={() => setShowAjustarModal(true)}>AJUSTAR PARA CAPACIDADE</button>
                  </div>
                )}
              </div>
            )}

            {semanaAtualRec.itens.length > 0 && (
              <div className={`stx-panel stx-analise-capacidade ${analiseCapacidadeSemana.atingivel ? "ok" : "alerta"}`}>
                <div className="stx-analise-resumo">
                  <span className={`stx-analise-icone ${analiseCapacidadeSemana.atingivel ? "ok" : "alerta"}`}>
                    {analiseCapacidadeSemana.atingivel ? <CheckCircle2 size={22} /> : <AlertTriangle size={22} />}
                  </span>
                  <div>
                    <p className="stx-analise-titulo">
                      {analiseCapacidadeSemana.atingivel ? "Previsão atingível" : "Previsão não atingível"}
                      {modoSimulacao && <span className="stx-simulacao-tag">simulado</span>}
                    </p>
                    <p className="stx-analise-sub">
                      {analiseCapacidadeSemana.atingivel
                        ? (analiseCapacidadeSemana.maquinaMaisCarregada
                            ? `Todas as máquinas têm capacidade suficiente. Máquina mais carregada: ${analiseCapacidadeSemana.maquinaMaisCarregada.nome} — ${analiseCapacidadeSemana.maquinaMaisCarregada.pct.toFixed(0)}%.`
                            : "Marca as máquinas de cada item pra essa análise aparecer.")
                        : `A produção planejada excede a capacidade de ${analiseCapacidadeSemana.gargalos.length} máquina${analiseCapacidadeSemana.gargalos.length > 1 ? "s" : ""}. Principal gargalo: ${analiseCapacidadeSemana.gargalos[0]?.nome} — ${analiseCapacidadeSemana.gargalos[0]?.pct.toFixed(0)}%, faltam ${analiseCapacidadeSemana.gargalos[0]?.deficit.toFixed(1)}h.`}
                    </p>
                  </div>
                </div>

                {analiseCapacidadeSemana.maquinas.length > 0 && (
                  <div className="stx-analise-lista">
                    <p className="stx-analise-secao-titulo">Uso por máquina, da maior pra menor</p>
                    {analiseCapacidadeSemana.maquinas.map((m) => (
                      <div className="stx-analise-maquina-linha" key={m.maquinaId}>
                        <div className="stx-analise-maquina-topo">
                          <span className="stx-analise-maquina-nome">{m.nome}</span>
                          <span className={`stx-analise-pct stx-status-${m.status}`}>{m.pct.toFixed(1)}%</span>
                        </div>
                        <div className="stx-analise-barra-bg">
                          <div className={`stx-analise-barra-fill stx-status-${m.status}`} style={{ width: `${Math.min(100, m.pct)}%` }} />
                        </div>
                        <p className="stx-analise-maquina-detalhe">
                          {m.horasNecessarias.toFixed(1)}h necessárias / {m.horasDisponiveis.toFixed(1)}h disponíveis
                          {m.deficit > 0 && ` · excesso: ${m.deficit.toFixed(1)}h`}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                {analiseCapacidadeSemana.gargalos.length > 0 && (
                  <div className="stx-analise-gargalos">
                    <p className="stx-analise-secao-titulo">Gargalos da semana</p>
                    {analiseCapacidadeSemana.gargalos.map((m) => (
                      <div className="stx-analise-gargalo-card" key={m.maquinaId}>
                        <p className="stx-analise-gargalo-nome">🔴 {m.nome} — {m.pct.toFixed(0)}%</p>
                        <p className="stx-analise-gargalo-detalhe">
                          Necessário: {m.horasNecessarias.toFixed(1)}h &nbsp;·&nbsp; Disponível: {m.horasDisponiveis.toFixed(1)}h &nbsp;·&nbsp; Déficit: {m.deficit.toFixed(1)}h
                        </p>
                        <p className="stx-analise-gargalo-produtos-titulo">Produtos consumindo essa máquina:</p>
                        {m.produtosConsumidores.map((p) => (
                          <p className="stx-analise-gargalo-produto" key={p.produtoId}>{p.nome} → {p.horas.toFixed(1)}h</p>
                        ))}
                      </div>
                    ))}
                  </div>
                )}

                {observacoesSetup.length > 0 && (
                  <div className="stx-analise-lista">
                    <p className="stx-analise-secao-titulo">Observações</p>
                    {observacoesSetup.map((obs) => (
                      <div className="stx-observacao-card" key={obs.maquinaId}>
                        <p className="stx-observacao-texto">
                          💡 <b>{obs.nome}</b> está sendo dividida entre {obs.ordenados.map((p) => p.nome).join(" e ")}.
                          {" "}Pra reduzir trocas de setup, sugiro rodar o lote inteiro de <b>{obs.ordenados[0].nome}</b> primeiro
                          {obs.ordenados[0].lucroHora > -Infinity && ` (maior lucro/hora)`}, depois {obs.ordenados.slice(1).map((p) => p.nome).join(", depois ")} — em vez de intercalar entre eles.
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="stx-panel">
              <div className="stx-panel-title-row">
                <p className="stx-panel-title">Meta de faturamento</p>
              </div>
              <p className="stx-panel-sub">
                Com os custos fixos e de funcionários de hoje ({formatBRL(custoTotalMensalAtual)}/mês) e 9% de imposto, quanto precisa faturar pra bater a margem desejada.
              </p>
              <div style={{ maxWidth: 220, marginBottom: 14 }}>
                <label className="stx-label">Margem de lucro líquido desejada (%)</label>
                <input className="stx-input" value={margemDesejada} onChange={(e) => setMargemDesejada(e.target.value)} placeholder="20" inputMode="decimal" />
              </div>
              {metaInvalida ? (
                <p className="stx-import-resultado" style={{ color: "var(--danger)" }}>
                  Essa margem + os 9% de imposto passam de 100% do faturamento — não tem valor que feche essa conta. Tenta uma margem menor.
                </p>
              ) : (
                <div className="stx-destaque-grid">
                  <div className="stx-destaque-box">
                    <p className="stx-destaque-label">Faturamento mensal necessário</p>
                    <p className="stx-destaque-value">{formatBRL(faturamentoMensalNecessario)}</p>
                    <p className="stx-destaque-sub">lucro líquido de {formatBRL(lucroMeta)} ({margemDesejada}%)</p>
                  </div>
                  <div className="stx-destaque-box">
                    <p className="stx-destaque-label">Meta semanal</p>
                    <p className="stx-destaque-value">{formatBRL(faturamentoSemanalNecessario)}</p>
                    <p className="stx-destaque-sub">considerando 4,33 semanas/mês</p>
                  </div>
                </div>
              )}
            </div>

            <div className="stx-grid">
              <div>
                <ItensPrevistos
                  loading={previsoesHook.loading}
                  produtos={produtos}
                  maquinas={maquinas}
                  periodosComDuracao={periodosComDuracao}
                  horasPorMaquinaSemana={horasPorMaquinaSemana}
                  semana={semanaAtualRec}
                  showForm={showPrevItemForm}
                  setShowForm={setShowPrevItemForm}
                  editingId={editingPrevItemId}
                  form={prevItemForm}
                  onSelecionarProduto={selecionarProdutoPrevItem}
                  onQuantidadeChange={(v) => setPrevItemForm({ ...prevItemForm, quantidade: v })}
                  onToggleMaquina={toggleMaquinaPrevItem}
                  onSubmit={submitPrevItem}
                  onCancelar={resetPrevItemForm}
                  onEditar={editPrevItem}
                  onExcluir={deletePrevItem}
                  analise={analiseCapacidadeSemana}
                  valorPrevistoSemana={resumoSemana.valorPrevisto}
                  funcionariosAtivosCount={funcionariosAtivos.length}
                  formatBRL={formatBRL}
                />

                <ItensRealizados
                  loading={previsoesHook.loading}
                  produtos={produtos}
                  semana={semanaAtualRec}
                  upsertSemana={upsertSemana}
                  valorRealizadoSemana={resumoSemana.valorRealizado}
                  formatBRL={formatBRL}
                />
              </div>

              <div>
                <div className="stx-panel">
                  <p className="stx-panel-title" style={{ marginBottom: 14 }}>Resultado da semana</p>
                  <div className="stx-rateio-line">
                    <span className="l">Previsto</span>
                    <span className="v">{formatBRL(resumoSemana.valorPrevisto)}</span>
                  </div>
                  <div className="stx-rateio-line">
                    <span className="l">Realizado</span>
                    <span className="v">{formatBRL(resumoSemana.valorRealizado)}</span>
                  </div>
                  <div className="stx-rateio-line">
                    <span className="l">Diferença</span>
                    <span className="v" style={resumoSemana.diferenca < 0 ? { color: "var(--danger)" } : { color: "var(--blueprint)" }}>
                      {resumoSemana.diferenca >= 0 ? "+" : ""}{formatBRL(resumoSemana.diferenca)}
                    </span>
                  </div>
                  <div className="stx-destaque-box" style={{ marginTop: 12 }}>
                    <p className="stx-destaque-label">Concluído da previsão</p>
                    <p className="stx-destaque-value">{resumoSemana.percentualConcluido.toFixed(1)}%</p>
                    <p className="stx-destaque-sub">{formatBRL(resumoSemana.valorRealizado)} de {formatBRL(resumoSemana.valorPrevisto)} previstos</p>
                  </div>
                </div>

                <div className="stx-panel">
                  <p className="stx-panel-title" style={{ marginBottom: 14 }}>Histórico semanal</p>
                  {historicoSemanas.length === 0 ? (
                    <div className="stx-empty">Nenhuma semana lançada ainda.</div>
                  ) : (
                    <div className="stx-hist-table">
                      <div className="stx-hist-row stx-hist-head">
                        <span>Semana</span><span>Previsto</span><span>Realizado</span><span>%</span>
                      </div>
                      {historicoSemanas.map((h) => (
                        <div className="stx-hist-row" key={h.semanaInicio} onClick={() => setSemanaAtual(h.semanaInicio)} style={{ gridTemplateColumns: "1.4fr 1fr 1fr 0.7fr" }}>
                          <span>{weekLabel(h.semanaInicio).replace("Semana de ", "")}</span>
                          <span>{formatBRL(h.previsto)}</span>
                          <span>{formatBRL(h.realizado)}</span>
                          <span className={h.pct >= 100 ? "positivo" : h.pct >= 70 ? "" : "negativo"}>{h.pct.toFixed(0)}%</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <AjustarCapacidadeModal
            aberto={showAjustarModal}
            onFechar={() => setShowAjustarModal(false)}
            onAplicar={aplicarAjusteCapacidade}
            capacidadeMaximaSemana={capacidadeMaximaSemana}
            formatBRL={formatBRL}
          />
        </div>
      </div>

      <AccountModal
        usuarioLogado={auth.usuarioLogado}
        aberta={auth.minhaContaAberta}
        onFechar={() => auth.setMinhaContaAberta(false)}
        minhaSenhaAtual={auth.minhaSenhaAtual}
        setMinhaSenhaAtual={auth.setMinhaSenhaAtual}
        minhaSenhaNova={auth.minhaSenhaNova}
        setMinhaSenhaNova={auth.setMinhaSenhaNova}
        minhaSenhaConfirma={auth.minhaSenhaConfirma}
        setMinhaSenhaConfirma={auth.setMinhaSenhaConfirma}
        minhaContaMsg={auth.minhaContaMsg}
        onSalvar={auth.alterarMinhaSenha}
      />
    </div>
  );
}

// ---- "Itens realizados" — pequeno o bastante pra ficar junto do orquestrador ----
function ItensRealizados({
  loading, produtos, semana, upsertSemana, valorRealizadoSemana, formatBRL,
}: {
  loading: boolean;
  produtos: Produto[];
  semana: ReturnType<typeof selecionarSemana>;
  upsertSemana: (campos: Partial<ReturnType<typeof selecionarSemana>>) => Promise<void>;
  valorRealizadoSemana: number;
  formatBRL: (v: number) => string;
}) {
  const emptyForm = { produtoId: "", quantidade: "" };
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  function reset() {
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(false);
  }
  async function submit() {
    if (!form.produtoId || !form.quantidade) return;
    const produto = produtos.find((p) => p.id === form.produtoId);
    if (!produto) return;
    const item = { id: editingId || uid(), produtoId: produto.id, produtoNome: produto.nome, valorUnitario: produto.valorUnitario, quantidade: toNumber(form.quantidade) };
    const itensAtuais = semana.itensRealizados || [];
    const novosItens = editingId ? itensAtuais.map((it) => (it.id === editingId ? item : it)) : [...itensAtuais, item];
    await upsertSemana({ itensRealizados: novosItens });
    reset();
  }

  return (
    <div className="stx-panel">
      <div className="stx-panel-title-row">
        <p className="stx-panel-title">Itens realizados</p>
      </div>
      <p className="stx-panel-sub">Produto e quantidade que a supervisora realmente faturou nessa semana.</p>

      {produtos.filter((p) => p.ativo).length === 0 ? (
        <p className="stx-panel-sub">Cadastre produtos na aba &quot;Produtos&quot; antes de lançar itens aqui.</p>
      ) : (
        <>
          {!showForm && <button className="stx-add-btn" onClick={() => setShowForm(true)}>+ Novo item</button>}
          {showForm && (
            <div className="stx-form">
              <div className="stx-form-full">
                <label className="stx-label">Produto</label>
                <select className="stx-select" value={form.produtoId} onChange={(e) => setForm({ ...form, produtoId: e.target.value })}>
                  <option value="">Selecione um produto…</option>
                  {produtos.filter((p) => p.ativo).map((p) => (
                    <option key={p.id} value={p.id}>{p.nome} ({formatBRL(p.valorUnitario)})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="stx-label">Quantidade</label>
                <input
                  className="stx-input"
                  value={form.quantidade}
                  onChange={(e) => setForm({ ...form, quantidade: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                  placeholder="Ex: 10"
                  inputMode="decimal"
                  autoFocus
                />
              </div>
              <div className="stx-form-actions">
                <button type="button" className="stx-btn-primary" onClick={submit}>{editingId ? "Salvar alterações" : "Adicionar item"}</button>
                <button type="button" className="stx-btn-secondary" onClick={reset}>Cancelar</button>
              </div>
            </div>
          )}
        </>
      )}

      {loading ? (
        <div className="stx-empty">Carregando…</div>
      ) : (semana.itensRealizados || []).length === 0 ? (
        <div className="stx-empty">Nenhum item realizado lançado nessa semana ainda.</div>
      ) : (
        semana.itensRealizados.map((it) => (
          <div className="stx-entry" key={it.id}>
            <div>
              <p className="stx-entry-desc">{it.produtoNome}</p>
              <p className="stx-entry-meta">{it.quantidade} × {formatBRL(it.valorUnitario)}</p>
            </div>
            <div className="stx-entry-right">
              <span className="stx-entry-value">{formatBRL(it.quantidade * it.valorUnitario)}</span>
              <button className="stx-icon-btn" title="Editar" onClick={() => { setForm({ produtoId: it.produtoId, quantidade: String(it.quantidade) }); setEditingId(it.id); setShowForm(true); }}>✎</button>
              <button className="stx-icon-btn danger" title="Excluir" onClick={() => upsertSemana({ itensRealizados: (semana.itensRealizados || []).filter((x) => x.id !== it.id) })}>✕</button>
            </div>
          </div>
        ))
      )}
      <p className="stx-custos-total" style={{ marginTop: 10 }}>Realizado da semana: <b>{formatBRL(valorRealizadoSemana)}</b></p>
    </div>
  );
}
