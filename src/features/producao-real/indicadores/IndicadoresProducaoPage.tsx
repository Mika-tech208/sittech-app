"use client";

// "Indicadores de Produção" V1 — segundo nível da arquitetura de 3
// camadas (Dashboard Principal "como está" / Indicadores "por que está
// assim" / Gestão futura "onde agir"). Só esta camada está implementada
// aqui. Todo cálculo vem de src/features/producao-real/indicadores/
// calculations.ts — esta página só busca (useIndicadoresProducao), filtra
// visualmente e escolhe qual visão mostrar. Nenhuma fórmula local.

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
import { useIndicadoresProducao } from "@/hooks/useIndicadoresProducao";
import { useGruposAbertosSidebar } from "@/hooks/useGruposAbertosSidebar";
import {
  agruparPorDia, agruparPorFuncionario, agruparPorMaquina, agruparPorOperacao, agruparPorProduto,
  calcularParetoParadas, calcularResumoIndicadores,
} from "@/features/producao-real/indicadores/calculations";
import { calcularResumoEconomico, calcularEconomicoPorProduto } from "@/features/producao-real/indicadores/economico";
import ResumoCards from "@/features/producao-real/indicadores/components/ResumoCards";
import EvolucaoDiariaChart from "@/features/producao-real/indicadores/components/EvolucaoDiariaChart";
import TabelaGrupos from "@/features/producao-real/indicadores/components/TabelaGrupos";
import ParetoParadas from "@/features/producao-real/indicadores/components/ParetoParadas";
import EconomiaCards from "@/features/producao-real/indicadores/components/EconomiaCards";
import EconomiaPorProduto from "@/features/producao-real/indicadores/components/EconomiaPorProduto";
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
  { key: "resumo", label: "Resumo geral" },
  { key: "diario", label: "Evolução diária" },
  { key: "maquinas", label: "Máquinas" },
  { key: "produtos", label: "Produtos" },
  { key: "operacoes", label: "Operações" },
  { key: "funcionarios", label: "Funcionários" },
  { key: "paradas", label: "Pareto de paradas" },
  { key: "economia", label: "Economia" },
] as const;
type VisaoKey = (typeof VISOES)[number]["key"];

function dataAtrasDias(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return toISODate(d);
}

export default function IndicadoresProducaoPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tema, setTema] = useState<"dark" | "light">("dark");
  const cores = THEMES[tema];
  const [modoPrivado, setModoPrivado] = useState(false);
  function toggleModoPrivado() {
    const next = !modoPrivado;
    setModoPrivadoAtivo(next);
    setModoPrivado(next);
  }
  const { gruposAbertos, toggleGrupo } = useGruposAbertosSidebar("prIndicadores");

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

  const indicadoresHook = useIndicadoresProducao();

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

  // ---- filtros — aceita vir pré-preenchido via query string (drill-down
  // de Desvios V1: "Ver na Produtividade" preserva contexto/janela do
  // desvio) sem mudar o comportamento padrão quando a rota é acessada
  // direto pelo menu (sem query string nenhuma). ----
  const FILTROS_INICIAIS = useMemo(() => ({
    dataInicial: searchParams.get("dataInicial") || dataAtrasDias(6),
    dataFinal: searchParams.get("dataFinal") || toISODate(new Date()),
    produtoId: searchParams.get("produtoId") || undefined,
    maquinaId: searchParams.get("maquinaId") || undefined,
    operacaoId: searchParams.get("operacaoId") || undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);
  const [filtrosAbertos, setFiltrosAbertos] = useState(true);
  const [filtrosForm, setFiltrosForm] = useState(FILTROS_INICIAIS as {
    dataInicial: string; dataFinal: string; produtoId: string | undefined; maquinaId: string | undefined; operacaoId: string | undefined; funcionarioId?: string; periodoId?: string;
  });
  const [filtrosAplicados, setFiltrosAplicados] = useState(FILTROS_INICIAIS);
  const [jaBuscouUmaVez, setJaBuscouUmaVez] = useState(false);

  function aplicarFiltros() {
    setFiltrosAplicados(filtrosForm);
    indicadoresHook.buscar(filtrosForm);
    setJaBuscouUmaVez(true);
  }
  function limparFiltros() {
    setFiltrosForm(FILTROS_INICIAIS);
    setFiltrosAplicados(FILTROS_INICIAIS);
    indicadoresHook.buscar(FILTROS_INICIAIS);
    setJaBuscouUmaVez(true);
  }

  const carregandoCadastros =
    cadastrosBase.loading || funcionariosHook.loading || funcionariosElegibilidadeHook.loading || maquinasHook.loading ||
    produtosHook.loading || operacoesHook.loading || previsoesHook.loading || custosHook.loading;

  const podeVerIndicadores = auth.autenticado && !carregandoCadastros && temPermissao(auth.usuarioLogado, "producao_real_historico");

  // Primeira busca automática assim que os cadastros (e a permissão)
  // estiverem prontos — sem exigir que o usuário clique em "Filtrar" só
  // pra ver os últimos 7 dias.
  useEffect(() => {
    if (!podeVerIndicadores || jaBuscouUmaVez) return;
    setJaBuscouUmaVez(true);
    indicadoresHook.buscar(filtrosAplicados);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [podeVerIndicadores, jaBuscouUmaVez]);

  const [visao, setVisao] = useState<VisaoKey>("resumo");

  const resumoGeral = useMemo(
    () => calcularResumoIndicadores(indicadoresHook.apontamentos, indicadoresHook.paradas),
    [indicadoresHook.apontamentos, indicadoresHook.paradas]
  );
  const gruposDia = useMemo(
    () => agruparPorDia(indicadoresHook.apontamentos, indicadoresHook.paradas),
    [indicadoresHook.apontamentos, indicadoresHook.paradas]
  );
  const gruposMaquina = useMemo(
    () => agruparPorMaquina(indicadoresHook.apontamentos, indicadoresHook.paradas),
    [indicadoresHook.apontamentos, indicadoresHook.paradas]
  );
  const gruposProduto = useMemo(
    () => agruparPorProduto(indicadoresHook.apontamentos, indicadoresHook.paradas),
    [indicadoresHook.apontamentos, indicadoresHook.paradas]
  );
  const gruposOperacao = useMemo(
    () => agruparPorOperacao(indicadoresHook.apontamentos, indicadoresHook.paradas),
    [indicadoresHook.apontamentos, indicadoresHook.paradas]
  );
  const gruposFuncionario = useMemo(
    () => agruparPorFuncionario(indicadoresHook.apontamentos, indicadoresHook.paradas),
    [indicadoresHook.apontamentos, indicadoresHook.paradas]
  );
  const pareto = useMemo(() => calcularParetoParadas(indicadoresHook.paradas), [indicadoresHook.paradas]);

  // ---- Motor Econômico V1 — reaproveita os mesmos apontamentos já
  // buscados (nenhuma chamada nova ao banco) e o agrupamento por produto
  // já calculado acima (gruposProduto). ----
  const resumoEconomico = useMemo(
    () => calcularResumoEconomico(indicadoresHook.apontamentos),
    [indicadoresHook.apontamentos]
  );
  const economicoPorProduto = useMemo(
    () => calcularEconomicoPorProduto(gruposProduto, indicadoresHook.apontamentos),
    [gruposProduto, indicadoresHook.apontamentos]
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
            abaAtiva="prIndicadores"
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
          abaAtiva="prIndicadores"
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
              <h1 className="stx-title">Indicadores de Produção</h1>
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

          {indicadoresHook.erro && <p className="stx-save-error">{indicadoresHook.erro}</p>}

          {indicadoresHook.loading ? (
            <div className="stx-empty">Carregando…</div>
          ) : (
            <>
              {visao === "resumo" && <ResumoCards resumo={resumoGeral} />}

              {visao === "diario" && (
                <div className="stx-panel">
                  <p className="stx-panel-title">Evolução diária</p>
                  <p className="stx-panel-sub">Performance, Disponibilidade e OEE agregados de cada dia do período filtrado — nunca média simples de percentuais, sempre soma de numerador/denominador.</p>
                  <EvolucaoDiariaChart dias={gruposDia} tema={tema} />
                </div>
              )}

              {visao === "maquinas" && (
                <div className="stx-panel">
                  <p className="stx-panel-title">Máquinas</p>
                  <p className="stx-panel-sub">Clique numa máquina para detalhar por produto.</p>
                  <TabelaGrupos
                    grupos={gruposMaquina}
                    colunaRotulo="Máquina"
                    vazio="Nenhum apontamento no período/filtro."
                    colunaSub="Produto"
                    subAgrupar={(g) => agruparPorProduto(g.apontamentos, g.paradas)}
                  />
                </div>
              )}

              {visao === "produtos" && (
                <div className="stx-panel">
                  <p className="stx-panel-title">Produtos</p>
                  <p className="stx-panel-sub">&quot;Prod. acabada&quot; aqui já é só a última etapa; as demais colunas (Performance/Disponibilidade/paradas) consideram todas as etapas do produto. Clique num produto para detalhar por máquina.</p>
                  <TabelaGrupos
                    grupos={gruposProduto}
                    colunaRotulo="Produto"
                    vazio="Nenhum apontamento no período/filtro."
                    colunaSub="Máquina"
                    subAgrupar={(g) => agruparPorMaquina(g.apontamentos, g.paradas)}
                  />
                </div>
              )}

              {visao === "operacoes" && (
                <div className="stx-panel">
                  <p className="stx-panel-title">Operações</p>
                  <p className="stx-panel-sub">Clique numa operação para detalhar por máquina.</p>
                  <TabelaGrupos
                    grupos={gruposOperacao}
                    colunaRotulo="Operação"
                    vazio="Nenhum apontamento no período/filtro."
                    colunaSub="Máquina"
                    subAgrupar={(g) => agruparPorMaquina(g.apontamentos, g.paradas)}
                  />
                </div>
              )}

              {visao === "funcionarios" && (
                <div className="stx-panel">
                  <p className="stx-panel-title">Funcionários</p>
                  <p className="stx-panel-sub">
                    Não é ranking — ordem sempre alfabética, sem destaque de &quot;melhor/pior&quot;. Um funcionário com Performance menor pode estar num processo mais difícil; clique no nome para ver o contexto por produto/operação/máquina antes de tirar qualquer conclusão.
                  </p>
                  <TabelaGrupos
                    grupos={gruposFuncionario}
                    colunaRotulo="Funcionário"
                    vazio="Nenhum apontamento no período/filtro."
                    colunaSub="Produto"
                    subAgrupar={(g) => agruparPorProduto(g.apontamentos, g.paradas)}
                  />
                </div>
              )}

              {visao === "paradas" && (
                <div className="stx-panel">
                  <p className="stx-panel-title">Pareto de motivos de parada</p>
                  <p className="stx-panel-sub">Manuais e automáticas (vinculadas a ocorrências encerradas) somadas uma única vez cada. Clique num motivo pra ver em quais máquinas ele ocorreu.</p>
                  <ParetoParadas pareto={pareto} paradas={indicadoresHook.paradas} tema={tema} />
                </div>
              )}

              {visao === "economia" && (
                <>
                  <EconomiaCards resumo={resumoEconomico} />
                  <div style={{ marginTop: 16 }}>
                    <EconomiaPorProduto itens={economicoPorProduto} />
                  </div>
                </>
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
