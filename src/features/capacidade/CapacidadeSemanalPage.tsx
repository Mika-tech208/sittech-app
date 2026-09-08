"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthSession } from "@/hooks/useAuthSession";
import { useCadastrosBase } from "@/hooks/useCadastrosBase";
import { useFuncionarios } from "@/hooks/useFuncionarios";
import { useMaquinas } from "@/hooks/useMaquinas";
import { useProdutos } from "@/hooks/useProdutos";
import { usePrevisoes } from "@/hooks/usePrevisoes";
import { useCustos } from "@/hooks/useCustos";
import { useSidebarState } from "@/hooks/useSidebarState";
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
  calcularItensSemanaAgregados, calcularCapacidadeInicialPorMaquina, calcularAlocacaoSemanal,
} from "@/features/capacidade/calculations";
import type { Produto } from "@/types/domain";

export default function CapacidadeSemanalPage() {
  const router = useRouter();
  const [tema, setTema] = useState<"dark" | "light">("dark");
  const cores = THEMES[tema];
  const [modoPrivado, setModoPrivado] = useState(false);
  function toggleModoPrivado() {
    const next = !modoPrivado;
    setModoPrivadoAtivo(next);
    setModoPrivado(next);
  }
  const shell = useSidebarState("capacidade");

  const auth = useAuthSession();
  // periodos/diasUteis/diasUteisSemana/operacoes são cadastro-base — vêm do
  // Supabase, mesma fonte usada em /produtos, /maquinas, /custo-hora, /previsao.
  const cadastrosBase = useCadastrosBase(auth.autenticado);
  const { periodos, diasUteis, diasUteisSemana, operacoes } = cadastrosBase;
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

  const periodosComDuracao = useMemo(() => calcularPeriodosComDuracao(periodos), [periodos]);
  const periodosValidos = useMemo(() => filtrarPeriodosValidos(periodosComDuracao), [periodosComDuracao]);
  const horasPorDiaCalc = useMemo(() => calcularHorasPorDia(periodosValidos), [periodosValidos]);
  const duracaoMediaPeriodo = calcularDuracaoMediaPeriodo(periodosValidos, horasPorDiaCalc);
  const horasPorMaquinaSemana = calcularHorasPorMaquinaSemana(horasPorDiaCalc, toNumber(diasUteisSemana));

  const funcionariosAtivos = useMemo(() => funcionarios.filter((f) => f.ativo), [funcionarios]);
  const totalFixo = useMemo(() => calcularTotalFixoAtivo(fixedCosts), [fixedCosts]);
  const totalCustoFuncionariosAtivos = useMemo(
    () => calcularTotalCustoFuncionariosAtivos(funcionariosAtivos),
    [funcionariosAtivos]
  );
  const { custoHoraPorOperacao, custoHoraEmpresa } = useMemo(
    () => calcularCustoHoraEOperacoes(funcionarios, fixedCosts, horasPorDiaCalc, diasUteis),
    [funcionarios, fixedCosts, horasPorDiaCalc, diasUteis]
  );
  const getLucroHora = (produto: Produto) => calcularMargemProduto(produto, custoHoraPorOperacao, custoHoraEmpresa, periodosComDuracao).lucroHora;

  const [semanaAtual, setSemanaAtual] = useState(() => toISODate(mondayOf(new Date())));
  const semanaAtualRec = useMemo(() => selecionarSemana(previsoes, semanaAtual), [previsoes, semanaAtual]);
  const resumoSemana = useMemo(() => calcularResumoSemana(semanaAtualRec), [semanaAtualRec]);

  const custoTotalMensalAtual = totalFixo + totalCustoFuncionariosAtivos;
  const { metaInvalida, faturamentoSemanalNecessario } = useMemo(
    () => calcularMetaFaturamento(custoTotalMensalAtual, 20),
    [custoTotalMensalAtual]
  );
  const metaSemanalUsaPrevisto = resumoSemana.valorPrevisto > 0;
  const metaSemanalFinal = metaSemanalUsaPrevisto ? resumoSemana.valorPrevisto : faturamentoSemanalNecessario;

  const itensSemanaAgregados = useMemo(() => calcularItensSemanaAgregados(semanaAtualRec.itens), [semanaAtualRec]);
  const capacidadeInicialPorMaquina = useMemo(
    () => calcularCapacidadeInicialPorMaquina(maquinas, semanaAtualRec.maquinasIndisponiveis || [], horasPorMaquinaSemana),
    [maquinas, horasPorMaquinaSemana, semanaAtualRec]
  );
  const alocacaoSemanal = useMemo(
    () => calcularAlocacaoSemanal(
      itensSemanaAgregados, semanaAtualRec.itens, produtos, capacidadeInicialPorMaquina, periodosComDuracao, maquinas, operacoes,
      horasPorMaquinaSemana, duracaoMediaPeriodo, getLucroHora
    ),
    [itensSemanaAgregados, semanaAtualRec, produtos, capacidadeInicialPorMaquina, periodosComDuracao, custoHoraPorOperacao, custoHoraEmpresa, maquinas, operacoes, horasPorMaquinaSemana, duracaoMediaPeriodo]
  );

  // ---- estatísticas do resumo — puras contagens/somas sobre alocacaoSemanal
  // já calculada acima (calcularAlocacaoSemanal), nenhuma fórmula nova.
  // "Fora da alocação" = itens previstos que não conseguiram nenhuma peça
  // alocada (subconjunto mais severo de comDeficit, mesmo dado já presente
  // em resultados[].quantidadeAlocada/quantidade). "Horas ociosas" = soma
  // do restante>0 de usoPorOperacao, já calculado por operação.
  const capAtendidosCount = alocacaoSemanal.resumo.atendidos.length;
  const capComDeficitCount = alocacaoSemanal.resumo.comDeficit.length;
  const capForaDaAlocacaoCount = useMemo(
    () => alocacaoSemanal.resultados.filter((r) => r.quantidade > 0 && r.quantidadeAlocada === 0).length,
    [alocacaoSemanal]
  );
  const capHorasOciosas = useMemo(
    () => alocacaoSemanal.usoPorOperacao.reduce((s, u) => s + Math.max(0, u.restante), 0),
    [alocacaoSemanal]
  );

  async function toggleMaquinaIndisponivelSemana(maquinaId: string) {
    const atuais = semanaAtualRec.maquinasIndisponiveis || [];
    const novos = atuais.includes(maquinaId) ? atuais.filter((id) => id !== maquinaId) : [...atuais, maquinaId];
    await previsoesHook.upsertSemana(semanaAtual, { maquinasIndisponiveis: novos });
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

  if (!temPermissao(auth.usuarioLogado, "capacidade")) {
    return (
      <div className="stx-root">
        <GlobalStyles cores={cores} />
        <div className="stx-layout">
          <Sidebar
            tema={tema}
            abaAtiva="capacidade"
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

  return (
    <div className="stx-root">
      <GlobalStyles cores={cores} />
      <div className="stx-layout">
        <Sidebar
          tema={tema}
          abaAtiva="capacidade"
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
            abaAtiva="capacidade"
            onAbrirMenu={shell.abrirGaveta}
          />
          <div className="stx-cap-header">
            <div>
              <div className="stx-cap-week-nav">
                <button className="stx-cap-week-pill" onClick={() => setSemanaAtual(shiftWeek(semanaAtual, -1))}>‹</button>
                <span className="stx-cap-week-label">{weekLabel(semanaAtual)}</span>
                <button className="stx-cap-week-pill" onClick={() => setSemanaAtual(shiftWeek(semanaAtual, 1))}>›</button>
              </div>
              <h1 className="stx-cap-h1">Capacidade semanal</h1>
            </div>
          </div>

          {cadastrosBase.erro && <p className="stx-save-error">{cadastrosBase.erro}</p>}
          {funcionariosHook.erro && <p className="stx-save-error">{funcionariosHook.erro}</p>}
          {maquinasHook.erro && <p className="stx-save-error">{maquinasHook.erro}</p>}
          {produtosHook.erro && <p className="stx-save-error">{produtosHook.erro}</p>}
          {previsoesHook.erro && <p className="stx-save-error">{previsoesHook.erro}</p>}
          {custosHook.erro && <p className="stx-save-error">{custosHook.erro}</p>}

          {itensSemanaAgregados.length === 0 ? (
            <div className="stx-empty">Nenhum item previsto pra {weekLabel(semanaAtual).replace("Semana de ", "")} ainda. Lance em &quot;Previsão semanal&quot;.</div>
          ) : (
            <>
              <div className="stx-cap-resumo">
                {alocacaoSemanal.resumo.atendidos.length > 0 && (
                  <p className="stx-cap-resumo-linha">
                    <span className="stx-cap-resumo-icone on">✓</span>
                    <span>
                      <b>{alocacaoSemanal.resumo.atendidos.map((r) => r.produtoNome).join(", ")}</b> {alocacaoSemanal.resumo.atendidos.length > 1 ? "foram priorizados" : "foi priorizado"} e saem 100% da previsão — {alocacaoSemanal.resumo.atendidos.length > 1 ? "são" : "é"} quem dá mais lucro por hora de máquina usada.
                    </span>
                  </p>
                )}
                {alocacaoSemanal.resumo.comDeficit.map((r) => (
                  <p className="stx-cap-resumo-linha" key={r.produtoId}>
                    <span className="stx-cap-resumo-icone danger">✕</span>
                    <span>
                      <b>{r.produtoNome}</b> ficou faltando <b>{Math.ceil(r.deficit)}</b> peça{Math.ceil(r.deficit) > 1 ? "s" : ""}
                      {r.gargalo ? ` — travado pela capacidade de "${r.gargalo}"` : r.semFluxo ? " — sem fluxo de produção cadastrado" : ""}.
                    </span>
                  </p>
                ))}
                {alocacaoSemanal.resumo.operacoesComSobra.length > 0 && (
                  <p className="stx-cap-resumo-linha">
                    <span className="stx-cap-resumo-icone">ℹ</span>
                    <span>
                      Sobrou capacidade sem uso em{" "}
                      <b>{alocacaoSemanal.resumo.operacoesComSobra.map((u) => `${u.operacao} (${u.restante.toFixed(1)}h)`).join(", ")}</b>
                      {" "}— se tiver outro produto que passe por aí, vale lançar mais previsto pra aproveitar essa hora de máquina em vez de deixar parada.
                    </span>
                  </p>
                )}
                {alocacaoSemanal.resumo.comDeficit.length === 0 && alocacaoSemanal.resumo.operacoesComSobra.length === 0 && (
                  <p className="stx-cap-resumo-linha">
                    <span className="stx-cap-resumo-icone on">✓</span>
                    <span>Capacidade batendo certinho com a previsão dessa semana, sem sobra nem falta relevante.</span>
                  </p>
                )}
              </div>

              <div className="stx-cap-hero-row">
                <div>
                  <p className="stx-cap-hero-label">Atendidos por completo</p>
                  <p className="stx-cap-hero-value">{capAtendidosCount}</p>
                </div>
                <div>
                  <p className="stx-cap-hero-label">Com déficit</p>
                  <p className="stx-cap-sec-value" style={{ color: "var(--warning)" }}>{capComDeficitCount}</p>
                </div>
                <div>
                  <p className="stx-cap-hero-label">Fora da alocação</p>
                  <p className="stx-cap-sec-value" style={{ color: "var(--danger)" }}>{capForaDaAlocacaoCount}</p>
                </div>
                <div>
                  <p className="stx-cap-hero-label">Horas ociosas</p>
                  <p className="stx-cap-sec-value">{capHorasOciosas.toFixed(0)}h</p>
                </div>
              </div>

              <div className="stx-cap-grid">
                <div className="stx-cap-primary">
                  <div className="stx-cap-section">
                    <div className="stx-cap-section-head">
                      <h2 className="stx-cap-section-title">Alocação por produto</h2>
                      <span className="stx-cap-ref">ordenado pelo maior lucro/hora</span>
                    </div>
                    <div className="stx-cap-table-head">
                      <span>Produto</span>
                      <span className="num">Lucro/hora</span>
                      <span className="num">Previsto</span>
                      <span className="num">Alocado</span>
                      <span className="num">Situação</span>
                    </div>
                    {alocacaoSemanal.resultados.map((r) => (
                      <div className="stx-cap-table-row" key={r.produtoId}>
                        <span>{r.produtoNome}</span>
                        <span className="num">{r.produto ? `R$ ${getLucroHora(r.produto).toFixed(0)}` : "—"}</span>
                        <span className="num">{r.quantidade}</span>
                        <span className="num" style={r.deficit > 0 ? { color: "var(--warning)" } : undefined}>{Math.floor(r.quantidadeAlocada)}</span>
                        <span className="num" style={{ color: r.semProduto || r.semFluxo ? "var(--text-3)" : r.deficit > 0 ? (r.quantidadeAlocada === 0 ? "var(--danger)" : "var(--warning)") : "var(--accent)" }}>
                          {r.semProduto ? "produto excluído" : r.semFluxo ? "sem fluxo" : r.deficit === 0 ? "Atendido" : r.quantidadeAlocada === 0 ? "Sem capacidade" : `Déficit ${Math.ceil(r.deficit)}`}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="stx-cap-section">
                    <h2 className="stx-cap-section-title">Capacidade por operação</h2>
                    {alocacaoSemanal.usoPorOperacao.length === 0 ? (
                      <div className="stx-empty">Cadastre máquinas na aba Máquinas pra ver a capacidade aqui.</div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 16 }}>
                        {alocacaoSemanal.usoPorOperacao.map((u) => {
                          const pct = u.total > 0 ? Math.min(100, (u.usado / u.total) * 100) : 0;
                          return (
                            <div key={u.operacao}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 14, marginBottom: 8 }}>
                                <span>{u.operacao}</span>
                                <span style={{ color: "var(--text-2)" }}>{u.usado.toFixed(1)}h de {u.total.toFixed(1)}h · <b style={{ color: u.restante < 0 ? "var(--danger)" : "var(--text)" }}>{u.total > 0 ? `${((u.usado / u.total) * 100).toFixed(0)}%` : "—"}</b></span>
                              </div>
                              <div className="stx-prev-bar-track">
                                <div className="stx-prev-bar-fill" style={{ width: `${pct}%`, background: u.restante < 0 ? "var(--danger)" : "var(--accent-deep)" }} />
                              </div>
                              <p className="stx-cap-ref" style={{ marginTop: 6 }}>
                                {u.usado <= 0.01
                                  ? "nenhuma máquina precisa rodar essa semana"
                                  : [
                                      u.maquinasIntegrais > 0 ? `${u.maquinasIntegrais} máquina${u.maquinasIntegrais > 1 ? "s" : ""} rodando a semana inteira` : null,
                                      u.horasParcial > 0.05 ? `mais 1 máquina por ${u.horasParcial.toFixed(1)}h` : null,
                                    ].filter(Boolean).join(" + ")}
                                {" "}({u.numMaquinas} cadastrada{u.numMaquinas > 1 ? "s" : ""})
                                {u.restante > 0.01 && ` · ${u.restante.toFixed(1)}h ociosas`}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                <div className="stx-cap-context">
                  <div>
                    <div className="stx-cap-section-head">
                      <h2 className="stx-cap-section-title" style={{ fontSize: 15 }}>Máquinas nesta semana</h2>
                    </div>
                    <p className="stx-cap-ref" style={{ margin: "-6px 0 14px" }}>
                      Vale só pra essa semana — o cadastro permanente não muda.
                    </p>
                    {operacoes.map((op) => {
                      const maquinasDaOp = maquinas.filter((m) => m.operacao === op && m.ativo);
                      if (maquinasDaOp.length === 0) return null;
                      return (
                        <div key={op} style={{ marginBottom: 14 }}>
                          <p className="stx-cap-ref" style={{ marginBottom: 6 }}>{op}</p>
                          {maquinasDaOp.map((m) => {
                            const indisponivel = (semanaAtualRec.maquinasIndisponiveis || []).includes(m.id);
                            return (
                              <label className="stx-cap-toggle-row" key={m.id}>
                                <span style={indisponivel ? { color: "var(--text-3)" } : undefined}>{m.nome}</span>
                                <span className={`stx-cap-toggle ${!indisponivel ? "on" : ""}`} onClick={() => toggleMaquinaIndisponivelSemana(m.id)}>
                                  <span className="stx-cap-toggle-dot" />
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      );
                    })}
                    {maquinas.filter((m) => m.ativo).length === 0 && (
                      <p className="stx-empty">Nenhuma máquina ativa cadastrada — vai na aba Máquinas.</p>
                    )}
                  </div>

                  <div>
                    <h2 className="stx-cap-section-title" style={{ fontSize: 15 }}>Capacidade disponível</h2>
                    <p className="stx-cap-ref" style={{ margin: "8px 0 14px" }}>
                      Cruza o previsto com as máquinas marcadas em cada etapa dos produtos, priorizando maior lucro/hora.
                    </p>
                    <div style={{ maxWidth: 160 }}>
                      <label className="stx-label">Dias úteis nessa semana</label>
                      <input
                        className="stx-input"
                        value={diasUteisSemana}
                        onChange={(e) => cadastrosBase.atualizarConfiguracoesEmpresa({ diasUteisSemana: e.target.value })}
                        placeholder="5"
                        inputMode="decimal"
                      />
                    </div>
                  </div>
                </div>
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
    </div>
  );
}
