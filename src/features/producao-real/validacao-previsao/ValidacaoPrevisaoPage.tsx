"use client";

// Validação da Previsão V1 — "com o que já produzimos e a capacidade que
// ainda resta, vamos cumprir a previsão desta semana?". Reaproveita
// usePrevisoes (Previsão Semanal, fonte oficial do Realizado intocada),
// obter_indicadores_producao/obter_paradas_producao e o motor de
// Capacidade já existente (src/features/capacidade/calculations.ts) —
// nenhuma fórmula oficial recalculada aqui.

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
import { useGruposAbertosSidebar } from "@/hooks/useGruposAbertosSidebar";
import { calcularPeriodosComDuracao } from "@/lib/calculations/periodos";
import { selecionarSemana, calcularResumoSemana } from "@/features/capacidade/selectors";
import { gerarValidacaoPrevisao, JANELA_HISTORICA_DIAS } from "@/features/producao-real/validacao-previsao";
import ResumoSemanaCards from "@/features/producao-real/validacao-previsao/components/ResumoSemanaCards";
import ListaProdutosComDetalhe from "@/features/producao-real/validacao-previsao/components/ListaProdutosComDetalhe";
import RecursosEEvidencias from "@/features/producao-real/validacao-previsao/components/RecursosEEvidencias";
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

const VISOES = [
  { key: "produtos", label: "Produtos programados" },
  { key: "recursos", label: "Recursos e evidências" },
] as const;
type VisaoKey = (typeof VISOES)[number]["key"];

export default function ValidacaoPrevisaoPage() {
  const router = useRouter();
  const [tema, setTema] = useState<"dark" | "light">("dark");
  const cores = THEMES[tema];
  const [modoPrivado, setModoPrivado] = useState(false);
  function toggleModoPrivado() {
    const next = !modoPrivado;
    setModoPrivadoAtivo(next);
    setModoPrivado(next);
  }
  const { gruposAbertos, toggleGrupo } = useGruposAbertosSidebar("prValidacao");

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

  const janelaHook = useIndicadoresJanelaHistorica();

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

  const carregandoCadastros =
    cadastrosBase.loading || funcionariosHook.loading || maquinasHook.loading || produtosHook.loading || previsoesHook.loading || custosHook.loading;

  // Cruza dois domínios (Previsão + Produção Real) — exige as duas
  // permissões já existentes, nenhuma nova (§1, aprovado).
  const podeVer = auth.autenticado && !carregandoCadastros &&
    temPermissao(auth.usuarioLogado, "previsao") && temPermissao(auth.usuarioLogado, "producao_real_historico");

  const [jaBuscouUmaVez, setJaBuscouUmaVez] = useState(false);
  useEffect(() => {
    if (!podeVer || jaBuscouUmaVez) return;
    setJaBuscouUmaVez(true);
    janelaHook.buscar(JANELA_HISTORICA_DIAS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [podeVer, jaBuscouUmaVez]);

  const [visao, setVisao] = useState<VisaoKey>("produtos");

  const resultado = useMemo(
    () => gerarValidacaoPrevisao(semanaAtualRec, produtos, maquinas, periodosComDuracao, toNumber(diasUteisSemana), janelaHook.apontamentos, janelaHook.paradas),
    [semanaAtualRec, produtos, maquinas, periodosComDuracao, diasUteisSemana, janelaHook.apontamentos, janelaHook.paradas]
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

  if (!temPermissao(auth.usuarioLogado, "previsao") || !temPermissao(auth.usuarioLogado, "producao_real_historico")) {
    return (
      <div className="stx-root">
        <GlobalStyles cores={cores} />
        <div className="stx-layout">
          <Sidebar
            tema={tema} abaAtiva="prValidacao" onNavigateTab={() => { router.push("/"); }}
            gruposAbertos={gruposAbertos} toggleGrupo={toggleGrupo} usuarioLogado={auth.usuarioLogado}
            metaSemanalUsaPrevisto={metaSemanalUsaPrevisto} metaInvalida={metaInvalida} metaSemanalFinal={metaSemanalFinal}
            formatBRL={formatBRL} onMetaClick={() => { router.push("/"); }}
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
          tema={tema} abaAtiva="prValidacao" onNavigateTab={() => { router.push("/"); }}
          gruposAbertos={gruposAbertos} toggleGrupo={toggleGrupo} usuarioLogado={auth.usuarioLogado}
          metaSemanalUsaPrevisto={metaSemanalUsaPrevisto} metaInvalida={metaInvalida} metaSemanalFinal={metaSemanalFinal}
          formatBRL={formatBRL} onMetaClick={() => { router.push("/"); }}
        />

        <div className="stx-content-wrapper">
          <div className="stx-header">
            <div><h1 className="stx-title">Validação da Previsão</h1></div>
            <div className="stx-header-right">
              <TopBarActions
                modoPrivado={modoPrivado} onToggleModoPrivado={toggleModoPrivado} tema={tema}
                onToggleTema={() => setTema((t) => (t === "dark" ? "light" : "dark"))}
                onAbrirMinhaConta={auth.abrirMinhaConta} onSair={() => auth.handleLogout()}
              />
            </div>
          </div>

          <p className="stx-panel-sub" style={{ marginBottom: 8 }}>
            Com o que já produzimos e a capacidade que ainda resta, vamos cumprir a previsão desta semana? Nunca altera a Previsão Semanal — só analisa.
          </p>

          {janelaHook.erro && <p className="stx-save-error">{janelaHook.erro}</p>}

          {janelaHook.loading ? (
            <div className="stx-empty">Carregando…</div>
          ) : (
            <>
              <ResumoSemanaCards resultado={resultado} />

              <div className="stx-ind-tabs" style={{ marginTop: 12 }}>
                {VISOES.map((v) => (
                  <button key={v.key} type="button" className={`stx-ind-tab ${visao === v.key ? "active" : ""}`} onClick={() => setVisao(v.key)}>
                    {v.label}
                  </button>
                ))}
              </div>

              <div style={{ marginTop: 12 }}>
                {visao === "produtos" && <ListaProdutosComDetalhe itens={resultado.itens} />}
                {visao === "recursos" && <RecursosEEvidencias resultado={resultado} />}
              </div>
            </>
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
