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

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { formatarTempoDecorrido } from "@/lib/tempoDecorrido";
import { useAuthSession } from "@/hooks/useAuthSession";
import { useCadastrosBase } from "@/hooks/useCadastrosBase";
import { useFuncionarios } from "@/hooks/useFuncionarios";
import { useFuncionariosElegibilidade } from "@/hooks/useFuncionariosElegibilidade";
import { useMaquinas } from "@/hooks/useMaquinas";
import { useProducaoRealPainel, type EstadoPeriodoMaquina, type PeriodoSelecionado } from "@/hooks/useProducaoRealPainel";
import { useSidebarState } from "@/hooks/useSidebarState";
import ApontamentoModal from "@/features/producao-real/ApontamentoModal";
import EscolhaFluxoModal from "@/features/producao-real/EscolhaFluxoModal";
import SemProducaoModal, { LABEL_MOTIVO_SEM_PRODUCAO } from "@/features/producao-real/SemProducaoModal";
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
import { temPermissao } from "@/lib/permissoes";
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
  const [tema, setTema] = useState<"dark" | "light">("dark");
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

  const totalMaquinas = painel.maquinasView.length;
  const totalFechadas = painel.maquinasView.filter((m) => m.estadoPeriodo !== "pendente").length;
  const tudoFechado = totalMaquinas > 0 && totalFechadas === totalMaquinas;
  const pctFechadas = totalMaquinas > 0 ? (totalFechadas / totalMaquinas) * 100 : 0;

  // Só contagem de estados já presentes em painel.maquinasView — nenhum
  // dado novo, nenhuma busca nova (legenda "N pendentes/apontadas/sem
  // produção" da composição visual).
  const contagemEstados = useMemo(() => {
    let pendentes = 0, apontadas = 0, semProducao = 0;
    painel.maquinasView.forEach((m) => {
      if (m.estadoPeriodo === "pendente") pendentes++;
      else if (m.estadoPeriodo === "apontado") apontadas++;
      else if (m.estadoPeriodo === "sem_producao") semProducao++;
    });
    return { pendentes, apontadas, semProducao };
  }, [painel.maquinasView]);

  // ---- fluxo de "Registrar produção" ----
  // Só ativos aqui — não dá pra escolher um funcionário inativo num
  // apontamento/ocorrência novos (mesma regra de sempre, agora vinda da
  // view em vez da tabela cheia).
  const funcionariosAtivosSimples = useMemo(
    () => funcionariosElegibilidadeHook.funcionarios.filter((f) => f.ativo),
    [funcionariosElegibilidadeHook.funcionarios]
  );
  const [maquinaEmEdicaoId, setMaquinaEmEdicaoId] = useState<string | null>(null);
  // "escolha" = passo 1 (Registrar produção / Sem produção); os outros dois
  // são o formulário de fato, cada um seguindo a escolha.
  const [fluxoAtual, setFluxoAtual] = useState<"escolha" | "producao" | "sem_producao" | null>(null);
  const maquinaEmEdicao = painel.maquinasView.find((m) => m.id === maquinaEmEdicaoId) || null;

  // ---- fluxo de "Ocorrência de máquina" (independente do estadoPeriodo) ----
  const [abrirOcorrenciaAberto, setAbrirOcorrenciaAberto] = useState(false);
  const [maquinaEncerrandoId, setMaquinaEncerrandoId] = useState<string | null>(null);
  const maquinaEncerrando = painel.maquinasView.find((m) => m.id === maquinaEncerrandoId) || null;
  const maquinasSemOcorrenciaAberta = useMemo(
    () => painel.maquinasView.filter((m) => m.estadoMaquina !== "parada").map((m) => ({ id: m.id, nome: m.nome })),
    [painel.maquinasView]
  );

  function abrirEscolha(m: (typeof painel.maquinasView)[number]) {
    if (m.estadoPeriodo !== "pendente") return;
    setMaquinaEmEdicaoId(m.id);
    setFluxoAtual("escolha");
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
    const lista = painel.maquinasView;
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
          {painel.modoRetroativo && (
            <span className="stx-ap-retroativo-badge">Período anterior</span>
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

          {tudoFechado && (
            <div className="stx-ap-completo-banner">✓ Período fechado — todas as máquinas apontadas</div>
          )}

          {painel.erro && <p className="stx-save-error" style={{ marginTop: 16 }}>{painel.erro}</p>}

          {totalMaquinas === 0 ? (
            <div className="stx-empty">Nenhuma máquina ativa cadastrada.</div>
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

              <div className="stx-ap-grid">
                {painel.maquinasView.map((m) => {
                  const parada = m.estadoMaquina === "parada";
                  const fechada = !parada && m.estadoPeriodo !== "pendente";
                  const clicavel = m.estadoPeriodo === "pendente";
                  return (
                    <div
                      key={m.id}
                      role={clicavel ? "button" : undefined}
                      tabIndex={clicavel ? 0 : undefined}
                      className={`stx-ap-tile ${parada ? "parada" : ""} ${fechada ? "fechada" : ""} ${!clicavel ? "stx-ap-tile-static" : ""}`}
                      onClick={() => abrirEscolha(m)}
                      onKeyDown={(e) => { if (clicavel && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); abrirEscolha(m); } }}
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
