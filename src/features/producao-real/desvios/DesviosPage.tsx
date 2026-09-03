"use client";

// Desvios V1 — "o que está acontecendo na fábrica que merece atenção".
// Fila automática e priorizável, NUNCA um dashboard a mais. Reutiliza
// somente obter_indicadores_producao/obter_paradas_producao (mesmas RPCs
// de Indicadores V1/Paradas V1) e o motor de detecção em
// src/features/producao-real/desvios/ — nenhuma fórmula oficial é
// recalculada aqui. Janelas (semana atual até agora vs. mesmo trecho da
// anterior; últimos 28 dias vs. 28 anteriores) são automáticas — não há
// campo de data editável no V1 (decisão de escopo mínimo).

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthSession } from "@/hooks/useAuthSession";
import { useCadastrosBase } from "@/hooks/useCadastrosBase";
import { useFuncionarios } from "@/hooks/useFuncionarios";
import { useFuncionariosElegibilidade } from "@/hooks/useFuncionariosElegibilidade";
import { useMaquinas } from "@/hooks/useMaquinas";
import { useProdutos } from "@/hooks/useProdutos";
import { useOperacoesComId } from "@/hooks/useOperacoesComId";
import { usePrevisoes } from "@/hooks/usePrevisoes";
import { useCustos } from "@/hooks/useCustos";
import { useDesviosProducao } from "@/hooks/useDesviosProducao";
import { useGruposAbertosSidebar } from "@/hooks/useGruposAbertosSidebar";
import { gerarFilaDesvios } from "@/features/producao-real/desvios";
import type { DominioDesvio, SeveridadeDesvio } from "@/features/producao-real/desvios/types";
import ResumoDesviosCards from "@/features/producao-real/desvios/components/ResumoDesviosCards";
import FilaDesvios from "@/features/producao-real/desvios/components/FilaDesvios";
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

const DOMINIOS: { key: DominioDesvio | ""; label: string }[] = [
  { key: "", label: "Todos" }, { key: "produtividade", label: "Produtividade" }, { key: "paradas", label: "Paradas" },
  { key: "qualidade", label: "Qualidade" }, { key: "sem_producao", label: "Sem produção" },
  { key: "economia", label: "Economia" }, { key: "fluxo", label: "Fluxo" },
];
const SEVERIDADES: { key: SeveridadeDesvio | ""; label: string }[] = [
  { key: "", label: "Todas" }, { key: "critico", label: "Crítico" }, { key: "atencao", label: "Atenção" }, { key: "informativo", label: "Informativo" },
];

export default function DesviosPage() {
  const router = useRouter();
  const [tema, setTema] = useState<"dark" | "light">("dark");
  const cores = THEMES[tema];
  const [modoPrivado, setModoPrivado] = useState(false);
  function toggleModoPrivado() {
    const next = !modoPrivado;
    setModoPrivadoAtivo(next);
    setModoPrivado(next);
  }
  const { gruposAbertos, toggleGrupo } = useGruposAbertosSidebar("prDesvios");

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

  const desviosHook = useDesviosProducao();

  // ---- card "Meta semanal" da sidebar — mesma fórmula usada em todas as rotas ----
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

  const podeVerDesvios = auth.autenticado && !carregandoCadastros && temPermissao(auth.usuarioLogado, "producao_real_historico");

  const [jaBuscouUmaVez, setJaBuscouUmaVez] = useState(false);
  useEffect(() => {
    if (!podeVerDesvios || jaBuscouUmaVez) return;
    setJaBuscouUmaVez(true);
    desviosHook.buscar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [podeVerDesvios, jaBuscouUmaVez]);

  // ---- filtros client-side (domínio/severidade/contexto) — as janelas
  // em si (operacional/estrutural) são automáticas, sem campo de data no V1 ----
  const [domFiltro, setDomFiltro] = useState<DominioDesvio | "">("");
  const [sevFiltro, setSevFiltro] = useState<SeveridadeDesvio | "">("");
  const [produtoFiltro, setProdutoFiltro] = useState("");
  const [maquinaFiltro, setMaquinaFiltro] = useState("");

  const resultado = useMemo(() => gerarFilaDesvios(desviosHook.apontamentos, desviosHook.paradas), [desviosHook.apontamentos, desviosHook.paradas]);

  const incidentesFiltrados = useMemo(() => {
    return resultado.incidentes.filter((inc) => {
      if (domFiltro && inc.desvioPrincipal.dominio !== domFiltro) return false;
      if (sevFiltro && inc.severidade !== sevFiltro) return false;
      if (produtoFiltro && inc.contexto.produtoId !== produtoFiltro) return false;
      if (maquinaFiltro && inc.contexto.maquinaId !== maquinaFiltro) return false;
      return true;
    });
  }, [resultado.incidentes, domFiltro, sevFiltro, produtoFiltro, maquinaFiltro]);

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
            tema={tema} abaAtiva="prDesvios" onNavigateTab={() => { router.push("/"); }}
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
          tema={tema} abaAtiva="prDesvios" onNavigateTab={() => { router.push("/"); }}
          gruposAbertos={gruposAbertos} toggleGrupo={toggleGrupo} usuarioLogado={auth.usuarioLogado}
          metaSemanalUsaPrevisto={metaSemanalUsaPrevisto} metaInvalida={metaInvalida} metaSemanalFinal={metaSemanalFinal}
          formatBRL={formatBRL} onMetaClick={() => { router.push("/"); }}
        />

        <div className="stx-content-wrapper">
          <div className="stx-header">
            <div><h1 className="stx-title">Desvios</h1></div>
            <div className="stx-header-right">
              <TopBarActions
                modoPrivado={modoPrivado} onToggleModoPrivado={toggleModoPrivado} tema={tema}
                onToggleTema={() => setTema((t) => (t === "dark" ? "light" : "dark"))}
                onAbrirMinhaConta={auth.abrirMinhaConta} onSair={() => auth.handleLogout()}
              />
            </div>
          </div>

          <div className="stx-panel stx-pr-filtros-painel">
            <div className="stx-pr-filtros-grid">
              <div>
                <label className="stx-label">Tipo de desvio</label>
                <select className="stx-select" value={domFiltro} onChange={(e) => setDomFiltro(e.target.value as DominioDesvio | "")}>
                  {DOMINIOS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
                </select>
              </div>
              <div>
                <label className="stx-label">Severidade</label>
                <select className="stx-select" value={sevFiltro} onChange={(e) => setSevFiltro(e.target.value as SeveridadeDesvio | "")}>
                  {SEVERIDADES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label className="stx-label">Produto</label>
                <select className="stx-select" value={produtoFiltro} onChange={(e) => setProdutoFiltro(e.target.value)}>
                  <option value="">Todos</option>
                  {produtosHook.produtos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                </select>
              </div>
              <div>
                <label className="stx-label">Máquina</label>
                <select className="stx-select" value={maquinaFiltro} onChange={(e) => setMaquinaFiltro(e.target.value)}>
                  <option value="">Todas</option>
                  {maquinasHook.maquinas.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
                </select>
              </div>
            </div>
            <p className="stx-panel-sub" style={{ marginTop: 8 }}>
              Janelas automáticas: semana atual até agora vs. mesmo trecho da semana anterior (operacional), e últimos 28 dias vs. 28 dias anteriores (estrutural).
            </p>
          </div>

          {desviosHook.erro && <p className="stx-save-error">{desviosHook.erro}</p>}

          {desviosHook.loading ? (
            <div className="stx-empty">Carregando…</div>
          ) : (
            <>
              <ResumoDesviosCards incidentes={incidentesFiltrados} />
              <div className="stx-panel" style={{ marginTop: 12 }}>
                <p className="stx-panel-title">Fila de atenção</p>
                <FilaDesvios incidentes={incidentesFiltrados} />
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
