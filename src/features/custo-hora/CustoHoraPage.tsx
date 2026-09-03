"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthSession } from "@/hooks/useAuthSession";
import { useCadastrosBase } from "@/hooks/useCadastrosBase";
import { useFuncionarios } from "@/hooks/useFuncionarios";
import { usePrevisoes } from "@/hooks/usePrevisoes";
import { useCustos } from "@/hooks/useCustos";
import { useGruposAbertosSidebar } from "@/hooks/useGruposAbertosSidebar";
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
import { toISODate, mondayOf } from "@/lib/date";
import {
  calcularPeriodosComDuracao, filtrarPeriodosValidos, calcularHorasPorDia, calcularDuracaoMediaPeriodo, duracaoPeriodoHorasCalc,
} from "@/lib/calculations/periodos";
import {
  calcularTotalFixoAtivo, calcularCustoMensalFuncionario, calcularTotalCustoFuncionariosAtivos,
  calcularCustoHoraEOperacoes, calcularCustoHoraIndividual, calcularCustoHoraSittech, calcularMetaFaturamento,
} from "@/features/custo-hora/calculations";
import { selecionarSemana, calcularResumoSemana } from "@/features/capacidade/selectors";
import type { Funcionario } from "@/types/domain";

export default function CustoHoraPage() {
  const router = useRouter();
  const [tema, setTema] = useState<"dark" | "light">("dark");
  const cores = THEMES[tema];
  const [modoPrivado, setModoPrivado] = useState(false);
  function toggleModoPrivado() {
    const next = !modoPrivado;
    setModoPrivadoAtivo(next);
    setModoPrivado(next);
  }
  const { gruposAbertos, toggleGrupo } = useGruposAbertosSidebar("horaEmpresa");

  const auth = useAuthSession();
  // periodos/diasUteis são cadastro-base — já vêm do Supabase, mesma fonte
  // usada em /produtos, /maquinas, /previsao, /capacidade e na rota "/".
  const cadastrosBase = useCadastrosBase(auth.autenticado);
  // Funcionários dependem dos cadastros-base já carregados (ordem exigida).
  const funcionariosHook = useFuncionarios(auth.autenticado && !cadastrosBase.loading);
  const { funcionarios } = funcionariosHook;
  // Esta tela não usa máquinas nem produtos — previsões/custos só dependem
  // do último hook que ela realmente tem, mantendo a ordem relativa
  // exigida sem introduzir hooks não usados aqui.
  const previsoesHook = usePrevisoes(auth.autenticado && !cadastrosBase.loading && !funcionariosHook.loading);
  const { previsoes } = previsoesHook;
  const custosHook = useCustos(auth.autenticado && !cadastrosBase.loading && !funcionariosHook.loading && !previsoesHook.loading);
  const { fixedCosts } = custosHook;

  const periodosComDuracao = useMemo(() => calcularPeriodosComDuracao(cadastrosBase.periodos), [cadastrosBase.periodos]);
  const periodosValidos = useMemo(() => filtrarPeriodosValidos(periodosComDuracao), [periodosComDuracao]);
  const horasPorDiaCalc = useMemo(() => calcularHorasPorDia(periodosValidos), [periodosValidos]);
  const duracaoMediaPeriodo = calcularDuracaoMediaPeriodo(periodosValidos, horasPorDiaCalc);

  const funcionariosAtivos = useMemo(() => funcionarios.filter((f) => f.ativo), [funcionarios]);
  const totalFixo = useMemo(() => calcularTotalFixoAtivo(fixedCosts), [fixedCosts]);
  const totalCustoFuncionariosAtivos = useMemo(
    () => calcularTotalCustoFuncionariosAtivos(funcionariosAtivos),
    [funcionariosAtivos]
  );
  const horasProdutivasFuncionario = useMemo(() => horasPorDiaCalc * toNumber(cadastrosBase.diasUteis), [horasPorDiaCalc, cadastrosBase.diasUteis]);
  const totalHorasProdutivasEmpresa = useMemo(
    () => horasProdutivasFuncionario * funcionariosAtivos.length,
    [horasProdutivasFuncionario, funcionariosAtivos]
  );
  const custoMedioFuncionarioMensal = funcionariosAtivos.length ? totalCustoFuncionariosAtivos / funcionariosAtivos.length : 0;

  const { custoHoraEmpresa, rateioPorHora, resumoPorOperacao } = useMemo(
    () => calcularCustoHoraEOperacoes(funcionarios, fixedCosts, horasPorDiaCalc, cadastrosBase.diasUteis),
    [funcionarios, fixedCosts, horasPorDiaCalc, cadastrosBase.diasUteis]
  );
  const custoMensalFunc = calcularCustoMensalFuncionario;
  function custoHoraSittech(f: Funcionario) {
    const individual = calcularCustoHoraIndividual(custoMensalFunc(f), horasProdutivasFuncionario);
    return calcularCustoHoraSittech(individual, rateioPorHora);
  }

  // ---- card "Meta semanal" da sidebar — mesma fórmula usada em Previsão/Capacidade ----
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

  if (cadastrosBase.loading || funcionariosHook.loading || previsoesHook.loading || custosHook.loading || auth.restaurandoSessao || !auth.autenticado) {
    return (
      <div className="stx-root">
        <GlobalStyles cores={cores} />
        <LoginScreen
          loading={auth.restaurandoSessao || (auth.autenticado && (cadastrosBase.loading || funcionariosHook.loading || previsoesHook.loading || custosHook.loading))}
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

  if (!temPermissao(auth.usuarioLogado, "custo_hora")) {
    return (
      <div className="stx-root">
        <GlobalStyles cores={cores} />
        <div className="stx-layout">
          <Sidebar
            tema={tema}
            abaAtiva="horaEmpresa"
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
          abaAtiva="horaEmpresa"
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
              <h1 className="stx-title">Custo por hora</h1>
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

          <div className="stx-grid">
            <div>
              <div className="stx-panel">
                <p className="stx-panel-title" style={{ marginBottom: 4 }}>Períodos de trabalho</p>
                <p className="stx-panel-sub">Horário real de cada período (3 no turno da manhã, 3 no da tarde). É a partir daqui que o sistema calcula as horas produtivas.</p>
                {cadastrosBase.periodos.map((p) => (
                  <div className="stx-periodo-row" key={p.id}>
                    <span className="stx-periodo-nome">{p.nome}</span>
                    <input
                      type="time"
                      className="stx-input"
                      value={p.inicio}
                      onChange={(e) => cadastrosBase.atualizarPeriodo(p.id, "inicio", e.target.value)}
                    />
                    <span className="stx-periodo-ate">até</span>
                    <input
                      type="time"
                      className="stx-input"
                      value={p.fim}
                      onChange={(e) => cadastrosBase.atualizarPeriodo(p.id, "fim", e.target.value)}
                    />
                    <span className="stx-periodo-duracao">
                      {duracaoPeriodoHorasCalc(p.inicio, p.fim) > 0 ? `${duracaoPeriodoHorasCalc(p.inicio, p.fim).toFixed(2)}h` : "—"}
                    </span>
                  </div>
                ))}
                <div style={{ marginTop: 14 }}>
                  <label className="stx-label">Dias úteis no mês</label>
                  <input
                    className="stx-input"
                    style={{ maxWidth: 140 }}
                    value={cadastrosBase.diasUteis}
                    onChange={(e) => cadastrosBase.atualizarConfiguracoesEmpresa({ diasUteis: e.target.value })}
                    placeholder="22"
                    inputMode="decimal"
                  />
                </div>
                {cadastrosBase.erro && <p className="stx-save-error">{cadastrosBase.erro}</p>}
                {funcionariosHook.erro && <p className="stx-save-error">{funcionariosHook.erro}</p>}
                {previsoesHook.erro && <p className="stx-save-error">{previsoesHook.erro}</p>}
                {custosHook.erro && <p className="stx-save-error">{custosHook.erro}</p>}
                <div className="stx-rateio-line" style={{ marginTop: 10 }}>
                  <span className="l">Horas produtivas por dia (soma dos períodos)</span>
                  <span className="v">{horasPorDiaCalc.toFixed(2)}h</span>
                </div>
                <div className="stx-rateio-line">
                  <span className="l">Duração média de um período</span>
                  <span className="v">{duracaoMediaPeriodo.toFixed(2)}h</span>
                </div>
                <div className="stx-rateio-line">
                  <span className="l">Horas produtivas por funcionário/mês</span>
                  <span className="v">{horasProdutivasFuncionario.toFixed(1)}h</span>
                </div>
                <div className="stx-rateio-line">
                  <span className="l">Funcionários ativos</span>
                  <span className="v">{funcionariosAtivos.length}</span>
                </div>
                <div className="stx-rateio-line stx-rateio-highlight">
                  <span className="l">Total horas produtivas da empresa/mês</span>
                  <span className="v">{totalHorasProdutivasEmpresa.toFixed(1)}h</span>
                </div>
              </div>

              <div className="stx-panel">
                <p className="stx-panel-title" style={{ marginBottom: 14 }}>Indicadores principais</p>
                <div className="stx-destaque-grid">
                  <div className="stx-destaque-box">
                    <p className="stx-destaque-label">Custo médio / funcionário</p>
                    <p className="stx-destaque-value">{formatBRL(custoMedioFuncionarioMensal)}</p>
                    <p className="stx-destaque-sub">por mês, entre os {funcionariosAtivos.length} ativos</p>
                  </div>
                  <div className="stx-destaque-box">
                    <p className="stx-destaque-label">Custo/hora empresa</p>
                    <p className="stx-destaque-value">{formatBRL(custoHoraEmpresa)}</p>
                    <p className="stx-destaque-sub">mão de obra + fixos ÷ horas produtivas</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="stx-panel">
              <p className="stx-panel-title" style={{ marginBottom: 14 }}>Custo por operação</p>
              {resumoPorOperacao.length === 0 ? (
                <div className="stx-empty">Sem funcionários cadastrados.</div>
              ) : (
                resumoPorOperacao.map((r) => (
                  <div className="stx-op-group" key={r.operacao}>
                    <p className="stx-op-group-title">{r.operacao} · {r.ativosGrupo.length} ativo{r.ativosGrupo.length !== 1 ? "s" : ""}</p>
                    <div className="stx-op-summary">
                      <div className="stx-op-summary-item">
                        <span className="stx-op-summary-label">Custo médio / funcionário</span>
                        <span className="stx-op-summary-value">{formatBRL(r.mediaMensal)}/mês · {formatBRL(r.mediaHora)}/h</span>
                      </div>
                      <div className="stx-op-summary-item">
                        <span className="stx-op-summary-label">Total do grupo</span>
                        <span className="stx-op-summary-value highlight">{formatBRL(r.totalMensalGrupo)}/mês · {formatBRL(r.totalHoraGrupo)}/h</span>
                      </div>
                      <div className="stx-op-summary-item">
                        <span className="stx-op-summary-label">Horas produtivas do grupo</span>
                        <span className="stx-op-summary-value">{r.totalHorasGrupo}h/mês</span>
                      </div>
                    </div>
                    {r.funcionarios.map((f) => (
                      <div className={`stx-op-func-line ${!f.ativo ? "paused" : ""}`} key={f.id}>
                        <span className="n">{f.nome}{!f.ativo ? " (pausado)" : ""}</span>
                        <span className="v">{formatBRL(custoHoraSittech(f))}/h</span>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>
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
