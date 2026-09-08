"use client";

// Visão Geral da Produção Real V1 — camada executiva sobre os motores já
// existentes (Indicadores, Paradas, Desvios, Validação da Previsão,
// ocorrências de máquina). Responde em poucos segundos: como está a
// fábrica, o que merece atenção, estamos no caminho de cumprir a semana?
// Nenhuma fórmula nova — só composição (ver
// features/producao-real/visao-geral/index.ts).

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthSession } from "@/hooks/useAuthSession";
import { useCadastrosBase } from "@/hooks/useCadastrosBase";
import { useFuncionarios } from "@/hooks/useFuncionarios";
import { useMaquinas } from "@/hooks/useMaquinas";
import { useProdutos } from "@/hooks/useProdutos";
import { usePrevisoes } from "@/hooks/usePrevisoes";
import { useCustos } from "@/hooks/useCustos";
import { useIndicadoresJanelaHistorica } from "@/hooks/useIndicadoresJanelaHistorica";
import { useOcorrenciasAbertas } from "@/hooks/useOcorrenciasAbertas";
import { useSidebarState } from "@/hooks/useSidebarState";
import { calcularPeriodosComDuracao } from "@/lib/calculations/periodos";
import { selecionarSemana, calcularResumoSemana } from "@/features/capacidade/selectors";
import { gerarVisaoGeralProducaoReal } from "@/features/producao-real/visao-geral";
import SaudeFabricaCards from "@/features/producao-real/visao-geral/components/SaudeFabricaCards";
import SituacaoSemanaCard from "@/features/producao-real/visao-geral/components/SituacaoSemanaCard";
import OcorrenciasAbertasCard from "@/features/producao-real/visao-geral/components/OcorrenciasAbertasCard";
import PrincipaisAtencoes from "@/features/producao-real/visao-geral/components/PrincipaisAtencoes";
import ParadasResumoCard from "@/features/producao-real/visao-geral/components/ParadasResumoCard";
import RecursoPressionadoCard from "@/features/producao-real/visao-geral/components/RecursoPressionadoCard";
import LoginScreen from "@/components/shell/LoginScreen";
import RecoveryPasswordScreen from "@/components/shell/RecoveryPasswordScreen";
import Sidebar from "@/components/shell/Sidebar";
import TopBarActions from "@/components/shell/TopBarActions";
import AccountModal from "@/components/shell/AccountModal";
import AcessoNegado from "@/components/shell/AcessoNegado";
import GlobalStyles from "@/components/shell/GlobalStyles";
import { THEMES } from "@/lib/constants";
import { temPermissao } from "@/lib/permissoes";
import { formatBRL, setModoPrivadoAtivo, toNumber } from "@/lib/format";
import { toISODate, mondayOf } from "@/lib/date";
import { calcularTotalFixoAtivo, calcularTotalCustoFuncionariosAtivos, calcularMetaFaturamento } from "@/features/custo-hora/calculations";

const JANELA_HISTORICA_BUSCA_DIAS = 28; // superset — cobre semana atual (Saúde/Paradas), 28 dias (Desvios) e os últimos 14 (Validação, recortados explicitamente no orquestrador).

export default function VisaoGeralPage() {
  const router = useRouter();
  const [tema, setTema] = useState<"dark" | "light">("dark");
  const cores = THEMES[tema];
  const [modoPrivado, setModoPrivado] = useState(false);
  function toggleModoPrivado() {
    const next = !modoPrivado;
    setModoPrivadoAtivo(next);
    setModoPrivado(next);
  }
  const shell = useSidebarState("prVisaoGeral");

  const auth = useAuthSession();
  const cadastrosBase = useCadastrosBase(auth.autenticado);
  const { periodos, diasUteisSemana } = cadastrosBase;
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

  const carregandoCadastros =
    cadastrosBase.loading || funcionariosHook.loading || maquinasHook.loading || produtosHook.loading || previsoesHook.loading || custosHook.loading;

  // Só producao_real_historico (§1, aprovado) — nunca
  // temAlgumaPermissaoProducaoReal, nenhuma permissão nova.
  const podeVer = auth.autenticado && !carregandoCadastros && temPermissao(auth.usuarioLogado, "producao_real_historico");

  const janelaHook = useIndicadoresJanelaHistorica();
  const ocorrenciasHook = useOcorrenciasAbertas(podeVer);

  const [jaBuscouUmaVez, setJaBuscouUmaVez] = useState(false);
  useEffect(() => {
    if (!podeVer || jaBuscouUmaVez) return;
    setJaBuscouUmaVez(true);
    janelaHook.buscar(JANELA_HISTORICA_BUSCA_DIAS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [podeVer, jaBuscouUmaVez]);

  const periodosComDuracao = useMemo(() => calcularPeriodosComDuracao(periodos), [periodos]);
  const funcionariosAtivos = useMemo(() => funcionarios.filter((f) => f.ativo), [funcionarios]);
  const totalFixo = useMemo(() => calcularTotalFixoAtivo(fixedCosts), [fixedCosts]);
  const totalCustoFuncionariosAtivos = useMemo(() => calcularTotalCustoFuncionariosAtivos(funcionariosAtivos), [funcionariosAtivos]);
  const [semanaAtual] = useState(() => toISODate(mondayOf(new Date())));
  const semanaAtualRec = useMemo(() => selecionarSemana(previsoes, semanaAtual), [previsoes, semanaAtual]);
  const resumoSemana = useMemo(() => calcularResumoSemana(semanaAtualRec), [semanaAtualRec]);
  const custoTotalMensalAtual = totalFixo + totalCustoFuncionariosAtivos;
  const { metaInvalida, faturamentoSemanalNecessario } = useMemo(() => calcularMetaFaturamento(custoTotalMensalAtual, 20), [custoTotalMensalAtual]);
  const metaSemanalUsaPrevisto = resumoSemana.valorPrevisto > 0;
  const metaSemanalFinal = metaSemanalUsaPrevisto ? resumoSemana.valorPrevisto : faturamentoSemanalNecessario;

  // Snapshot de "agora" fixado na montagem — mesma disciplina de
  // "semanaAtual" acima: sem polling novo, o valor só muda se a página
  // recarregar.
  const [agora] = useState(() => new Date());

  const resultado = useMemo(
    () =>
      gerarVisaoGeralProducaoReal(
        janelaHook.apontamentos, janelaHook.paradas, semanaAtualRec, produtos, maquinas, periodosComDuracao,
        toNumber(diasUteisSemana), ocorrenciasHook.ocorrencias, agora
      ),
    [janelaHook.apontamentos, janelaHook.paradas, semanaAtualRec, produtos, maquinas, periodosComDuracao, diasUteisSemana, ocorrenciasHook.ocorrencias, agora]
  );

  if (auth.emModoRecovery) {
    return (
      <div className="stx-root">
        <GlobalStyles cores={cores} />
        <RecoveryPasswordScreen
          tema={tema} novaSenha={auth.novaSenhaRecovery} setNovaSenha={auth.setNovaSenhaRecovery}
          confirmarSenha={auth.confirmarSenhaRecovery} setConfirmarSenha={auth.setConfirmarSenhaRecovery}
          mensagem={auth.recoveryMsg} salvando={auth.recoverySalvando} sucesso={auth.recoverySucesso}
          onSubmit={auth.definirNovaSenhaRecovery} onContinuar={auth.concluirRecovery}
        />
      </div>
    );
  }

  if (carregandoCadastros || auth.restaurandoSessao || !auth.autenticado) {
    return (
      <div className="stx-root">
        <GlobalStyles cores={cores} />
        <LoginScreen
          loading={auth.restaurandoSessao || (auth.autenticado && carregandoCadastros)} tema={tema}
          loginUsuario={auth.loginUsuario} setLoginUsuario={auth.setLoginUsuario}
          loginSenha={auth.loginSenha} setLoginSenha={auth.setLoginSenha}
          loginErro={auth.loginErro} loginCarregando={auth.loginCarregando}
          onSubmit={auth.handleLogin} campoLogin="email"
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
            abaAtiva="prVisaoGeral" onNavigateTab={(key) => { router.push(`/?aba=${key}`); }}
            gruposAbertos={shell.gruposAbertos} toggleGrupo={shell.toggleGrupo} usuarioLogado={auth.usuarioLogado}
            metaSemanalUsaPrevisto={metaSemanalUsaPrevisto} metaInvalida={metaInvalida} metaSemanalFinal={metaSemanalFinal}
            formatBRL={formatBRL} onMetaClick={() => { router.push("/"); }}
            onAbrirMinhaConta={auth.abrirMinhaConta} onSair={() => auth.handleLogout()}
            recolhida={shell.recolhida} onToggleRecolhida={shell.toggleRecolhida}
            gavetaAberta={shell.gavetaAberta} onFecharGaveta={shell.fecharGaveta}
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
          abaAtiva="prVisaoGeral" onNavigateTab={(key) => { router.push(`/?aba=${key}`); }}
          gruposAbertos={shell.gruposAbertos} toggleGrupo={shell.toggleGrupo} usuarioLogado={auth.usuarioLogado}
          metaSemanalUsaPrevisto={metaSemanalUsaPrevisto} metaInvalida={metaInvalida} metaSemanalFinal={metaSemanalFinal}
          formatBRL={formatBRL} onMetaClick={() => { router.push("/"); }}
          onAbrirMinhaConta={auth.abrirMinhaConta} onSair={() => auth.handleLogout()}
          recolhida={shell.recolhida} onToggleRecolhida={shell.toggleRecolhida}
          gavetaAberta={shell.gavetaAberta} onFecharGaveta={shell.fecharGaveta}
        />

        <div className="stx-content-wrapper">
          <TopBarActions
            modoPrivado={modoPrivado} onToggleModoPrivado={toggleModoPrivado} tema={tema}
            onToggleTema={() => setTema((t) => (t === "dark" ? "light" : "dark"))}
            usuarioLogado={auth.usuarioLogado}
            abaAtiva="prVisaoGeral"
            onAbrirMenu={shell.abrirGaveta}
          />
          {janelaHook.erro && <p className="stx-save-error">{janelaHook.erro}</p>}
          {ocorrenciasHook.erro && <p className="stx-save-error">{ocorrenciasHook.erro}</p>}

          {janelaHook.loading || !janelaHook.buscou ? (
            <div className="stx-empty">Carregando…</div>
          ) : (
            <div className="stx-vg-grid">
              <div className="stx-vg-primary">
                <div className="stx-vg-window-row">
                  <div>
                    <p className="stx-vg-window-label">
                      {resultado.factoryHealth.janela.rotulo} ({resultado.factoryHealth.janela.dataInicial.split("-").reverse().join("/")} – {resultado.factoryHealth.janela.dataFinal.split("-").reverse().join("/")}) · composição dos domínios já existentes, nada recalculado aqui
                    </p>
                    <h1 className="stx-vg-h1">Visão geral</h1>
                  </div>
                  <span className="stx-vg-week-pill">Semana atual</span>
                </div>

                <SaudeFabricaCards health={resultado.factoryHealth} drillDown={resultado.drillDown.produtividade} />
                <SituacaoSemanaCard forecast={resultado.forecast} />
                <PrincipaisAtencoes incidentes={resultado.attentionItems} />
              </div>

              <div className="stx-vg-context">
                <OcorrenciasAbertasCard ocorrencias={resultado.openOccurrences} />
                <ParadasResumoCard downtime={resultado.downtime} drillDown={resultado.drillDown.paradas} />
                <RecursoPressionadoCard recurso={resultado.pressuredResource} />
              </div>
            </div>
          )}
        </div>
      </div>

      <AccountModal
        usuarioLogado={auth.usuarioLogado} aberta={auth.minhaContaAberta} onFechar={() => auth.setMinhaContaAberta(false)}
        minhaSenhaAtual={auth.minhaSenhaAtual} setMinhaSenhaAtual={auth.setMinhaSenhaAtual}
        minhaSenhaNova={auth.minhaSenhaNova} setMinhaSenhaNova={auth.setMinhaSenhaNova}
        minhaSenhaConfirma={auth.minhaSenhaConfirma} setMinhaSenhaConfirma={auth.setMinhaSenhaConfirma}
        minhaContaMsg={auth.minhaContaMsg} onSalvar={auth.alterarMinhaSenha}
      />
    </div>
  );
}
