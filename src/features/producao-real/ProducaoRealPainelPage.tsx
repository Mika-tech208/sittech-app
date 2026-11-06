"use client";

// Tela principal de chão de fábrica da Produção Real V1 — grade de
// máquinas do período (atual ou "outro período") + ocorrências de
// máquina. Ocorrência (PARADA AGORA) e estadoPeriodo (PENDENTE/APONTADO/
// SEM PRODUÇÃO) são independentes: o card expõe as duas ações
// separadamente — clique no corpo do card abre o fluxo de período (só
// quando pendente); clique no pill "PARADA AGORA" (com stopPropagation)
// abre o encerramento da ocorrência.
//
// Meta, custo/hora, OEE, disponibilidade, qualidade e atingimento nunca
// aparecem nesta tela — só o necessário pra supervisora saber o que já
// fechou e o que falta.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { formatarTempoDecorrido } from "@/lib/tempoDecorrido";
import { useAuthSession } from "@/hooks/useAuthSession";
import { useCadastrosBase } from "@/hooks/useCadastrosBase";
import { useFuncionarios } from "@/hooks/useFuncionarios";
import { useFuncionariosElegibilidade } from "@/hooks/useFuncionariosElegibilidade";
import { useMaquinas } from "@/hooks/useMaquinas";
import { useProducaoRealPainel, type EstadoPeriodoMaquina, type PeriodoSelecionado } from "@/hooks/useProducaoRealPainel";
import { useApontamentosRealizados, type ApontamentoRealizado } from "@/hooks/useApontamentosRealizados";
import { useSidebarState } from "@/hooks/useSidebarState";
import ApontamentoModal from "@/features/producao-real/ApontamentoModal";
import EscolhaFluxoModal from "@/features/producao-real/EscolhaFluxoModal";
import SemProducaoModal, { LABEL_MOTIVO_SEM_PRODUCAO } from "@/features/producao-real/SemProducaoModal";
import ResumoApontamentoModal from "@/features/producao-real/ResumoApontamentoModal";
import PeriodoSeletorModal from "@/features/producao-real/PeriodoSeletorModal";
import AbrirOcorrenciaModal from "@/features/producao-real/AbrirOcorrenciaModal";
import EncerrarOcorrenciaModal from "@/features/producao-real/EncerrarOcorrenciaModal";
import LoginScreen from "@/components/shell/LoginScreen";
import RecoveryPasswordScreen from "@/components/shell/RecoveryPasswordScreen";
import Sidebar from "@/components/shell/Sidebar";
import TopBarActions from "@/components/shell/TopBarActions";
import AccountModal from "@/components/shell/AccountModal";
import AcessoNegado from "@/components/shell/AcessoNegado";
import GlobalStyles from "@/components/shell/GlobalStyles";
import { THEMES } from "@/lib/constants";
import { useTema } from "@/hooks/useTema";
import { temPermissao } from "@/lib/permissoes";
import { dataLocalSP, horaLocalSP } from "@/hooks/useProducaoRealPainel";
import SeloFechamento from "@/features/escala/fechamento/SeloFechamento";
import FechamentoPeriodoModal from "@/features/producao-real/fechamento/FechamentoPeriodoModal";
import RegularizacaoHistoricaModal from "@/features/producao-real/RegularizacaoHistoricaModal";
import { estadoFechamentoApi, postosProgramadosApi } from "@/features/producao-real/fechamento/api";
import { estadoDaGrade, filtrarGradeProgramada, MENSAGEM_POSTOS_NAO_CARREGADOS, textoApontamentosCompletos, type EstadoGrade } from "@/features/producao-real/fechamento/textos";
import { formatBRL, setModoPrivadoAtivo } from "@/lib/format";
import { toISODate, mondayOf } from "@/lib/date";
import { calcularTotalFixoAtivo, calcularTotalCustoFuncionariosAtivos, calcularMetaFaturamento } from "@/features/custo-hora/calculations";
import { selecionarSemana, calcularResumoSemana } from "@/features/capacidade/selectors";
import { ordenarMaquinasPorNome } from "@/features/maquinas/calculations";
import { usePrevisoes } from "@/hooks/usePrevisoes";
import { useCustos } from "@/hooks/useCustos";

const LABEL_ESTADO: Record<EstadoPeriodoMaquina, string> = {
  pendente: "PENDENTE",
  apontado: "APONTADO",
  sem_producao: "SEM PRODUÇÃO",
};

export default function ProducaoRealPainelPage() {
  const router = useRouter();
  const [tema, setTema] = useTema();
  const cores = THEMES[tema];
  const [modoPrivado, setModoPrivado] = useState(false);
  function toggleModoPrivado() {
    const next = !modoPrivado;
    setModoPrivadoAtivo(next);
    setModoPrivado(next);
  }
  const shell = useSidebarState("producaoRealPainel");

  const auth = useAuthSession();
  const cadastrosBase = useCadastrosBase(auth.autenticado);
  // Ordem exigida: auth -> cadastros-base -> funcionários -> máquinas -> ... (mesma de todas as rotas migradas).
  const funcionariosHook = useFuncionarios(auth.autenticado && !cadastrosBase.loading);
  const { funcionarios } = funcionariosHook;
  // Leitura mínima (id/nome, nunca salário) via view — é o que alimenta o
  // dropdown de funcionário do apontamento/ocorrência, funcionando mesmo
  // sem a permissão 'funcionarios'/'custo_hora' (ver migration
  // 20260902190000). `funcionariosHook` (acima) continua existindo só pro
  // card "Meta semanal" da sidebar, que já fica escondido sem 'financeiro'.
  const funcionariosElegibilidadeHook = useFuncionariosElegibilidade(auth.autenticado && !cadastrosBase.loading);
  const maquinasHook = useMaquinas(auth.autenticado && !cadastrosBase.loading && !funcionariosHook.loading);
  const previsoesHook = usePrevisoes(auth.autenticado && !cadastrosBase.loading && !funcionariosHook.loading && !maquinasHook.loading);
  const { previsoes } = previsoesHook;
  const custosHook = useCustos(auth.autenticado && !cadastrosBase.loading && !funcionariosHook.loading && !maquinasHook.loading && !previsoesHook.loading);
  const { fixedCosts } = custosHook;

  const maquinasAtivasOrdenadas = useMemo(
    () => ordenarMaquinasPorNome(maquinasHook.maquinas.filter((m) => m.ativo)),
    [maquinasHook.maquinas]
  );

  // "Outro período" — nulo = modo automático (padrão); quando preenchido,
  // a grade passa a mostrar exatamente essa data+período (retroativo).
  const [periodoSelecionado, setPeriodoSelecionado] = useState<PeriodoSelecionado | null>(null);
  const [seletorPeriodoAberto, setSeletorPeriodoAberto] = useState(false);

  const painel = useProducaoRealPainel(
    auth.autenticado && !cadastrosBase.loading && !funcionariosHook.loading && !maquinasHook.loading,
    maquinasAtivasOrdenadas,
    periodoSelecionado
  );

  // Resumo de um card JÁ FECHADO (apontado ou sem produção) — reaproveita
  // o mesmo hook/query/modal de Apontamentos realizados (useApontamentosRealizados
  // + ResumoApontamentoModal), sem duplicar nenhuma regra de negócio nem
  // criar RPC nova. `pronto=false`: nunca dispara o fetch automático de
  // "100 mais recentes" desse hook — só usamos `buscar(...)` sob demanda,
  // filtrado pra exatamente 1 linha (máquina+período+dia do card clicado).
  const apontamentosRealizadosHook = useApontamentosRealizados(false);
  const [apontamentoResumo, setApontamentoResumo] = useState<ApontamentoRealizado | null>(null);
  const [carregandoResumo, setCarregandoResumo] = useState(false);
  const [erroResumo, setErroResumo] = useState<string | null>(null);

  async function abrirResumoFechado(m: (typeof painel.maquinasView)[number]) {
    if (!painel.periodoAtual || carregandoResumo) return;
    setErroResumo(null);
    setCarregandoResumo(true);
    const linhas = await apontamentosRealizadosHook.buscar({
      maquinaId: m.id,
      periodoId: painel.periodoAtual.id,
      dataInicial: painel.periodoAtual.data,
      dataFinal: painel.periodoAtual.data,
    });
    setCarregandoResumo(false);
    const linha = (linhas || [])[0];
    if (!linha) {
      setErroResumo("Não foi possível carregar este apontamento. Atualize a página e tente de novo.");
      return;
    }
    setApontamentoResumo({
      ...linha,
      funcionarioNome: linha.funcionarioId ? funcionarioNomePorId.get(linha.funcionarioId) || linha.funcionarioNome : linha.funcionarioNome,
    });
  }

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

  // ---- FECHAMENTO FÍSICO (flag escala_fechamento_fisico_modo; desligado = esta seção não aparece e nada muda) ----
  const podeFechar = temPermissao(auth.usuarioLogado, "escala_fechamento");
  // regularização histórica (admin / perfil superior): atalho para o modo administrativo de dias passados liberados
  const podeRegularizar = temPermissao(auth.usuarioLogado, "escala_fechamento_excecao");
  const [regularizacaoAberta, setRegularizacaoAberta] = useState(false);
  const [modoFechamento, setModoFechamento] = useState<"desligado" | "sombra" | "ativo">("desligado");
  const [estadoFechamento, setEstadoFechamento] = useState<string | null>(null);
  const [fechamentoAberto, setFechamentoAberto] = useState(false);
  const periodoDoFechamento = painel.periodoAtual;
  useEffect(() => {
    if (!podeFechar || !periodoDoFechamento) return;
    let vivo = true;
    void estadoFechamentoApi(periodoDoFechamento.data, periodoDoFechamento.id).then((r) => { if (!vivo) return; setModoFechamento(r.corpo.modo ?? "desligado"); setEstadoFechamento(r.corpo.fechado ? (r.corpo.estado ?? null) : null); }).catch(() => undefined);
    return () => { vivo = false; };
  }, [podeFechar, periodoDoFechamento, fechamentoAberto]);
  // GRADE DO TABLET — REGRA DEFINITIVA (fechamento físico ATIVO): só os postos PROGRAMADOS do período na escala vigente/liberada (/api/escala/fechamento/postos).
  // Independe de permissão especial. FAIL CLOSED: se a escala não carregar, NÃO volta para todas as máquinas — mostra o erro. Produção fora da escala = exceção explícita (+ ADICIONAR APONTAMENTO).
  const chaveGrade = periodoDoFechamento ? `${periodoDoFechamento.data}|${periodoDoFechamento.id}` : null;
  const [grade, setGrade] = useState<{ chave: string; estado: EstadoGrade; ids: Set<string>; predecessor: { data: string; periodo: string; rotulo: string } | null } | null>(null);
  const [tentativaGrade, setTentativaGrade] = useState(0);
  const [extras, setExtras] = useState<{ chave: string; ids: Set<string> } | null>(null);
  const [adicionando, setAdicionando] = useState(false);
  useEffect(() => {
    if (!periodoDoFechamento || !chaveGrade) return;
    let vivo = true;
    const aplicar = (estado: EstadoGrade, ids: Set<string>, predecessor: { data: string; periodo: string; rotulo: string } | null = null) => { if (vivo) setGrade({ chave: chaveGrade, estado, ids, predecessor }); };
    void postosProgramadosApi(periodoDoFechamento.data, periodoDoFechamento.id)
      .then((r) => aplicar(estadoDaGrade(r), new Set((r.corpo.postos ?? []).map((p) => p.maquinaId)), r.corpo.predecessor ?? null))
      .catch(() => aplicar("erro", new Set()));
    return () => { vivo = false; };
  }, [chaveGrade, periodoDoFechamento, tentativaGrade, fechamentoAberto]);
  const estadoGrade: EstadoGrade = grade && grade.chave === chaveGrade ? grade.estado : "carregando";   // trocou de período ⇒ não reaproveita a lista do outro
  const idsExtras = extras && extras.chave === chaveGrade ? extras.ids : undefined;
  const idsProgramados = estadoGrade === "programada" && grade ? grade.ids : null;
  const maquinasViewTodas = painel.maquinasView;
  const maquinasView = useMemo(
    () => (estadoGrade === "legado" ? maquinasViewTodas                                   // fechamento físico desligado/sombra: fluxo anterior
      : idsProgramados ? filtrarGradeProgramada(maquinasViewTodas, idsProgramados, idsExtras)
      : []),                                                                              // carregando / erro / período não liberado: nada de "todas as máquinas"
    [estadoGrade, idsProgramados, idsExtras, maquinasViewTodas]
  );
  const foraDaEscala = useMemo(() => (idsProgramados ? maquinasViewTodas.filter((m) => !maquinasView.some((x) => x.id === m.id)) : []), [idsProgramados, maquinasViewTodas, maquinasView]);
  const minutos = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  const naJanelaDeTroca = !!periodoDoFechamento && (periodoDoFechamento.data < dataLocalSP() || (periodoDoFechamento.data === dataLocalSP() && minutos(horaLocalSP()) >= minutos(periodoDoFechamento.fim) - 5));
  // apontamentos completos também abrem o fechamento (máquinas já paradas), mesmo antes dos 5 min finais do período
  const apontamentosCompletos = maquinasView.length > 0 && maquinasView.every((m) => m.estadoPeriodo !== "pendente");
  const mostrarFechamento = podeFechar && modoFechamento !== "desligado" && !!periodoDoFechamento && (naJanelaDeTroca || apontamentosCompletos);

  const totalMaquinas = maquinasView.length;
  const totalFechadas = maquinasView.filter((m) => m.estadoPeriodo !== "pendente").length;
  const tudoFechado = totalMaquinas > 0 && totalFechadas === totalMaquinas;
  const pctFechadas = totalMaquinas > 0 ? (totalFechadas / totalMaquinas) * 100 : 0;

  // Só contagem de estados já presentes em maquinasView — nenhum
  // dado novo, nenhuma busca nova (legenda "N pendentes/apontadas/sem
  // produção" da composição visual).
  const contagemEstados = useMemo(() => {
    let pendentes = 0, apontadas = 0, semProducao = 0;
    maquinasView.forEach((m) => {
      if (m.estadoPeriodo === "pendente") pendentes++;
      else if (m.estadoPeriodo === "apontado") apontadas++;
      else if (m.estadoPeriodo === "sem_producao") semProducao++;
    });
    return { pendentes, apontadas, semProducao };
  }, [maquinasView]);

  // ---- fluxo de "Registrar produção" ----
  // Só ativos aqui — não dá pra escolher um funcionário inativo num
  // apontamento/ocorrência novos (mesma regra de sempre, agora vinda da
  // view em vez da tabela cheia).
  const funcionariosAtivosSimples = useMemo(
    () => funcionariosElegibilidadeHook.funcionarios.filter((f) => f.ativo),
    [funcionariosElegibilidadeHook.funcionarios]
  );
  // Mesmo motivo/mesma solução de ApontamentosRealizadosPage.tsx:
  // useApontamentosRealizados não embeda funcionarios(nome) (RLS bloquearia
  // quem não tem permissão de funcionários/custo_hora) — resolvido aqui via
  // a mesma view sem essa restrição, incluindo inativos (apontamento antigo
  // pode ser de alguém que já saiu).
  const funcionarioNomePorId = useMemo(
    () => new Map(funcionariosElegibilidadeHook.funcionarios.map((f) => [f.id, f.nome])),
    [funcionariosElegibilidadeHook.funcionarios]
  );
  const [maquinaEmEdicaoId, setMaquinaEmEdicaoId] = useState<string | null>(null);
  // "escolha" = passo 1 (Registrar produção / Sem produção); os outros dois
  // são o formulário de fato, cada um seguindo a escolha.
  const [fluxoAtual, setFluxoAtual] = useState<"escolha" | "producao" | "sem_producao" | null>(null);
  const maquinaEmEdicao = maquinasView.find((m) => m.id === maquinaEmEdicaoId) || null;

  // ---- fluxo de "Ocorrência de máquina" (independente do estadoPeriodo) ----
  const [abrirOcorrenciaAberto, setAbrirOcorrenciaAberto] = useState(false);
  const [maquinaEncerrandoId, setMaquinaEncerrandoId] = useState<string | null>(null);
  const maquinaEncerrando = maquinasView.find((m) => m.id === maquinaEncerrandoId) || null;
  const maquinasSemOcorrenciaAberta = useMemo(
    () => maquinasView.filter((m) => m.estadoMaquina !== "parada").map((m) => ({ id: m.id, nome: m.nome })),
    [maquinasView]
  );

  // Pendente: comportamento de sempre (passo 1 "Registrar produção"/"Sem
  // produção"). Apontado ou sem produção: abre o resumo já existente de
  // Apontamentos realizados (abrirResumoFechado), de onde dá pra editar,
  // transformar em produção realizada ou excluir — mesmo fluxo, chamado
  // agora também a partir do card, não só da lista.
  // FECHAMENTO ATIVO: quem fecha o período lança os apontamentos pelo FLUXO ÚNICO (postos programados já pré-preenchidos: máquina, operador, produto, operação, período).
  // O passo-a-passo antigo (escolher máquina/operador/produto à mão) só resta para quem não fecha período e para períodos retroativos.
  const fluxoUnicoDeApontamento = modoFechamento === "ativo" && estadoGrade === "programada" && podeFechar && !!periodoDoFechamento && !periodoSelecionado;
  function abrirEscolha(m: (typeof painel.maquinasView)[number]) {
    if (m.estadoPeriodo === "pendente") {
      if (fluxoUnicoDeApontamento) { setFechamentoAberto(true); return; }
      setMaquinaEmEdicaoId(m.id);
      setFluxoAtual("escolha");
      return;
    }
    abrirResumoFechado(m);
  }

  function fecharFluxo() {
    setMaquinaEmEdicaoId(null);
    setFluxoAtual(null);
  }

  // "Próxima máquina" sempre volta pro passo de escolha da próxima
  // pendente — não presume que ela quer repetir o mesmo fluxo.
  function irParaProximaPendente(atualId: string) {
    const proxima = proximaPendente(atualId);
    if (proxima) {
      setMaquinaEmEdicaoId(proxima.id);
      setFluxoAtual("escolha");
    } else {
      fecharFluxo();
    }
  }

  // Próxima máquina PENDENTE na ordem atual da grade, a partir da posição
  // seguinte à atual (dá a volta se preciso) — nunca a própria atual.
  function proximaPendente(atualId: string) {
    const lista = maquinasView;
    const idxAtual = lista.findIndex((m) => m.id === atualId);
    if (idxAtual === -1) return null;
    for (let i = 1; i <= lista.length; i++) {
      const candidata = lista[(idxAtual + i) % lista.length];
      if (candidata.id !== atualId && candidata.estadoPeriodo === "pendente") return candidata;
    }
    return null;
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

  const carregando =
    cadastrosBase.loading || funcionariosHook.loading || funcionariosElegibilidadeHook.loading || maquinasHook.loading ||
    previsoesHook.loading || custosHook.loading || painel.loading;

  if (carregando || auth.restaurandoSessao || !auth.autenticado) {
    return (
      <div className="stx-root">
        <GlobalStyles cores={cores} />
        <LoginScreen
          loading={auth.restaurandoSessao || (auth.autenticado && carregando)}
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

  // Bloqueio real de rota — não só o Sidebar escondendo o link (a RLS já
  // barra os dados por trás; isso é só a mensagem).
  if (!temPermissao(auth.usuarioLogado, "producao_real_apontamento")) {
    return (
      <div className="stx-root">
        <GlobalStyles cores={cores} />
        <div className="stx-layout">
          <Sidebar
            tema={tema}
            abaAtiva="producaoRealPainel"
            onNavigateTab={(key) => { router.push(`/?aba=${key}`); }}
            gruposAbertos={shell.gruposAbertos}
            toggleGrupo={shell.toggleGrupo}
            usuarioLogado={auth.usuarioLogado}
            metaSemanalUsaPrevisto={metaSemanalUsaPrevisto}
            metaInvalida={metaInvalida}
            metaSemanalFinal={metaSemanalFinal}
            formatBRL={formatBRL}
            onMetaClick={() => { router.push("/"); }}
            onAbrirMinhaConta={auth.abrirMinhaConta}
            onSair={() => auth.handleLogout()}
            recolhida={shell.recolhida}
            onToggleRecolhida={shell.toggleRecolhida}
            gavetaAberta={shell.gavetaAberta}
            onFecharGaveta={shell.fecharGaveta}
          />
          <AcessoNegado />
        </div>
      </div>
    );
  }

  const podeOcorrencia = temPermissao(auth.usuarioLogado, "producao_real_ocorrencias");

  return (
    <div className="stx-root">
      <GlobalStyles cores={cores} />
      <div className="stx-layout">
        <Sidebar
          tema={tema}
          abaAtiva="producaoRealPainel"
          onNavigateTab={(key) => { router.push(`/?aba=${key}`); }}
          gruposAbertos={shell.gruposAbertos}
          toggleGrupo={shell.toggleGrupo}
          usuarioLogado={auth.usuarioLogado}
          metaSemanalUsaPrevisto={metaSemanalUsaPrevisto}
          metaInvalida={metaInvalida}
          metaSemanalFinal={metaSemanalFinal}
          formatBRL={formatBRL}
          onMetaClick={() => { router.push("/"); }}
          onAbrirMinhaConta={auth.abrirMinhaConta}
          onSair={() => auth.handleLogout()}
          recolhida={shell.recolhida}
          onToggleRecolhida={shell.toggleRecolhida}
          gavetaAberta={shell.gavetaAberta}
          onFecharGaveta={shell.fecharGaveta}
        />

        <div className="stx-content-wrapper">
          <TopBarActions
            modoPrivado={modoPrivado}
            onToggleModoPrivado={toggleModoPrivado}
            tema={tema}
            onToggleTema={() => setTema((t) => (t === "dark" ? "light" : "dark"))}
            usuarioLogado={auth.usuarioLogado}
            abaAtiva="producaoRealPainel"
            onAbrirMenu={shell.abrirGaveta}
          />
          {(painel.modoRetroativo || podeRegularizar) && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {painel.modoRetroativo && <span className="stx-ap-retroativo-badge">Período anterior</span>}
              {podeRegularizar && (
                <button type="button" className="stx-ap-btn-primary" onClick={() => setRegularizacaoAberta(true)}>REGULARIZAR APONTAMENTOS ANTERIORES</button>
              )}
            </div>
          )}

          <div className="stx-ap-toprow">
            <div style={{ minWidth: 0 }}>
              <div className="stx-ap-header-top">
                <span className="stx-ap-header-label">{painel.modoRetroativo ? "Outro período" : "Período atual"}</span>
                {!painel.modoRetroativo ? (
                  <button type="button" className="stx-ap-outro-periodo-pill" onClick={() => setSeletorPeriodoAberto(true)}>
                    Outro período
                  </button>
                ) : (
                  <button type="button" className="stx-ap-outro-periodo-pill" onClick={() => setPeriodoSelecionado(null)}>
                    Voltar para período atual
                  </button>
                )}
              </div>

              {painel.periodoAtual && (
                <div className="stx-ap-period-row">
                  <h1 className="stx-ap-period-h1">{painel.periodoAtual.nome}</h1>
                  <span className="stx-ap-period-datetime">
                    {painel.modoRetroativo && `${painel.periodoAtual.data.split("-").reverse().join("/")} · `}
                    {painel.periodoAtual.inicio} às {painel.periodoAtual.fim}
                  </span>
                </div>
              )}

              {totalMaquinas > 0 && (
                <div className="stx-ap-progress-row">
                  <span className="stx-ap-progress-track">
                    <span className="stx-ap-progress-fill" style={{ width: `${pctFechadas}%` }} />
                  </span>
                  <span className="stx-ap-progress-text"><b>{totalFechadas}</b> de {totalMaquinas} máquinas fechadas</span>
                </div>
              )}
            </div>

            {podeOcorrencia && (
              <button type="button" className="stx-ap-btn-ocorrencia" onClick={() => setAbrirOcorrenciaAberto(true)}>
                <AlertTriangle size={18} />
                Informar máquina parada
              </button>
            )}
          </div>

          {podeFechar && modoFechamento === "ativo" && <div style={{ marginTop: 12 }}><SeloFechamento /></div>}

          {mostrarFechamento && periodoDoFechamento && (
            estadoFechamento === "CONFIRMADO" ? (
              <div className="stx-ap-completo-banner">✓ {periodoDoFechamento.nome} fechado fisicamente — próximo período CONFIRMADO</div>
            ) : (
              <button type="button" className="stx-ap-btn-primary" style={{ width: "100%", marginTop: 16, minHeight: 64 }} onClick={() => setFechamentoAberto(true)}>
                {estadoFechamento === "ERRO_RECALCULO" ? "Estoque salvo — gerar a programação de novo" : "FECHAR PERÍODO E GERAR PRÓXIMA PROGRAMAÇÃO"}
              </button>
            )
          )}

          {tudoFechado && (
            <div className="stx-ap-completo-banner">{textoApontamentosCompletos(modoFechamento, estadoFechamento)}</div>
          )}

          {painel.erro && <p className="stx-save-error" style={{ marginTop: 16 }}>{painel.erro}</p>}

          {estadoGrade === "carregando" ? (
            <div className="stx-empty" role="status">Carregando os postos programados…</div>
          ) : estadoGrade === "erro" ? (
            <div className="stx-empty" role="alert">
              <p style={{ fontWeight: 700, margin: "0 0 10px" }}>{MENSAGEM_POSTOS_NAO_CARREGADOS}</p>
              <button type="button" className="stx-ap-btn-primary" onClick={() => setTentativaGrade((n) => n + 1)}>Tentar de novo</button>
            </div>
          ) : estadoGrade === "nao_liberada" ? (
            <div className="stx-empty" role="status">
              <p style={{ fontWeight: 700, margin: "0 0 10px" }}>AGUARDANDO NOVA PROGRAMAÇÃO — a programação deste período será liberada depois do fechamento físico do período anterior.</p>
              {podeRegularizar && (
                <button type="button" className="stx-ap-btn-primary" style={{ minHeight: 56, marginRight: 8 }} onClick={() => setRegularizacaoAberta(true)}>REGULARIZAR APONTAMENTOS ANTERIORES</button>
              )}
              {grade?.predecessor && podeFechar && (
                <button type="button" className="stx-ap-btn-primary" style={{ minHeight: 56 }} onClick={() => setPeriodoSelecionado({ data: grade.predecessor!.data, periodoId: grade.predecessor!.periodo })}>
                  FECHAR {grade.predecessor.rotulo} (período anterior)
                </button>
              )}
            </div>
          ) : totalMaquinas === 0 && estadoGrade === "legado" ? (
            <div className="stx-empty">Nenhuma máquina ativa cadastrada.</div>
          ) : totalMaquinas === 0 ? (
            <>
              <div className="stx-empty">Nenhum posto programado neste período.</div>
              <button type="button" className="stx-ap-btn-secondary" style={{ marginTop: 12 }} onClick={() => setAdicionando(true)}>+ ADICIONAR APONTAMENTO</button>
            </>
          ) : (
            <>
              <div className="stx-ap-legend-row">
                <span className="stx-ap-legend-label">Pendentes primeiro</span>
                <span style={{ flex: 1 }} />
                <div className="stx-ap-legend-counts">
                  <span className="stx-ap-legend-item"><span className="stx-ap-legend-dot" style={{ background: "var(--warning)" }} />{contagemEstados.pendentes} pendentes</span>
                  <span className="stx-ap-legend-item"><span className="stx-ap-legend-dot" style={{ background: "var(--accent)" }} />{contagemEstados.apontadas} apontadas</span>
                  <span className="stx-ap-legend-item"><span className="stx-ap-legend-dot" style={{ background: "var(--text-3)" }} />{contagemEstados.semProducao} sem produção</span>
                </div>
              </div>

              {erroResumo && <div className="stx-empty" style={{ marginBottom: 12 }}>{erroResumo}</div>}

              <div className="stx-ap-grid">
                {maquinasView.map((m) => {
                  const parada = m.estadoMaquina === "parada";
                  const fechada = !parada && m.estadoPeriodo !== "pendente";
                  return (
                    <div
                      key={m.id}
                      role="button"
                      tabIndex={0}
                      className={`stx-ap-tile ${parada ? "parada" : ""} ${fechada ? "fechada" : ""}`}
                      onClick={() => abrirEscolha(m)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); abrirEscolha(m); } }}
                    >
                      <div className="stx-ap-tile-top">
                        <span className="stx-ap-tile-nome">{m.nome}</span>
                        {parada ? (
                          podeOcorrencia ? (
                            <button
                              type="button"
                              className="stx-ap-tile-pill parada-agora"
                              onClick={(e) => { e.stopPropagation(); setMaquinaEncerrandoId(m.id); }}
                            >
                              Parada agora
                            </button>
                          ) : (
                            <span className="stx-ap-tile-pill parada-agora" style={{ cursor: "default" }}>Parada agora</span>
                          )
                        ) : m.estadoPeriodo === "pendente" ? (
                          <span className="stx-ap-tile-pill pendente">{LABEL_ESTADO.pendente}</span>
                        ) : (
                          <span className={`stx-ap-tile-estado-inline ${m.estadoPeriodo === "apontado" ? "apontado" : "sem-producao"}`}>
                            {LABEL_ESTADO[m.estadoPeriodo]}
                          </span>
                        )}
                      </div>
                      <p className="stx-ap-tile-footer">
                        {parada && m.ocorrenciaAberta
                          ? `${m.ocorrenciaAberta.motivoNome} · ${formatarTempoDecorrido(m.ocorrenciaAberta.abertaEm)}`
                          : m.estadoPeriodo === "apontado"
                          ? `${m.produtoNome || "Produto"} · ${m.quantidadeProduzida} un.`
                          : m.estadoPeriodo === "sem_producao"
                          ? (m.motivoSemProducao ? LABEL_MOTIVO_SEM_PRODUCAO[m.motivoSemProducao] || m.motivoSemProducao : "")
                          : ""}
                      </p>
                    </div>
                  );
                })}
              </div>
              {estadoGrade === "programada" && (
                <div style={{ marginTop: 14 }}>
                  <button type="button" className="stx-ap-btn-secondary" onClick={() => (fluxoUnicoDeApontamento ? setFechamentoAberto(true) : setAdicionando(true))}>+ ADICIONAR APONTAMENTO</button>
                  <span className="stx-ap-legend-label" style={{ marginLeft: 10 }}>só para máquina que trabalhou fora da programação</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {adicionando && (
        <div className="stx-modal-backdrop" role="dialog" aria-modal="true" aria-label="Adicionar apontamento fora da escala" onClick={() => setAdicionando(false)}>
          <div className="stx-ap-modal-card" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>Apontamento fora da escala</h2>
            <p className="stx-ap-legend-label">Escolha a máquina que trabalhou sem estar programada neste período:</p>
            <div style={{ display: "grid", gap: 8, maxHeight: "50vh", overflowY: "auto", marginTop: 8 }}>
              {foraDaEscala.length === 0 && <p className="stx-empty">Todas as máquinas ativas já estão na lista.</p>}
              {foraDaEscala.map((m) => (
                <button key={m.id} type="button" className="stx-ap-btn-secondary" style={{ minHeight: 52, textAlign: "left" }}
                  onClick={() => { setExtras((x) => ({ chave: chaveGrade ?? "", ids: new Set([...(x && x.chave === chaveGrade ? x.ids : []), m.id]) })); setAdicionando(false); setMaquinaEmEdicaoId(m.id); setFluxoAtual("escolha"); }}>
                  {m.nome}
                </button>
              ))}
            </div>
            <button type="button" className="stx-ap-btn-secondary" style={{ marginTop: 12 }} onClick={() => setAdicionando(false)}>Cancelar</button>
          </div>
        </div>
      )}
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

      {maquinaEmEdicao && painel.periodoAtual && fluxoAtual === "escolha" && (
        <EscolhaFluxoModal
          maquinaNome={maquinaEmEdicao.nome}
          periodoNome={painel.periodoAtual.nome}
          periodoHorario={`${painel.periodoAtual.inicio}–${painel.periodoAtual.fim}`}
          onRegistrarProducao={() => setFluxoAtual("producao")}
          onSemProducao={() => setFluxoAtual("sem_producao")}
          onFechar={fecharFluxo}
        />
      )}

      {fechamentoAberto && periodoDoFechamento && (
        <FechamentoPeriodoModal data={periodoDoFechamento.data} periodoId={periodoDoFechamento.id} onFechar={() => { setFechamentoAberto(false); painel.recarregar(); }} />
      )}

      {maquinaEmEdicao && painel.periodoAtual && fluxoAtual === "producao" && (
        <ApontamentoModal
          key={maquinaEmEdicao.id}
          maquinaId={maquinaEmEdicao.id}
          maquinaNome={maquinaEmEdicao.nome}
          periodoNome={painel.periodoAtual.nome}
          periodoHorario={`${painel.periodoAtual.inicio}–${painel.periodoAtual.fim}`}
          funcionariosAtivos={funcionariosAtivosSimples}
          modoRetroativo={periodoSelecionado}
          onFechar={fecharFluxo}
          onApontado={({ maquinaId, produtoNome, quantidadeProduzida }) => {
            painel.marcarMaquinaApontada(maquinaId, produtoNome, quantidadeProduzida);
          }}
          onProximaMaquina={() => irParaProximaPendente(maquinaEmEdicao.id)}
          temProximaPendente={!!proximaPendente(maquinaEmEdicao.id)}
        />
      )}

      {maquinaEmEdicao && painel.periodoAtual && fluxoAtual === "sem_producao" && (
        <SemProducaoModal
          key={maquinaEmEdicao.id}
          maquinaId={maquinaEmEdicao.id}
          maquinaNome={maquinaEmEdicao.nome}
          periodoNome={painel.periodoAtual.nome}
          periodoHorario={`${painel.periodoAtual.inicio}–${painel.periodoAtual.fim}`}
          modoRetroativo={periodoSelecionado}
          onFechar={fecharFluxo}
          onRegistrado={({ maquinaId, motivo }) => {
            painel.marcarMaquinaSemProducao(maquinaId, motivo);
          }}
          onProximaMaquina={() => irParaProximaPendente(maquinaEmEdicao.id)}
          temProximaPendente={!!proximaPendente(maquinaEmEdicao.id)}
        />
      )}

      {regularizacaoAberta && (
        <RegularizacaoHistoricaModal dataInicial={painel.periodoAtual?.data} periodoInicial={painel.periodoAtual?.id} onFechar={() => { setRegularizacaoAberta(false); painel.recarregar(); }} />
      )}

      {apontamentoResumo && (
        <ResumoApontamentoModal
          key={apontamentoResumo.id}
          apontamento={apontamentoResumo}
          funcionariosAtivos={funcionariosAtivosSimples}
          podeConverterStatus={temPermissao(auth.usuarioLogado, "producao_real_apontamentos_realizados")}
          onFechar={() => setApontamentoResumo(null)}
          onEditado={(id, patch) => {
            const anterior = apontamentoResumo;
            setApontamentoResumo((prev) => (prev && prev.id === id ? { ...prev, ...patch } : prev));
            if (!anterior) return;
            const statusFinal = patch.status ?? anterior.status;
            if (statusFinal === "produzindo") {
              painel.marcarMaquinaApontada(
                anterior.maquinaId,
                patch.produtoNome ?? anterior.produtoNome ?? "",
                patch.quantidadeProduzida ?? anterior.quantidadeProduzida
              );
            } else if (statusFinal === "sem_producao") {
              painel.marcarMaquinaSemProducao(anterior.maquinaId, patch.motivoSemProducao ?? anterior.motivoSemProducao ?? "");
            }
          }}
          onExcluido={() => {
            if (apontamentoResumo) painel.marcarMaquinaPendente(apontamentoResumo.maquinaId);
            setApontamentoResumo(null);
          }}
        />
      )}

      {seletorPeriodoAberto && (
        <PeriodoSeletorModal
          periodos={cadastrosBase.periodos}
          onFechar={() => setSeletorPeriodoAberto(false)}
          onSelecionar={(data, periodoId) => {
            setPeriodoSelecionado({ data, periodoId });
            setSeletorPeriodoAberto(false);
          }}
        />
      )}

      {abrirOcorrenciaAberto && (
        <AbrirOcorrenciaModal
          maquinasDisponiveis={maquinasSemOcorrenciaAberta}
          funcionariosAtivos={funcionariosAtivosSimples}
          onFechar={() => setAbrirOcorrenciaAberto(false)}
          onAberta={(maquinaId, ocorrencia) => painel.marcarOcorrenciaAberta(maquinaId, ocorrencia)}
        />
      )}

      {maquinaEncerrando?.ocorrenciaAberta && (
        <EncerrarOcorrenciaModal
          maquinaId={maquinaEncerrando.id}
          maquinaNome={maquinaEncerrando.nome}
          ocorrencia={maquinaEncerrando.ocorrenciaAberta}
          onFechar={() => setMaquinaEncerrandoId(null)}
          onEncerrada={(maquinaId) => painel.marcarOcorrenciaEncerrada(maquinaId)}
        />
      )}
    </div>
  );
}
