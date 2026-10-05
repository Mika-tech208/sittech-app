"use client";

// "Faltas e Ausências" V1 — ferramenta operacional da supervisão de
// produção, não folha-ponto. Mesmo esqueleto de tela de
// ApontamentosRealizadosPage.tsx (auth gate, filtros recolhíveis, lista
// compacta, toque na linha abre o resumo/edição).

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useAuthSession } from "@/hooks/useAuthSession";
import { useCadastrosBase } from "@/hooks/useCadastrosBase";
import { useFuncionariosElegibilidade } from "@/hooks/useFuncionariosElegibilidade";
import { useFuncionarios } from "@/hooks/useFuncionarios";
import { usePrevisoes } from "@/hooks/usePrevisoes";
import { useCustos } from "@/hooks/useCustos";
import { useAusenciasFuncionarios, type AusenciaFuncionario, type FiltrosAusencias } from "@/hooks/useAusenciasFuncionarios";
import { useSidebarState } from "@/hooks/useSidebarState";
import RegistrarAusenciaModal from "./RegistrarAusenciaModal";
import AusenciaDetalheModal from "./AusenciaDetalheModal";
import {
  LABEL_TIPO_AUSENCIA, TIPOS_AUSENCIA, minutosJornadaCompleta, formatarDuracao,
  calcularResumoPorFuncionario, calcularTotalEquipe, calcularDisponibilidadePct, type TipoAusencia,
} from "./calculations";
import DatePicker from "@/components/shared/DatePicker";
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
import { calcularTotalFixoAtivo, calcularTotalCustoFuncionariosAtivos, calcularMetaFaturamento, calcularHorasProdutivasFuncionario, calcularTotalHorasProdutivasEmpresa } from "@/features/custo-hora/calculations";
import { selecionarSemana, calcularResumoSemana } from "@/features/capacidade/selectors";

function primeiroDiaDoMes(d = new Date()): string {
  return toISODate(new Date(d.getFullYear(), d.getMonth(), 1));
}
function ultimoDiaDoMes(d = new Date()): string {
  return toISODate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

export default function AusenciasPage() {
  const router = useRouter();
  const [tema, setTema] = useState<"dark" | "light">("dark");
  const cores = THEMES[tema];
  const [modoPrivado, setModoPrivado] = useState(false);
  function toggleModoPrivado() {
    const next = !modoPrivado;
    setModoPrivadoAtivo(next);
    setModoPrivado(next);
  }
  const shell = useSidebarState("prAusencias");

  const auth = useAuthSession();
  const cadastrosBase = useCadastrosBase(auth.autenticado);
  const funcionariosElegibilidadeHook = useFuncionariosElegibilidade(auth.autenticado && !cadastrosBase.loading);
  const funcionariosHook = useFuncionarios(auth.autenticado && !cadastrosBase.loading);
  const { funcionarios } = funcionariosHook;
  const previsoesHook = usePrevisoes(auth.autenticado && !cadastrosBase.loading && !funcionariosHook.loading);
  const { previsoes } = previsoesHook;
  const custosHook = useCustos(auth.autenticado && !cadastrosBase.loading && !funcionariosHook.loading && !previsoesHook.loading);
  const { fixedCosts } = custosHook;

  const ausenciasHook = useAusenciasFuncionarios(
    auth.autenticado && !cadastrosBase.loading && !funcionariosElegibilidadeHook.loading
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

  const funcionariosAtivosSimples = useMemo(
    () => funcionariosElegibilidadeHook.funcionarios.filter((f) => f.ativo),
    [funcionariosElegibilidadeHook.funcionarios]
  );
  const funcionarioNomePorId = useMemo(
    () => new Map(funcionariosElegibilidadeHook.funcionarios.map((f) => [f.id, f.nome])),
    [funcionariosElegibilidadeHook.funcionarios]
  );
  const ausenciasComFuncionario = useMemo(
    () => ausenciasHook.ausencias.map((a) => ({ ...a, funcionarioNome: funcionarioNomePorId.get(a.funcionarioId) || a.funcionarioNome })),
    [ausenciasHook.ausencias, funcionarioNomePorId]
  );

  // ---- filtros (default: mês atual) ----
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const filtrosVazios: FiltrosAusencias = useMemo(() => ({ dataInicial: primeiroDiaDoMes(), dataFinal: ultimoDiaDoMes() }), []);
  const [filtrosForm, setFiltrosForm] = useState<FiltrosAusencias>(filtrosVazios);

  function aplicarFiltros() {
    ausenciasHook.buscar(filtrosForm);
  }
  function limparFiltros() {
    setFiltrosForm(filtrosVazios);
    ausenciasHook.buscar(filtrosVazios);
  }

  const [ausenciaSelecionada, setAusenciaSelecionada] = useState<AusenciaFuncionario | null>(null);
  const [mostrarRegistrar, setMostrarRegistrar] = useState(false);

  // ---- resumo mensal — reflete o MESMO filtro ativo acima (V1 simples:
  // não existe um segundo seletor de mês independente) ----
  const horasPorDia = useMemo(() => minutosJornadaCompleta(cadastrosBase.periodos) / 60, [cadastrosBase.periodos]);
  const resumoPorFuncionario = useMemo(
    () => calcularResumoPorFuncionario(ausenciasHook.ausencias, funcionariosAtivosSimples),
    [ausenciasHook.ausencias, funcionariosAtivosSimples]
  );
  const totalEquipe = useMemo(() => calcularTotalEquipe(resumoPorFuncionario), [resumoPorFuncionario]);
  const minutosPrevistosEquipe = useMemo(() => {
    const horasProdutivasFuncionario = calcularHorasProdutivasFuncionario(horasPorDia, cadastrosBase.diasUteis);
    return calcularTotalHorasProdutivasEmpresa(horasProdutivasFuncionario, funcionariosAtivosSimples.length) * 60;
  }, [horasPorDia, cadastrosBase.diasUteis, funcionariosAtivosSimples.length]);
  const disponibilidadePct = calcularDisponibilidadePct(minutosPrevistosEquipe, totalEquipe.minutosPerdidos);

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

  const carregando = cadastrosBase.loading || funcionariosElegibilidadeHook.loading || funcionariosHook.loading || previsoesHook.loading || custosHook.loading;

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

  if (!temPermissao(auth.usuarioLogado, "ausencias_funcionarios")) {
    return (
      <div className="stx-root">
        <GlobalStyles cores={cores} />
        <div className="stx-layout">
          <Sidebar
            tema={tema}
            abaAtiva="prAusencias"
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
          abaAtiva="prAusencias"
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
            abaAtiva="prAusencias"
            onAbrirMenu={shell.abrirGaveta}
          />
          <div className="stx-header">
            <div>
              <h1 className="stx-title">Faltas e Ausências</h1>
            </div>
            <button type="button" className="stx-add-btn" onClick={() => setMostrarRegistrar(true)}>+ Registrar ausência</button>
          </div>

          <button type="button" className="stx-apr-filtros-toggle" onClick={() => setFiltrosAbertos((v) => !v)}>
            {filtrosAbertos ? <ChevronDown size={15} /> : <ChevronRight size={15} />} Filtros
          </button>

          {filtrosAbertos && (
            <div className="stx-apr-filtros-panel">
              <div className="stx-apr-filtros-grid">
                <div>
                  <label className="stx-ap-field-label">Data inicial</label>
                  <DatePicker className="stx-ap-input" value={filtrosForm.dataInicial || ""} onChange={(v) => setFiltrosForm((f) => ({ ...f, dataInicial: v || undefined }))} />
                </div>
                <div>
                  <label className="stx-ap-field-label">Data final</label>
                  <DatePicker className="stx-ap-input" value={filtrosForm.dataFinal || ""} onChange={(v) => setFiltrosForm((f) => ({ ...f, dataFinal: v || undefined }))} />
                </div>
                <div>
                  <label className="stx-ap-field-label">Funcionário</label>
                  <select className="stx-ap-select" value={filtrosForm.funcionarioId || ""} onChange={(e) => setFiltrosForm((f) => ({ ...f, funcionarioId: e.target.value || undefined }))}>
                    <option value="">Todos</option>
                    {funcionariosElegibilidadeHook.funcionarios.map((f) => (
                      <option key={f.id} value={f.id}>{f.nome}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="stx-ap-field-label">Tipo</label>
                  <select
                    className="stx-ap-select"
                    value={filtrosForm.tipo || ""}
                    onChange={(e) => setFiltrosForm((f) => ({ ...f, tipo: (e.target.value || undefined) as TipoAusencia | undefined }))}
                  >
                    <option value="">Todos</option>
                    {TIPOS_AUSENCIA.map((t) => (
                      <option key={t.valor} value={t.valor}>{t.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="stx-apr-filtros-actions">
                <button type="button" className="stx-apr-pill-btn-primary" onClick={aplicarFiltros}>Filtrar</button>
                <button type="button" className="stx-apr-pill-btn" onClick={limparFiltros}>Mês atual</button>
              </div>
            </div>
          )}

          {ausenciasHook.erro && <p className="stx-save-error">{ausenciasHook.erro}</p>}

          {ausenciasHook.loading ? (
            <div className="stx-empty">Carregando…</div>
          ) : ausenciasComFuncionario.length === 0 ? (
            <div className="stx-empty">Nenhuma ausência encontrada no período.</div>
          ) : (
            <>
              {ausenciasComFuncionario.length >= ausenciasHook.limite && (
                <p className="stx-apr-ref">Mostrando as {ausenciasHook.limite} mais recentes — refine os filtros para ver outras.</p>
              )}
              <div className="stx-apr-list">
                {ausenciasComFuncionario.map((a) => (
                  <div key={a.id} className="stx-apr-row" onClick={() => setAusenciaSelecionada(a)}>
                    <div className="stx-apr-row-top">
                      <span className="stx-apr-row-data">{a.data.split("-").reverse().join("/")} · {a.funcionarioNome || "—"}</span>
                      <span className="stx-apr-pill">{formatarDuracao(a.duracaoMinutos)}</span>
                    </div>
                    <p className="stx-apr-row-detalhe">
                      {LABEL_TIPO_AUSENCIA[a.tipo]}
                      {a.horarioInicio && ` · ${a.horarioInicio}–${a.horarioFim}`}
                      {a.observacao && ` · ${a.observacao}`}
                    </p>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="stx-header" style={{ marginTop: 32 }}>
            <h2 className="stx-panel-title">Resumo do período filtrado</h2>
          </div>

          <div className="stx-ausencia-topo-stats">
            <div>
              <span>Horas previstas da equipe</span>
              <b>{formatarDuracao(minutosPrevistosEquipe)}</b>
            </div>
            <div>
              <span>Horas perdidas por ausência</span>
              <b>{formatarDuracao(totalEquipe.minutosPerdidos)}</b>
            </div>
            <div>
              <span>Disponibilidade de mão de obra</span>
              <b>{disponibilidadePct === null ? "—" : `${disponibilidadePct.toFixed(0)}%`}</b>
            </div>
          </div>

          <div className="stx-hist-table" style={{ marginTop: 12 }}>
            <div className="stx-ausencia-row stx-ausencia-row-head" style={{ gridTemplateColumns: "1.4fr 1fr 1fr 1fr 1fr" }}>
              <span>Funcionário</span><span>Faltas</span><span>Atrasos</span><span>Saídas antecipadas</span><span>Horas perdidas</span>
            </div>
            {resumoPorFuncionario.map((r) => (
              <div className="stx-ausencia-row" style={{ gridTemplateColumns: "1.4fr 1fr 1fr 1fr 1fr" }} key={r.funcionarioId}>
                <span>{r.funcionarioNome}</span>
                <span>{r.faltas}</span>
                <span>{r.atrasos}</span>
                <span>{r.saidasAntecipadas}</span>
                <span>{formatarDuracao(r.minutosPerdidos)}</span>
              </div>
            ))}
            <div className="stx-ausencia-row stx-ausencia-row-total" style={{ gridTemplateColumns: "1.4fr 1fr 1fr 1fr 1fr" }}>
              <span>TOTAL DA EQUIPE</span>
              <span>{totalEquipe.faltas}</span>
              <span>{totalEquipe.atrasos}</span>
              <span>{totalEquipe.saidasAntecipadas}</span>
              <span>{formatarDuracao(totalEquipe.minutosPerdidos)}</span>
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

      {mostrarRegistrar && (
        <RegistrarAusenciaModal
          funcionariosAtivos={funcionariosAtivosSimples}
          periodos={cadastrosBase.periodos}
          dataInicial={toISODate(new Date())}
          onFechar={() => setMostrarRegistrar(false)}
          onRegistrar={ausenciasHook.registrar}
        />
      )}

      {ausenciaSelecionada && (
        <AusenciaDetalheModal
          ausencia={ausenciaSelecionada}
          onFechar={() => setAusenciaSelecionada(null)}
          onEditar={ausenciasHook.editar}
        />
      )}
    </div>
  );
}
