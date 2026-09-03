"use client";

// Paradas V1 — "onde e por que perdemos tempo/capacidade" (distinto de
// Produtividade/Economia, que respondem "quanto produzimos"). Reaproveita
// integralmente obter_indicadores_producao/obter_paradas_producao e o
// motor de src/features/producao-real/paradas/calculations.ts — nenhuma
// fórmula oficial (Performance, custo/hora, meta) é recalculada aqui.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useAuthSession } from "@/hooks/useAuthSession";
import { useCadastrosBase } from "@/hooks/useCadastrosBase";
import { useFuncionarios } from "@/hooks/useFuncionarios";
import { useFuncionariosElegibilidade } from "@/hooks/useFuncionariosElegibilidade";
import { useMaquinas } from "@/hooks/useMaquinas";
import { useProdutos } from "@/hooks/useProdutos";
import { useOperacoesComId } from "@/hooks/useOperacoesComId";
import { usePrevisoes } from "@/hooks/usePrevisoes";
import { useCustos } from "@/hooks/useCustos";
import { useParadasProducao } from "@/hooks/useParadasProducao";
import { useGruposAbertosSidebar } from "@/hooks/useGruposAbertosSidebar";
import { calcularResumoParadas, type OrigemParada } from "@/features/producao-real/paradas/calculations";
import ResumoParadasCards from "@/features/producao-real/paradas/components/ResumoParadasCards";
import ParetoParadasSeletor from "@/features/producao-real/paradas/components/ParetoParadasSeletor";
import EvolucaoTendenciaParadas from "@/features/producao-real/paradas/components/EvolucaoTendenciaParadas";
import RecorrenciaParadas from "@/features/producao-real/paradas/components/RecorrenciaParadas";
import AnaliseParadasPorRecurso from "@/features/producao-real/paradas/components/AnaliseParadasPorRecurso";
import SemProducaoResumoView from "@/features/producao-real/paradas/components/SemProducaoResumoView";
import DrillDownParadasLista from "@/features/producao-real/paradas/components/DrillDownParadasLista";
import LoginScreen from "@/components/shell/LoginScreen";
import RecoveryPasswordScreen from "@/components/shell/RecoveryPasswordScreen";
import Sidebar from "@/components/shell/Sidebar";
import TopBarActions from "@/components/shell/TopBarActions";
import AccountModal from "@/components/shell/AccountModal";
import AcessoNegado from "@/components/shell/AcessoNegado";
import GlobalStyles from "@/components/shell/GlobalStyles";
import { THEMES } from "@/lib/constants";
import { temPermissao } from "@/lib/permissoes";
import { formatBRL, setModoPrivadoAtivo } from "@/lib/format";
import { toISODate, mondayOf } from "@/lib/date";
import { calcularTotalFixoAtivo, calcularTotalCustoFuncionariosAtivos, calcularMetaFaturamento } from "@/features/custo-hora/calculations";
import { selecionarSemana, calcularResumoSemana } from "@/features/capacidade/selectors";

const VISOES = [
  { key: "resumo", label: "Resumo" },
  { key: "pareto", label: "Pareto" },
  { key: "evolucao", label: "Evolução e tendência" },
  { key: "recorrencia", label: "Recorrência" },
  { key: "recurso", label: "Por máquina/operação/produto" },
  { key: "semProducao", label: "Sem produção" },
  { key: "detalhado", label: "Detalhado" },
] as const;
type VisaoKey = (typeof VISOES)[number]["key"];

// 13 dias atrás por padrão — já cobre as duas janelas de 7 dias que a
// tendência compara (últimos 7 vs 7 anteriores) sem exigir que o usuário
// amplie o filtro na primeira visita.
function dataAtrasDias(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return toISODate(d);
}

export default function ParadasPage() {
  const router = useRouter();
  const [tema, setTema] = useState<"dark" | "light">("dark");
  const cores = THEMES[tema];
  const [modoPrivado, setModoPrivado] = useState(false);
  function toggleModoPrivado() {
    const next = !modoPrivado;
    setModoPrivadoAtivo(next);
    setModoPrivado(next);
  }
  const { gruposAbertos, toggleGrupo } = useGruposAbertosSidebar("prParadas");

  const auth = useAuthSession();
  const cadastrosBase = useCadastrosBase(auth.autenticado);
  const funcionariosHook = useFuncionarios(auth.autenticado && !cadastrosBase.loading);
  const { funcionarios } = funcionariosHook;
  const funcionariosElegibilidadeHook = useFuncionariosElegibilidade(auth.autenticado && !cadastrosBase.loading);
  const maquinasHook = useMaquinas(auth.autenticado && !cadastrosBase.loading && !funcionariosHook.loading);
  const produtosHook = useProdutos(auth.autenticado && !cadastrosBase.loading && !funcionariosHook.loading && !maquinasHook.loading);
  const operacoesHook = useOperacoesComId(auth.autenticado && !cadastrosBase.loading);
  const previsoesHook = usePrevisoes(
    auth.autenticado && !cadastrosBase.loading && !funcionariosHook.loading && !maquinasHook.loading && !produtosHook.loading
  );
  const { previsoes } = previsoesHook;
  const custosHook = useCustos(
    auth.autenticado && !cadastrosBase.loading && !funcionariosHook.loading && !maquinasHook.loading && !produtosHook.loading && !previsoesHook.loading
  );
  const { fixedCosts } = custosHook;

  const paradasHook = useParadasProducao();

  // ---- card "Meta semanal" da sidebar — mesma fórmula usada em todas as rotas ----
  const funcionariosAtivos = useMemo(() => funcionarios.filter((f) => f.ativo), [funcionarios]);
  const totalFixo = useMemo(() => calcularTotalFixoAtivo(fixedCosts), [fixedCosts]);
  const totalCustoFuncionariosAtivos = useMemo(
    () => calcularTotalCustoFuncionariosAtivos(funcionariosAtivos),
    [funcionariosAtivos]
  );
  const [semanaAtual] = useState(() => toISODate(mondayOf(new Date())));
  const semanaAtualRec = useMemo(() => selecionarSemana(previsoes, semanaAtual), [previsoes, semanaAtual]);
  const resumoSemana = useMemo(() => calcularResumoSemana(semanaAtualRec), [semanaAtualRec]);
  const custoTotalMensalAtual = totalFixo + totalCustoFuncionariosAtivos;
  const { metaInvalida, faturamentoSemanalNecessario } = useMemo(
    () => calcularMetaFaturamento(custoTotalMensalAtual, 20),
    [custoTotalMensalAtual]
  );
  const metaSemanalUsaPrevisto = resumoSemana.valorPrevisto > 0;
  const metaSemanalFinal = metaSemanalUsaPrevisto ? resumoSemana.valorPrevisto : faturamentoSemanalNecessario;

  // ---- filtros — mesmo padrão de Indicadores V1, + origem (client-side) ----
  const FILTROS_INICIAIS = useMemo(() => ({ dataInicial: dataAtrasDias(13), dataFinal: toISODate(new Date()) }), []);
  const [filtrosAbertos, setFiltrosAbertos] = useState(true);
  const [filtrosForm, setFiltrosForm] = useState(FILTROS_INICIAIS as {
    dataInicial: string; dataFinal: string; produtoId?: string; maquinaId?: string; operacaoId?: string; funcionarioId?: string; periodoId?: string;
  });
  const [filtrosAplicados, setFiltrosAplicados] = useState(FILTROS_INICIAIS);
  const [origemFiltro, setOrigemFiltro] = useState<OrigemParada | "">("");
  const [jaBuscouUmaVez, setJaBuscouUmaVez] = useState(false);

  function aplicarFiltros() {
    setFiltrosAplicados(filtrosForm);
    paradasHook.buscar(filtrosForm);
    setJaBuscouUmaVez(true);
  }
  function limparFiltros() {
    setFiltrosForm(FILTROS_INICIAIS);
    setFiltrosAplicados(FILTROS_INICIAIS);
    setOrigemFiltro("");
    paradasHook.buscar(FILTROS_INICIAIS);
    setJaBuscouUmaVez(true);
  }

  const carregandoCadastros =
    cadastrosBase.loading || funcionariosHook.loading || funcionariosElegibilidadeHook.loading || maquinasHook.loading ||
    produtosHook.loading || operacoesHook.loading || previsoesHook.loading || custosHook.loading;

  const podeVerParadas = auth.autenticado && !carregandoCadastros && temPermissao(auth.usuarioLogado, "producao_real_historico");

  useEffect(() => {
    if (!podeVerParadas || jaBuscouUmaVez) return;
    setJaBuscouUmaVez(true);
    paradasHook.buscar(filtrosAplicados);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [podeVerParadas, jaBuscouUmaVez]);

  const [visao, setVisao] = useState<VisaoKey>("resumo");

  // Filtro de origem é client-side (não muda a RPC) — aplica sobre o que
  // já foi buscado, sem nova chamada ao banco.
  const paradasFiltradas = useMemo(
    () => (origemFiltro ? paradasHook.paradas.filter((p) => p.origem === origemFiltro) : paradasHook.paradas),
    [paradasHook.paradas, origemFiltro]
  );

  const resumo = useMemo(
    () => calcularResumoParadas(paradasFiltradas, paradasHook.apontamentos),
    [paradasFiltradas, paradasHook.apontamentos]
  );

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

  if (carregandoCadastros || auth.restaurandoSessao || !auth.autenticado) {
    return (
      <div className="stx-root">
        <GlobalStyles cores={cores} />
        <LoginScreen
          loading={auth.restaurandoSessao || (auth.autenticado && carregandoCadastros)}
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

  if (!temPermissao(auth.usuarioLogado, "producao_real_historico")) {
    return (
      <div className="stx-root">
        <GlobalStyles cores={cores} />
        <div className="stx-layout">
          <Sidebar
            tema={tema}
            abaAtiva="prParadas"
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
          abaAtiva="prParadas"
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
          <div className="stx-header">
            <div>
              <h1 className="stx-title">Paradas</h1>
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
            </div>
          </div>

          <button type="button" className="stx-pr-filtros-toggle" onClick={() => setFiltrosAbertos((v) => !v)}>
            {filtrosAbertos ? <ChevronDown size={15} /> : <ChevronRight size={15} />} Filtros
          </button>

          {filtrosAbertos && (
            <div className="stx-panel stx-pr-filtros-painel">
              <div className="stx-pr-filtros-grid">
                <div>
                  <label className="stx-label">Data inicial</label>
                  <input type="date" className="stx-input" value={filtrosForm.dataInicial} onChange={(e) => setFiltrosForm((f) => ({ ...f, dataInicial: e.target.value }))} />
                </div>
                <div>
                  <label className="stx-label">Data final</label>
                  <input type="date" className="stx-input" value={filtrosForm.dataFinal} onChange={(e) => setFiltrosForm((f) => ({ ...f, dataFinal: e.target.value }))} />
                </div>
                <div>
                  <label className="stx-label">Período</label>
                  <select className="stx-select" value={filtrosForm.periodoId || ""} onChange={(e) => setFiltrosForm((f) => ({ ...f, periodoId: e.target.value || undefined }))}>
                    <option value="">Todos</option>
                    {cadastrosBase.periodos.map((p) => (
                      <option key={p.id} value={p.id}>{p.nome}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="stx-label">Máquina</label>
                  <select className="stx-select" value={filtrosForm.maquinaId || ""} onChange={(e) => setFiltrosForm((f) => ({ ...f, maquinaId: e.target.value || undefined }))}>
                    <option value="">Todas</option>
                    {maquinasHook.maquinas.map((m) => (
                      <option key={m.id} value={m.id}>{m.nome}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="stx-label">Produto</label>
                  <select className="stx-select" value={filtrosForm.produtoId || ""} onChange={(e) => setFiltrosForm((f) => ({ ...f, produtoId: e.target.value || undefined }))}>
                    <option value="">Todos</option>
                    {produtosHook.produtos.map((p) => (
                      <option key={p.id} value={p.id}>{p.nome}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="stx-label">Operação</label>
                  <select className="stx-select" value={filtrosForm.operacaoId || ""} onChange={(e) => setFiltrosForm((f) => ({ ...f, operacaoId: e.target.value || undefined }))}>
                    <option value="">Todas</option>
                    {operacoesHook.operacoes.map((o) => (
                      <option key={o.id} value={o.id}>{o.nome}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="stx-label">Funcionário</label>
                  <select className="stx-select" value={filtrosForm.funcionarioId || ""} onChange={(e) => setFiltrosForm((f) => ({ ...f, funcionarioId: e.target.value || undefined }))}>
                    <option value="">Todos</option>
                    {funcionariosElegibilidadeHook.funcionarios.map((f) => (
                      <option key={f.id} value={f.id}>{f.nome}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="stx-label">Origem da parada</label>
                  <select className="stx-select" value={origemFiltro} onChange={(e) => setOrigemFiltro(e.target.value as OrigemParada | "")}>
                    <option value="">Todas</option>
                    <option value="manual">Manual</option>
                    <option value="ocorrencia">Ocorrência</option>
                  </select>
                </div>
              </div>
              <div className="stx-form-actions" style={{ marginTop: 12 }}>
                <button type="button" className="stx-btn-primary" onClick={aplicarFiltros}>Filtrar</button>
                <button type="button" className="stx-btn-secondary" onClick={limparFiltros}>Limpar</button>
              </div>
            </div>
          )}

          <div className="stx-ind-tabs">
            {VISOES.map((v) => (
              <button key={v.key} type="button" className={`stx-ind-tab ${visao === v.key ? "active" : ""}`} onClick={() => setVisao(v.key)}>
                {v.label}
              </button>
            ))}
          </div>

          {paradasHook.erro && <p className="stx-save-error">{paradasHook.erro}</p>}

          {paradasHook.loading ? (
            <div className="stx-empty">Carregando…</div>
          ) : (
            <>
              {visao === "resumo" && <ResumoParadasCards resumo={resumo} />}

              {visao === "pareto" && (
                <div className="stx-panel">
                  <p className="stx-panel-title">Pareto de paradas</p>
                  <p className="stx-panel-sub">
                    Manuais e automáticas (vinculadas a ocorrências encerradas) somadas uma única vez cada — nunca duplicadas. O maior número de minutos não é necessariamente o maior impacto: troque pra custo/capacidade pra ver.
                  </p>
                  <ParetoParadasSeletor paradas={paradasFiltradas} tema={tema} />
                </div>
              )}

              {visao === "evolucao" && (
                <div className="stx-panel">
                  <EvolucaoTendenciaParadas
                    paradas={paradasFiltradas}
                    apontamentos={paradasHook.apontamentos}
                    tema={tema}
                    dataInicialFiltro={filtrosAplicados.dataInicial}
                    dataFinalFiltro={filtrosAplicados.dataFinal}
                  />
                </div>
              )}

              {visao === "recorrencia" && (
                <div className="stx-panel">
                  <p className="stx-panel-title">Recorrência</p>
                  <RecorrenciaParadas paradas={paradasFiltradas} apontamentos={paradasHook.apontamentos} />
                </div>
              )}

              {visao === "recurso" && (
                <div className="stx-panel">
                  <p className="stx-panel-title">Por máquina / operação / produto</p>
                  <AnaliseParadasPorRecurso paradas={paradasFiltradas} apontamentos={paradasHook.apontamentos} />
                </div>
              )}

              {visao === "semProducao" && <SemProducaoResumoView apontamentos={paradasHook.apontamentos} />}

              {visao === "detalhado" && (
                <div className="stx-panel">
                  <p className="stx-panel-title">Detalhado</p>
                  <DrillDownParadasLista paradas={paradasFiltradas} />
                </div>
              )}
            </>
          )}
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
