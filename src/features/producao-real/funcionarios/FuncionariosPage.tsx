"use client";

// Funcionários V1 — "como as pessoas estão performando dentro de
// contextos realmente comparáveis" (nunca ranking geral). Reaproveita
// obter_indicadores_producao/obter_paradas_producao e o motor de
// src/features/producao-real/funcionarios/ — nenhuma fórmula oficial é
// recalculada aqui.

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuthSession } from "@/hooks/useAuthSession";
import { useCadastrosBase } from "@/hooks/useCadastrosBase";
import { useFuncionarios } from "@/hooks/useFuncionarios";
import { useFuncionariosElegibilidade } from "@/hooks/useFuncionariosElegibilidade";
import { useMaquinas } from "@/hooks/useMaquinas";
import { useProdutos } from "@/hooks/useProdutos";
import { useOperacoesComId } from "@/hooks/useOperacoesComId";
import { usePrevisoes } from "@/hooks/usePrevisoes";
import { useCustos } from "@/hooks/useCustos";
import { useAnaliseFuncionariosProducao } from "@/hooks/useAnaliseFuncionariosProducao";
import { useGruposAbertosSidebar } from "@/hooks/useGruposAbertosSidebar";
import { gerarAnaliseFuncionarios } from "@/features/producao-real/funcionarios";
import ResumoEquipeCards from "@/features/producao-real/funcionarios/components/ResumoEquipeCards";
import CardsSinais from "@/features/producao-real/funcionarios/components/CardsSinais";
import ListaFuncionarios from "@/features/producao-real/funcionarios/components/ListaFuncionarios";
import DetalheFuncionario from "@/features/producao-real/funcionarios/components/DetalheFuncionario";
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
  { key: "atencao", label: "Merecem atenção" },
  { key: "destaques", label: "Destaques positivos" },
  { key: "lista", label: "Lista de funcionários" },
] as const;
type VisaoKey = (typeof VISOES)[number]["key"];

export default function FuncionariosPage() {
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
  const { gruposAbertos, toggleGrupo } = useGruposAbertosSidebar("prFuncionarios");

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

  const analiseHook = useAnaliseFuncionariosProducao();

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
    cadastrosBase.loading || funcionariosHook.loading || funcionariosElegibilidadeHook.loading || maquinasHook.loading ||
    produtosHook.loading || operacoesHook.loading || previsoesHook.loading || custosHook.loading;

  const podeVer = auth.autenticado && !carregandoCadastros && temPermissao(auth.usuarioLogado, "producao_real_historico");

  const [jaBuscouUmaVez, setJaBuscouUmaVez] = useState(false);
  useEffect(() => {
    if (!podeVer || jaBuscouUmaVez) return;
    setJaBuscouUmaVez(true);
    analiseHook.buscar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [podeVer, jaBuscouUmaVez]);

  const [visao, setVisao] = useState<VisaoKey>("atencao");
  const [funcionarioSelecionado, setFuncionarioSelecionado] = useState<string | null>(null);

  // Drill-down vindo de Desvios (§18): produto/operação/máquina via query
  // string filtram o contexto mostrado, sem mudar o comportamento padrão
  // de acesso direto pelo menu (sem query string nenhuma).
  const contextoFiltroUrl = useMemo(() => ({
    produtoId: searchParams.get("produtoId") || undefined,
    maquinaId: searchParams.get("maquinaId") || undefined,
    operacaoId: searchParams.get("operacaoId") || undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  const resultado = useMemo(() => gerarAnaliseFuncionarios(analiseHook.apontamentos, analiseHook.paradas), [analiseHook.apontamentos, analiseHook.paradas]);

  const contextoFiltroAtivo = !!(contextoFiltroUrl.produtoId || contextoFiltroUrl.maquinaId || contextoFiltroUrl.operacaoId);
  const resultadoFiltrado = useMemo(() => {
    if (!contextoFiltroAtivo) return resultado;
    const combina = (c: { produtoId: string; operacaoId: string; maquinaId: string }) =>
      (!contextoFiltroUrl.produtoId || c.produtoId === contextoFiltroUrl.produtoId) &&
      (!contextoFiltroUrl.operacaoId || c.operacaoId === contextoFiltroUrl.operacaoId) &&
      (!contextoFiltroUrl.maquinaId || c.maquinaId === contextoFiltroUrl.maquinaId);
    return {
      ...resultado,
      analises: resultado.analises.filter((a) => combina(a.contexto)),
      atencao: resultado.atencao.filter((s) => combina(s.contexto)),
      destaques: resultado.destaques.filter((s) => combina(s.contexto)),
    };
  }, [resultado, contextoFiltroAtivo, contextoFiltroUrl]);

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
            tema={tema} abaAtiva="prFuncionarios" onNavigateTab={() => { router.push("/"); }}
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
          tema={tema} abaAtiva="prFuncionarios" onNavigateTab={() => { router.push("/"); }}
          gruposAbertos={gruposAbertos} toggleGrupo={toggleGrupo} usuarioLogado={auth.usuarioLogado}
          metaSemanalUsaPrevisto={metaSemanalUsaPrevisto} metaInvalida={metaInvalida} metaSemanalFinal={metaSemanalFinal}
          formatBRL={formatBRL} onMetaClick={() => { router.push("/"); }}
        />

        <div className="stx-content-wrapper">
          <div className="stx-header">
            <div><h1 className="stx-title">Funcionários</h1></div>
            <div className="stx-header-right">
              <TopBarActions
                modoPrivado={modoPrivado} onToggleModoPrivado={toggleModoPrivado} tema={tema}
                onToggleTema={() => setTema((t) => (t === "dark" ? "light" : "dark"))}
                onAbrirMinhaConta={auth.abrirMinhaConta} onSair={() => auth.handleLogout()}
              />
            </div>
          </div>

          <p className="stx-panel-sub" style={{ marginBottom: 8 }}>
            Semana atual até agora, comparada ao mesmo trecho da semana anterior. Sempre por contexto (produto + operação + máquina) — nunca ranking ou nota geral.
            {contextoFiltroAtivo && " Filtrado a partir de um desvio (contexto preservado)."}
          </p>

          {analiseHook.erro && <p className="stx-save-error">{analiseHook.erro}</p>}

          {analiseHook.loading ? (
            <div className="stx-empty">Carregando…</div>
          ) : funcionarioSelecionado ? (
            <DetalheFuncionario funcionarioId={funcionarioSelecionado} resultado={resultadoFiltrado} onFechar={() => setFuncionarioSelecionado(null)} />
          ) : (
            <>
              <ResumoEquipeCards resultado={resultadoFiltrado} />

              <div className="stx-ind-tabs" style={{ marginTop: 12 }}>
                {VISOES.map((v) => (
                  <button key={v.key} type="button" className={`stx-ind-tab ${visao === v.key ? "active" : ""}`} onClick={() => setVisao(v.key)}>
                    {v.label}
                  </button>
                ))}
              </div>

              <div className="stx-panel" style={{ marginTop: 12 }}>
                {visao === "atencao" && <CardsSinais sinais={resultadoFiltrado.atencao} polaridade="atencao" onVerAnalise={setFuncionarioSelecionado} />}
                {visao === "destaques" && <CardsSinais sinais={resultadoFiltrado.destaques} polaridade="positivo" onVerAnalise={setFuncionarioSelecionado} />}
                {visao === "lista" && <ListaFuncionarios resultado={resultadoFiltrado} onSelecionar={setFuncionarioSelecionado} />}
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
