"use client";

// "Apontamentos realizados" — consulta simples da Produção Real V1, não é
// dashboard. Filtros compactos e recolhíveis, lista compacta, toque numa
// linha abre o resumo (e, de lá, a edição). Nunca mostra meta, custo, OEE,
// disponibilidade ou qualidade.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useAuthSession } from "@/hooks/useAuthSession";
import { useCadastrosBase } from "@/hooks/useCadastrosBase";
import { useFuncionarios } from "@/hooks/useFuncionarios";
import { useFuncionariosElegibilidade } from "@/hooks/useFuncionariosElegibilidade";
import { useMaquinas } from "@/hooks/useMaquinas";
import { useProdutos } from "@/hooks/useProdutos";
import { usePrevisoes } from "@/hooks/usePrevisoes";
import { useCustos } from "@/hooks/useCustos";
import { useApontamentosRealizados, type FiltrosApontamentos, type ApontamentoRealizado } from "@/hooks/useApontamentosRealizados";
import { useSidebarState } from "@/hooks/useSidebarState";
import { LABEL_MOTIVO_SEM_PRODUCAO } from "@/features/producao-real/SemProducaoModal";
import ResumoApontamentoModal from "@/features/producao-real/ResumoApontamentoModal";
import PerformanceIndicador from "@/features/producao-real/components/PerformanceIndicador";
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

const FILTROS_VAZIOS: FiltrosApontamentos = {};

export default function ApontamentosRealizadosPage() {
  const router = useRouter();
  const [tema, setTema] = useState<"dark" | "light">("dark");
  const cores = THEMES[tema];
  const [modoPrivado, setModoPrivado] = useState(false);
  function toggleModoPrivado() {
    const next = !modoPrivado;
    setModoPrivadoAtivo(next);
    setModoPrivado(next);
  }
  const shell = useSidebarState("producaoRealApontamentos");

  const auth = useAuthSession();
  const cadastrosBase = useCadastrosBase(auth.autenticado);
  const funcionariosHook = useFuncionarios(auth.autenticado && !cadastrosBase.loading);
  const { funcionarios } = funcionariosHook;
  // Leitura mínima (id/nome, nunca salário) — ver mesmo comentário em
  // ProducaoRealPainelPage.tsx. Usada no filtro e na edição de funcionário;
  // `funcionariosHook` continua só pro card "Meta semanal" da sidebar.
  const funcionariosElegibilidadeHook = useFuncionariosElegibilidade(auth.autenticado && !cadastrosBase.loading);
  const maquinasHook = useMaquinas(auth.autenticado && !cadastrosBase.loading && !funcionariosHook.loading);
  const produtosHook = useProdutos(auth.autenticado && !cadastrosBase.loading && !funcionariosHook.loading && !maquinasHook.loading);
  const previsoesHook = usePrevisoes(
    auth.autenticado && !cadastrosBase.loading && !funcionariosHook.loading && !maquinasHook.loading && !produtosHook.loading
  );
  const { previsoes } = previsoesHook;
  const custosHook = useCustos(
    auth.autenticado && !cadastrosBase.loading && !funcionariosHook.loading && !maquinasHook.loading && !produtosHook.loading && !previsoesHook.loading
  );
  const { fixedCosts } = custosHook;

  const apontamentosHook = useApontamentosRealizados(
    auth.autenticado && !cadastrosBase.loading && !funcionariosHook.loading && !maquinasHook.loading && !produtosHook.loading
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

  // ResumoApontamentoModal só precisa de ativos pra edição (ela mesma
  // recoloca o funcionário original se ele tiver ficado inativo depois).
  const funcionariosAtivosSimples = useMemo(
    () => funcionariosElegibilidadeHook.funcionarios.filter((f) => f.ativo),
    [funcionariosElegibilidadeHook.funcionarios]
  );

  // Filtro e rótulo da listagem precisam de TODOS (inclusive inativos) —
  // um apontamento antigo pode ser de alguém que não trabalha mais aqui,
  // e o filtro por funcionário tem que continuar achando esses registros.
  const funcionarioNomePorId = useMemo(
    () => new Map(funcionariosElegibilidadeHook.funcionarios.map((f) => [f.id, f.nome])),
    [funcionariosElegibilidadeHook.funcionarios]
  );
  // useApontamentosRealizados não embeda mais funcionarios(nome) (a RLS da
  // tabela bloquearia quem não tem permissão de funcionários/custo_hora) —
  // o nome é resolvido aqui, via a view sem essa restrição.
  const apontamentosComFuncionario = useMemo(
    () => apontamentosHook.apontamentos.map((a) => ({
      ...a,
      funcionarioNome: a.funcionarioId ? funcionarioNomePorId.get(a.funcionarioId) || a.funcionarioNome : a.funcionarioNome,
    })),
    [apontamentosHook.apontamentos, funcionarioNomePorId]
  );

  // ---- filtros ----
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [filtrosForm, setFiltrosForm] = useState<FiltrosApontamentos>(FILTROS_VAZIOS);

  function aplicarFiltros() {
    apontamentosHook.buscar(filtrosForm);
  }
  function limparFiltros() {
    setFiltrosForm(FILTROS_VAZIOS);
    apontamentosHook.buscar(FILTROS_VAZIOS);
  }

  const [apontamentoSelecionado, setApontamentoSelecionado] = useState<ApontamentoRealizado | null>(null);

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
    produtosHook.loading || previsoesHook.loading || custosHook.loading;

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

  if (!temPermissao(auth.usuarioLogado, "producao_real_historico")) {
    return (
      <div className="stx-root">
        <GlobalStyles cores={cores} />
        <div className="stx-layout">
          <Sidebar
            tema={tema}
            abaAtiva="producaoRealApontamentos"
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
          abaAtiva="producaoRealApontamentos"
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
            abaAtiva="producaoRealApontamentos"
            onAbrirMenu={shell.abrirGaveta}
          />
          <div className="stx-header">
            <div>
              <h1 className="stx-title">Apontamentos realizados</h1>
            </div>
          </div>

          <button type="button" className="stx-apr-filtros-toggle" onClick={() => setFiltrosAbertos((v) => !v)}>
            {filtrosAbertos ? <ChevronDown size={15} /> : <ChevronRight size={15} />} Filtros
          </button>

          {filtrosAbertos && (
            <div className="stx-apr-filtros-panel">
              <div className="stx-apr-filtros-grid">
                <div>
                  <label className="stx-ap-field-label">Data inicial</label>
                  <input type="date" className="stx-ap-input" value={filtrosForm.dataInicial || ""} onChange={(e) => setFiltrosForm((f) => ({ ...f, dataInicial: e.target.value || undefined }))} />
                </div>
                <div>
                  <label className="stx-ap-field-label">Data final</label>
                  <input type="date" className="stx-ap-input" value={filtrosForm.dataFinal || ""} onChange={(e) => setFiltrosForm((f) => ({ ...f, dataFinal: e.target.value || undefined }))} />
                </div>
                <div>
                  <label className="stx-ap-field-label">Período</label>
                  <select className="stx-ap-select" value={filtrosForm.periodoId || ""} onChange={(e) => setFiltrosForm((f) => ({ ...f, periodoId: e.target.value || undefined }))}>
                    <option value="">Todos</option>
                    {cadastrosBase.periodos.map((p) => (
                      <option key={p.id} value={p.id}>{p.nome}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="stx-ap-field-label">Máquina</label>
                  <select className="stx-ap-select" value={filtrosForm.maquinaId || ""} onChange={(e) => setFiltrosForm((f) => ({ ...f, maquinaId: e.target.value || undefined }))}>
                    <option value="">Todas</option>
                    {maquinasHook.maquinas.map((m) => (
                      <option key={m.id} value={m.id}>{m.nome}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="stx-ap-field-label">Produto</label>
                  <select className="stx-ap-select" value={filtrosForm.produtoId || ""} onChange={(e) => setFiltrosForm((f) => ({ ...f, produtoId: e.target.value || undefined }))}>
                    <option value="">Todos</option>
                    {produtosHook.produtos.map((p) => (
                      <option key={p.id} value={p.id}>{p.nome}</option>
                    ))}
                  </select>
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
                  <label className="stx-ap-field-label">Status</label>
                  <select
                    className="stx-ap-select"
                    value={filtrosForm.status || ""}
                    onChange={(e) => setFiltrosForm((f) => ({ ...f, status: (e.target.value || undefined) as FiltrosApontamentos["status"] }))}
                  >
                    <option value="">Todos</option>
                    <option value="produzindo">Produzindo</option>
                    <option value="sem_producao">Sem produção</option>
                  </select>
                </div>
              </div>
              <div className="stx-apr-filtros-actions">
                <button type="button" className="stx-apr-pill-btn-primary" onClick={aplicarFiltros}>Filtrar</button>
                <button type="button" className="stx-apr-pill-btn" onClick={limparFiltros}>Limpar</button>
              </div>
            </div>
          )}

          {apontamentosHook.erro && <p className="stx-save-error">{apontamentosHook.erro}</p>}

          {apontamentosHook.loading ? (
            <div className="stx-empty">Carregando…</div>
          ) : apontamentosComFuncionario.length === 0 ? (
            <div className="stx-empty">Nenhum apontamento encontrado.</div>
          ) : (
            <>
              {apontamentosComFuncionario.length >= apontamentosHook.limite && (
                <p className="stx-apr-ref">Mostrando os {apontamentosHook.limite} mais recentes — refine os filtros para ver outros.</p>
              )}
              <div className="stx-apr-list">
                {apontamentosComFuncionario.map((a) => (
                  <div key={a.id} className="stx-apr-row" onClick={() => setApontamentoSelecionado(a)}>
                    <div className="stx-apr-row-top">
                      <span className="stx-apr-row-data">{a.data.split("-").reverse().join("/")} · {a.periodoNome} · {a.maquinaNome}</span>
                      <div className="stx-apr-row-right">
                        <PerformanceIndicador performancePct={a.performancePct} />
                        <span className={`stx-apr-pill estado-${a.status}`}>{a.status === "produzindo" ? "Apontado" : "Sem produção"}</span>
                      </div>
                    </div>
                    <p className="stx-apr-row-detalhe">
                      {a.status === "produzindo"
                        ? `${a.produtoNome} · ${a.funcionarioNome} · ${a.quantidadeProduzida} un. (refugo ${a.quantidadeRefugo})`
                        : LABEL_MOTIVO_SEM_PRODUCAO[a.motivoSemProducao || ""] || a.motivoSemProducao}
                    </p>
                  </div>
                ))}
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

      {apontamentoSelecionado && (
        <ResumoApontamentoModal
          key={apontamentoSelecionado.id}
          apontamento={apontamentoSelecionado}
          funcionariosAtivos={funcionariosAtivosSimples}
          onFechar={() => setApontamentoSelecionado(null)}
          onEditado={(id, patch) => {
            apontamentosHook.atualizarApontamentoLocal(id, patch);
            setApontamentoSelecionado((prev) => (prev && prev.id === id ? { ...prev, ...patch } : prev));
          }}
          onExcluido={(id) => {
            apontamentosHook.removerApontamentoLocal(id);
          }}
        />
      )}
    </div>
  );
}
