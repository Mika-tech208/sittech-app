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
  const { gruposAbertos, toggleGrupo } = useGruposAbertosSidebar("capacidade");

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
          abaAtiva="capacidade"
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
              <h1 className="stx-title">Capacidade semanal</h1>
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

          <div>
            <div className="stx-month-nav" style={{ marginBottom: 18 }}>
              <button className="stx-nav-btn" onClick={() => setSemanaAtual(shiftWeek(semanaAtual, -1))}>‹</button>
              <span className="stx-month-label" style={{ minWidth: 220 }}>{weekLabel(semanaAtual)}</span>
              <button className="stx-nav-btn" onClick={() => setSemanaAtual(shiftWeek(semanaAtual, 1))}>›</button>
            </div>

            <div className="stx-panel">
              <p className="stx-panel-title" style={{ marginBottom: 4 }}>Disponibilidade de máquinas essa semana</p>
              <p className="stx-panel-sub">
                Desmarca as que estão fora de operação só nessa semana (quebrada, em manutenção etc.). Isso não mexe no cadastro
                permanente — a máquina volta a contar sozinha na próxima semana, a não ser que você desmarque de novo.
              </p>
              {operacoes.map((op) => {
                const maquinasDaOp = maquinas.filter((m) => m.operacao === op && m.ativo);
                if (maquinasDaOp.length === 0) return null;
                return (
                  <div key={op} style={{ marginBottom: 12 }}>
                    <p className="stx-op-group-title">{op}</p>
                    <div className="stx-etapa-maquinas">
                      {maquinasDaOp.map((m) => {
                        const indisponivel = (semanaAtualRec.maquinasIndisponiveis || []).includes(m.id);
                        return (
                          <label className="stx-maquina-chip" key={m.id} style={indisponivel ? { opacity: 0.5, textDecoration: "line-through" } : undefined}>
                            <input type="checkbox" checked={!indisponivel} onChange={() => toggleMaquinaIndisponivelSemana(m.id)} />
                            {m.nome}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {maquinas.filter((m) => m.ativo).length === 0 && (
                <p className="stx-empty">Nenhuma máquina ativa cadastrada — vai na aba Máquinas.</p>
              )}
            </div>

            <div className="stx-panel">
              <p className="stx-panel-title" style={{ marginBottom: 4 }}>Capacidade disponível</p>
              <p className="stx-panel-sub">
                Pega o previsto que você lançou em &quot;Previsão semanal&quot; e checa contra as máquinas específicas marcadas em cada etapa dos produtos (não a operação toda), priorizando os de maior lucro/hora. Etapa sem máquina marcada usa todas as ativas daquela operação como reserva.
              </p>
              <div style={{ maxWidth: 200 }}>
                <label className="stx-label">Dias úteis nessa semana</label>
                <input
                  className="stx-input"
                  value={diasUteisSemana}
                  onChange={(e) => cadastrosBase.atualizarConfiguracoesEmpresa({ diasUteisSemana: e.target.value })}
                  placeholder="5"
                  inputMode="decimal"
                />
              </div>
              {cadastrosBase.erro && <p className="stx-save-error">{cadastrosBase.erro}</p>}
              {funcionariosHook.erro && <p className="stx-save-error">{funcionariosHook.erro}</p>}
              {maquinasHook.erro && <p className="stx-save-error">{maquinasHook.erro}</p>}
              {produtosHook.erro && <p className="stx-save-error">{produtosHook.erro}</p>}
              {previsoesHook.erro && <p className="stx-save-error">{previsoesHook.erro}</p>}
              {custosHook.erro && <p className="stx-save-error">{custosHook.erro}</p>}
            </div>

            {itensSemanaAgregados.length === 0 ? (
              <div className="stx-panel">
                <div className="stx-empty">Nenhum item previsto pra {weekLabel(semanaAtual).replace("Semana de ", "")} ainda. Lance em &quot;Previsão semanal&quot;.</div>
              </div>
            ) : (
              <>
                <div className="stx-panel stx-resumo-panel">
                  <p className="stx-panel-title" style={{ marginBottom: 10 }}>Resumo da semana</p>

                  {alocacaoSemanal.resumo.atendidos.length > 0 && (
                    <p className="stx-resumo-linha">
                      <span className="stx-resumo-icone on">✓</span>
                      <span>
                        <b>{alocacaoSemanal.resumo.atendidos.map((r) => r.produtoNome).join(", ")}</b> {alocacaoSemanal.resumo.atendidos.length > 1 ? "foram priorizados" : "foi priorizado"} e saem 100% da previsão — {alocacaoSemanal.resumo.atendidos.length > 1 ? "são" : "é"} quem dá mais lucro por hora de máquina usada.
                      </span>
                    </p>
                  )}

                  {alocacaoSemanal.resumo.comDeficit.map((r) => (
                    <p className="stx-resumo-linha" key={r.produtoId}>
                      <span className="stx-resumo-icone danger">✕</span>
                      <span>
                        <b>{r.produtoNome}</b> ficou faltando <b>{Math.ceil(r.deficit)}</b> peça{Math.ceil(r.deficit) > 1 ? "s" : ""}
                        {r.gargalo ? ` — travado pela capacidade de "${r.gargalo}"` : r.semFluxo ? " — sem fluxo de produção cadastrado" : ""}.
                      </span>
                    </p>
                  ))}

                  {alocacaoSemanal.resumo.operacoesComSobra.length > 0 && (
                    <p className="stx-resumo-linha">
                      <span className="stx-resumo-icone">ℹ</span>
                      <span>
                        Sobrou capacidade sem uso em{" "}
                        <b>{alocacaoSemanal.resumo.operacoesComSobra.map((u) => `${u.operacao} (${u.restante.toFixed(1)}h)`).join(", ")}</b>
                        {" "}— se tiver outro produto que passe por aí, vale lançar mais previsto pra aproveitar essa hora de máquina em vez de deixar parada.
                      </span>
                    </p>
                  )}

                  {alocacaoSemanal.resumo.comDeficit.length === 0 && alocacaoSemanal.resumo.operacoesComSobra.length === 0 && (
                    <p className="stx-resumo-linha">
                      <span className="stx-resumo-icone on">✓</span>
                      <span>Capacidade batendo certinho com a previsão dessa semana, sem sobra nem falta relevante.</span>
                    </p>
                  )}
                </div>

                <div className="stx-panel">
                  <p className="stx-panel-title" style={{ marginBottom: 4 }}>Alocação por produto</p>
                  <p className="stx-panel-sub">Ordenado pelo maior lucro/hora — é quem recebe capacidade primeiro.</p>
                  {alocacaoSemanal.resultados.map((r) => (
                    <div className="stx-entry" key={r.produtoId}>
                      <div>
                        <p className="stx-entry-desc">
                          {r.produtoNome}
                          {r.deficit > 0 && <span className="stx-badge" style={{ background: "rgba(217,83,79,0.15)", color: "var(--danger)" }}>faltam {Math.ceil(r.deficit)}</span>}
                        </p>
                        <p className="stx-entry-meta">
                          {r.semProduto
                            ? "produto não encontrado (foi excluído?)"
                            : r.semFluxo
                            ? "sem fluxo de produção cadastrado — não dá pra calcular capacidade"
                            : `previsto ${r.quantidade} · aloca ${Math.floor(r.quantidadeAlocada)}${r.produto ? ` · ${getLucroHora(r.produto).toFixed(2)} R$/h` : ""}`}
                        </p>
                      </div>
                      <div className="stx-entry-right">
                        <span className="stx-entry-value" style={r.deficit > 0 ? { color: "var(--danger)" } : { color: "var(--blueprint)" }}>
                          {r.quantidade > 0 ? `${Math.min(100, (r.quantidadeAlocada / r.quantidade) * 100).toFixed(0)}%` : "—"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="stx-panel">
                  <p className="stx-panel-title" style={{ marginBottom: 14 }}>Capacidade por operação (na semana)</p>
                  {alocacaoSemanal.usoPorOperacao.length === 0 ? (
                    <div className="stx-empty">Cadastre máquinas na aba Máquinas pra ver a capacidade aqui.</div>
                  ) : (
                    alocacaoSemanal.usoPorOperacao.map((u) => (
                      <div className="stx-cat-row" key={u.operacao}>
                        <div className="stx-cat-top">
                          <span className="stx-cat-name">{u.operacao}</span>
                          <span className="stx-cat-value">{u.usado.toFixed(1)}h / {u.total.toFixed(1)}h</span>
                        </div>
                        <div className="stx-cat-bar-bg">
                          <div
                            className="stx-cat-bar-fill"
                            style={{
                              width: `${u.total > 0 ? Math.min(100, (u.usado / u.total) * 100) : 0}%`,
                              background: u.restante < 0 ? "var(--danger)" : "var(--blueprint)",
                            }}
                          />
                        </div>
                        <p className="stx-uso-leitura">
                          {u.usado <= 0.01
                            ? "nenhuma máquina precisa rodar essa semana"
                            : [
                                u.maquinasIntegrais > 0 ? `${u.maquinasIntegrais} máquina${u.maquinasIntegrais > 1 ? "s" : ""} rodando a semana inteira` : null,
                                u.horasParcial > 0.05 ? `mais 1 máquina por ${u.horasParcial.toFixed(1)}h` : null,
                              ].filter(Boolean).join(" + ")}
                          {" "}({u.numMaquinas} cadastrada{u.numMaquinas > 1 ? "s" : ""} nessa operação)
                        </p>
                        <p className="stx-uso-leitura stx-uso-leitura-dias">
                          {u.restante <= 0.01
                            ? "Sem sobra — capacidade toda usada (ou faltando) essa semana."
                            : `Sobram ≈ ${u.restante.toFixed(1)}h de capacidade combinada — dá pra mais ${u.restanteDiasPeriodos.dias > 0 ? `${u.restanteDiasPeriodos.dias} dia${u.restanteDiasPeriodos.dias > 1 ? "s" : ""}` : ""}${u.restanteDiasPeriodos.dias > 0 && u.restanteDiasPeriodos.periodos > 0 ? " e " : ""}${u.restanteDiasPeriodos.periodos > 0 ? `${u.restanteDiasPeriodos.periodos} período${u.restanteDiasPeriodos.periodos > 1 ? "s" : ""}` : ""}${u.restanteDiasPeriodos.dias === 0 && u.restanteDiasPeriodos.periodos === 0 ? "menos de 1 período" : ""} de uma máquina rodando.`}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
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
