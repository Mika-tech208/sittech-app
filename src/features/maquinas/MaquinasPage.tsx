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
import { THEMES } from "@/lib/constants";
import { temPermissao } from "@/lib/permissoes";
import { formatBRL, setModoPrivadoAtivo } from "@/lib/format";
import { toISODate, mondayOf } from "@/lib/date";
import { calcularTotalFixoAtivo, calcularTotalCustoFuncionariosAtivos, calcularMetaFaturamento } from "@/features/custo-hora/calculations";
import { selecionarSemana, calcularResumoSemana } from "@/features/capacidade/selectors";
import { ordenarMaquinasPorNome, encontrarProdutosQueUsamMaquina } from "@/features/maquinas/calculations";
import { EMPTY_MAQUINA_FORM, type MaquinaForm as MaquinaFormState } from "@/features/maquinas/types";
import MaquinaForm from "@/features/maquinas/components/MaquinaForm";
import type { Maquina } from "@/types/domain";

export default function MaquinasPage() {
  const router = useRouter();
  const [tema, setTema] = useState<"dark" | "light">("dark");
  const cores = THEMES[tema];
  const [modoPrivado, setModoPrivado] = useState(false);
  function toggleModoPrivado() {
    const next = !modoPrivado;
    setModoPrivadoAtivo(next);
    setModoPrivado(next);
  }
  const { gruposAbertos, toggleGrupo } = useGruposAbertosSidebar("maquinas");

  const auth = useAuthSession();
  // operacoes é cadastro-base — vem do Supabase, mesma fonte usada em
  // /produtos, /custo-hora, /previsao, /capacidade e "/".
  const cadastrosBase = useCadastrosBase(auth.autenticado);
  const { operacoes } = cadastrosBase;
  // Ordem exigida: auth -> cadastros-base -> funcionários -> máquinas -> produtos -> previsões -> custos.
  const funcionariosHook = useFuncionarios(auth.autenticado && !cadastrosBase.loading);
  const { funcionarios } = funcionariosHook;
  const maquinasHook = useMaquinas(auth.autenticado && !cadastrosBase.loading && !funcionariosHook.loading);
  const { maquinas } = maquinasHook;
  // Só usado aqui pra "X produtos" no card de cada máquina
  // (encontrarProdutosQueUsamMaquina) — mesma fonte que /produtos.
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

  // ---- listagem ----
  const maquinasOrdenadas = useMemo(() => ordenarMaquinasPorNome(maquinas), [maquinas]);
  const [maquinaExpandidaId, setMaquinaExpandidaId] = useState<string | null>(null);

  // ---- formulário ----
  const [showMaquinaForm, setShowMaquinaForm] = useState(false);
  const [editingMaquinaId, setEditingMaquinaId] = useState<string | null>(null);
  const [maquinaForm, setMaquinaForm] = useState<MaquinaFormState>(EMPTY_MAQUINA_FORM);
  const [novaOperacaoMaquina, setNovaOperacaoMaquina] = useState(false);
  const [textoNovaOperacaoMaquina, setTextoNovaOperacaoMaquina] = useState("");

  function resetMaquinaForm() {
    setMaquinaForm(EMPTY_MAQUINA_FORM);
    setEditingMaquinaId(null);
    setShowMaquinaForm(false);
    setNovaOperacaoMaquina(false);
    setTextoNovaOperacaoMaquina("");
  }

  async function confirmarNovaOperacaoMaquina() {
    const nome = await cadastrosBase.criarOperacao(textoNovaOperacaoMaquina);
    if (nome) setMaquinaForm((f) => ({ ...f, operacao: nome }));
    setTextoNovaOperacaoMaquina("");
    setNovaOperacaoMaquina(false);
  }

  async function submitMaquina() {
    if (!maquinaForm.nome.trim()) return;
    if (editingMaquinaId) {
      await maquinasHook.atualizarMaquina(editingMaquinaId, maquinaForm);
    } else {
      await maquinasHook.criarMaquina(maquinaForm);
    }
    resetMaquinaForm();
  }

  function editMaquina(m: Maquina) {
    setMaquinaForm({ nome: m.nome, operacao: m.operacao });
    setEditingMaquinaId(m.id);
    setShowMaquinaForm(true);
  }

  function toggleMaquinaAtivo(id: string) {
    maquinasHook.alternarMaquinaAtiva(id);
  }

  function deleteMaquina(id: string) {
    maquinasHook.removerMaquina(id);
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

  if (!temPermissao(auth.usuarioLogado, "maquinas")) {
    return (
      <div className="stx-root">
        <GlobalStyles cores={cores} />
        <div className="stx-layout">
          <Sidebar
            tema={tema}
            abaAtiva="maquinas"
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
          abaAtiva="maquinas"
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
              <h1 className="stx-title">Máquinas</h1>
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

          <div className="stx-grid" style={{ gridTemplateColumns: "1fr" }}>
            <div className="stx-panel">
              <div className="stx-panel-title-row">
                <p className="stx-panel-title">Máquinas</p>
              </div>
              <p className="stx-panel-sub">Cadastro das máquinas por operação — depois você seleciona quais estão disponíveis em cada etapa dos produtos.</p>

              {!showMaquinaForm && (
                <button className="stx-add-btn blueprint" onClick={() => setShowMaquinaForm(true)}>+ Nova máquina</button>
              )}

              {showMaquinaForm && (
                <MaquinaForm
                  form={maquinaForm}
                  setForm={setMaquinaForm}
                  operacoes={operacoes}
                  editingMaquinaId={editingMaquinaId}
                  novaOperacao={novaOperacaoMaquina}
                  textoNovaOperacao={textoNovaOperacaoMaquina}
                  setTextoNovaOperacao={setTextoNovaOperacaoMaquina}
                  onIniciarNovaOperacao={() => setNovaOperacaoMaquina(true)}
                  onConfirmarNovaOperacao={confirmarNovaOperacaoMaquina}
                  onCancelarNovaOperacao={() => { setNovaOperacaoMaquina(false); setTextoNovaOperacaoMaquina(""); }}
                  onSubmit={submitMaquina}
                  onCancelar={resetMaquinaForm}
                />
              )}

              {maquinasHook.loading ? (
                <div className="stx-empty">Carregando…</div>
              ) : maquinasOrdenadas.length === 0 ? (
                <div className="stx-empty">Nenhuma máquina cadastrada ainda.</div>
              ) : (
                maquinasOrdenadas.map((m) => {
                  const usos = encontrarProdutosQueUsamMaquina(m.id, produtos);
                  const expandida = maquinaExpandidaId === m.id;
                  return (
                    <div key={m.id}>
                      <div
                        className={`stx-entry stx-entry-clicavel ${!m.ativo ? "paused" : ""}`}
                        onClick={() => setMaquinaExpandidaId(expandida ? null : m.id)}
                      >
                        <div>
                          <p className="stx-entry-desc">
                            {m.nome}
                            {!m.ativo && <span className="stx-badge">pausada</span>}
                            <span className="stx-badge blueprint">{usos.length} produto{usos.length !== 1 ? "s" : ""}</span>
                          </p>
                          <p className="stx-entry-meta">{m.operacao}</p>
                        </div>
                        <div className="stx-entry-right" onClick={(e) => e.stopPropagation()}>
                          <button
                            className={`stx-icon-btn ${m.ativo ? "on" : ""}`}
                            title={m.ativo ? "Pausar (a máquina para de contar na capacidade)" : "Retomar"}
                            onClick={() => toggleMaquinaAtivo(m.id)}
                          >
                            {m.ativo ? "⏸ Pausar" : "▶ Retomar"}
                          </button>
                          <button className="stx-icon-btn" title="Editar" onClick={() => editMaquina(m)}>✎</button>
                          <button className="stx-icon-btn danger" title="Excluir" onClick={() => deleteMaquina(m.id)}>✕</button>
                          <span className="stx-chevron">{expandida ? "▲" : "▼"}</span>
                        </div>
                      </div>
                      {expandida && (
                        <div className="stx-maquina-usos">
                          {usos.length === 0 ? (
                            <p className="stx-panel-sub" style={{ margin: 0 }}>Nenhum produto usa essa máquina ainda — marca ela no fluxo de produção de algum produto.</p>
                          ) : (
                            usos.map(({ produto, etapas }) => (
                              <div className="stx-op-func-line" key={produto.id}>
                                <span className="n">{produto.nome}</span>
                                <span className="v">{etapas.map((e) => e.operacao).join(", ")}</span>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
            {cadastrosBase.erro && <p className="stx-save-error">{cadastrosBase.erro}</p>}
            {funcionariosHook.erro && <p className="stx-save-error">{funcionariosHook.erro}</p>}
            {maquinasHook.erro && <p className="stx-save-error">{maquinasHook.erro}</p>}
            {produtosHook.erro && <p className="stx-save-error">{produtosHook.erro}</p>}
            {previsoesHook.erro && <p className="stx-save-error">{previsoesHook.erro}</p>}
            {custosHook.erro && <p className="stx-save-error">{custosHook.erro}</p>}
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
