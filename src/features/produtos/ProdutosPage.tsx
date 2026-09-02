"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Percent, Clock } from "lucide-react";
import { useAuthSession } from "@/hooks/useAuthSession";
import { useCadastrosBase } from "@/hooks/useCadastrosBase";
import { useFuncionarios } from "@/hooks/useFuncionarios";
import { useMaquinas } from "@/hooks/useMaquinas";
import { useProdutos } from "@/hooks/useProdutos";
import { usePrevisoes } from "@/hooks/usePrevisoes";
import { useCustos } from "@/hooks/useCustos";
import LoginScreen from "@/components/shell/LoginScreen";
import Sidebar from "@/components/shell/Sidebar";
import TopBarActions from "@/components/shell/TopBarActions";
import AccountModal from "@/components/shell/AccountModal";
import GlobalStyles from "@/components/shell/GlobalStyles";
import { THEMES } from "@/lib/constants";
import { formatBRL, toNumber, setModoPrivadoAtivo, corPorMargemPct, corPorLucroHora } from "@/lib/format";
import { toISODate, mondayOf } from "@/lib/date";
import { calcularPeriodosComDuracao, filtrarPeriodosValidos, calcularHorasPorDia } from "@/lib/calculations/periodos";
import {
  calcularTotalFixoAtivo, calcularTotalCustoFuncionariosAtivos, calcularCustoHoraEOperacoes,
  calcularMargemProduto, calcularMetaFaturamento,
} from "@/features/custo-hora/calculations";
import { selecionarSemana, calcularResumoSemana } from "@/features/capacidade/selectors";
import {
  roteiroParaFormulario, roteiroParaPersistencia, adicionarEtapa, removerEtapa,
  trocarOperacaoEtapa, definirOperacaoEtapa, atualizarMetaEtapa, alternarMaquinaNaEtapa,
  ordenarProdutosPorLucroHora, produtoTemRoteiro,
} from "@/features/produtos/calculations";
import { EMPTY_PRODUTO_FORM, type ProdutoForm as ProdutoFormState, type RoteiroEtapaForm } from "@/features/produtos/types";
import ProdutoForm from "@/features/produtos/components/ProdutoForm";
import type { Produto } from "@/types/domain";

export default function ProdutosPage() {
  const router = useRouter();
  const [tema, setTema] = useState<"dark" | "light">("dark");
  const cores = THEMES[tema];
  const [modoPrivado, setModoPrivado] = useState(false);
  function toggleModoPrivado() {
    const next = !modoPrivado;
    setModoPrivadoAtivo(next);
    setModoPrivado(next);
  }
  const [gruposAbertos, setGruposAbertos] = useState({ gestao: true, financeiro: true, planejamento: true, producaoReal: true, administracao: true });
  function toggleGrupo(grupo: keyof typeof gruposAbertos) {
    setGruposAbertos((prev) => ({ ...prev, [grupo]: !prev[grupo] }));
  }

  const auth = useAuthSession();
  // periodos/diasUteis/operacoes são cadastro-base — vêm do Supabase, mesma
  // fonte usada em /maquinas, /custo-hora, /previsao, /capacidade e "/".
  const cadastrosBase = useCadastrosBase(auth.autenticado);
  const { periodos, diasUteis, operacoes } = cadastrosBase;
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

  // ---- derivações compartilhadas (mesmas fórmulas do resto do app) ----
  const periodosComDuracao = useMemo(() => calcularPeriodosComDuracao(periodos), [periodos]);
  const periodosValidos = useMemo(() => filtrarPeriodosValidos(periodosComDuracao), [periodosComDuracao]);
  const horasPorDiaCalc = useMemo(() => calcularHorasPorDia(periodosValidos), [periodosValidos]);
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
  // margem/lucro-hora de um produto vêm sempre daqui — nunca duplicar a
  // fórmula dentro do domínio de Produtos.
  function calcularMargem(produto: Produto) {
    return calcularMargemProduto(produto, custoHoraPorOperacao, custoHoraEmpresa, periodosComDuracao);
  }

  // ---- card "Meta semanal" da sidebar — mesma fórmula usada nas outras rotas ----
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
  const produtosOrdenados = useMemo(
    () => ordenarProdutosPorLucroHora(produtos, (p) => calcularMargem(p).lucroHora),
    [produtos, custoHoraPorOperacao, custoHoraEmpresa, periodosComDuracao]
  );

  // ---- formulário ----
  const [showProdutoForm, setShowProdutoForm] = useState(false);
  const [editingProdutoId, setEditingProdutoId] = useState<string | null>(null);
  const [produtoForm, setProdutoForm] = useState<ProdutoFormState>(EMPTY_PRODUTO_FORM);
  const [produtoRoteiro, setProdutoRoteiro] = useState<RoteiroEtapaForm[]>([]);
  const [novaOperacaoEtapaId, setNovaOperacaoEtapaId] = useState<string | null>(null);
  const [textoNovaOperacaoEtapa, setTextoNovaOperacaoEtapa] = useState("");

  function resetProdutoForm() {
    setProdutoForm(EMPTY_PRODUTO_FORM);
    setProdutoRoteiro([]);
    setEditingProdutoId(null);
    setShowProdutoForm(false);
    setNovaOperacaoEtapaId(null);
    setTextoNovaOperacaoEtapa("");
  }

  async function confirmarNovaOperacaoEtapa() {
    const nome = await cadastrosBase.criarOperacao(textoNovaOperacaoEtapa);
    if (nome && novaOperacaoEtapaId) setProdutoRoteiro(definirOperacaoEtapa(produtoRoteiro, novaOperacaoEtapaId, nome));
    setTextoNovaOperacaoEtapa("");
    setNovaOperacaoEtapaId(null);
  }

  async function submitProduto() {
    if (!produtoForm.nome.trim() || !produtoForm.valorUnitario) return;
    const dados = {
      nome: produtoForm.nome, referencia: produtoForm.referencia, valorUnitario: toNumber(produtoForm.valorUnitario),
      prioridade: produtoForm.prioridade, roteiro: roteiroParaPersistencia(produtoRoteiro),
    };
    if (editingProdutoId) {
      await produtosHook.atualizarProduto(editingProdutoId, dados);
    } else {
      await produtosHook.criarProduto(dados);
    }
    resetProdutoForm();
  }

  function editProduto(p: Produto) {
    setProdutoForm({ nome: p.nome, referencia: p.referencia, valorUnitario: String(p.valorUnitario), prioridade: p.prioridade || "media" });
    setProdutoRoteiro(roteiroParaFormulario(p.roteiro));
    setEditingProdutoId(p.id);
    setShowProdutoForm(true);
  }

  function toggleProdutoAtivo(id: string) {
    produtosHook.alternarProdutoAtivo(id);
  }

  function deleteProduto(id: string) {
    produtosHook.removerProduto(id);
  }

  if (cadastrosBase.loading || funcionariosHook.loading || maquinasHook.loading || produtosHook.loading || previsoesHook.loading || custosHook.loading || auth.restaurandoSessao || !auth.autenticado) {
    return (
      <div className="stx-root">
        <GlobalStyles cores={cores} />
        <LoginScreen
          loading={cadastrosBase.loading || funcionariosHook.loading || maquinasHook.loading || produtosHook.loading || previsoesHook.loading || custosHook.loading || auth.restaurandoSessao}
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

  return (
    <div className="stx-root">
      <GlobalStyles cores={cores} />
      <div className="stx-layout">
        <Sidebar
          tema={tema}
          abaAtiva="produtos"
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
              <h1 className="stx-title">Produtos</h1>
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
                <p className="stx-panel-title">Produtos</p>
              </div>
              <p className="stx-panel-sub">
                Cadastro com o valor recebido por peça pronta, o fluxo de produção (etapas, meta por período e máquinas), a margem e o lucro/hora calculados automaticamente. A lista abaixo já ordena pelo maior lucro/hora primeiro — é isso que vale mais priorizar produzir.
              </p>

              {!showProdutoForm && (
                <button className="stx-add-btn blueprint" onClick={() => setShowProdutoForm(true)}>+ Novo produto</button>
              )}

              {showProdutoForm && (
                <ProdutoForm
                  form={produtoForm}
                  setForm={setProdutoForm}
                  roteiro={produtoRoteiro}
                  operacoes={operacoes}
                  maquinas={maquinas}
                  periodos={periodos}
                  editingProdutoId={editingProdutoId}
                  novaOperacaoEtapaId={novaOperacaoEtapaId}
                  textoNovaOperacaoEtapa={textoNovaOperacaoEtapa}
                  setTextoNovaOperacaoEtapa={setTextoNovaOperacaoEtapa}
                  onIniciarNovaOperacao={(etapaId) => setNovaOperacaoEtapaId(etapaId)}
                  onConfirmarNovaOperacao={confirmarNovaOperacaoEtapa}
                  onCancelarNovaOperacao={() => { setNovaOperacaoEtapaId(null); setTextoNovaOperacaoEtapa(""); }}
                  onTrocarOperacaoEtapa={(etapaId, operacao) => setProdutoRoteiro(trocarOperacaoEtapa(produtoRoteiro, etapaId, operacao))}
                  onRemoverEtapa={(etapaId) => setProdutoRoteiro(removerEtapa(produtoRoteiro, etapaId))}
                  onAdicionarEtapa={() => setProdutoRoteiro(adicionarEtapa(produtoRoteiro, operacoes[0] || ""))}
                  onAtualizarMetaEtapa={(etapaId, periodoId, valor) => setProdutoRoteiro(atualizarMetaEtapa(produtoRoteiro, etapaId, periodoId, valor))}
                  onAlternarMaquinaNaEtapa={(etapaId, maquinaId) => setProdutoRoteiro(alternarMaquinaNaEtapa(produtoRoteiro, etapaId, maquinaId))}
                  onSubmit={submitProduto}
                  onCancelar={resetProdutoForm}
                />
              )}

              {produtosHook.loading ? (
                <div className="stx-empty">Carregando…</div>
              ) : produtosOrdenados.length === 0 ? (
                <div className="stx-empty">Nenhum produto cadastrado ainda.</div>
              ) : (
                produtosOrdenados.map((p) => {
                  const temRoteiro = produtoTemRoteiro(p);
                  const { custo, margemRS, margemPct, lucroHora } = calcularMargem(p);
                  return (
                    <div className={`stx-func-card ${!p.ativo ? "paused" : ""}`} key={p.id}>
                      <div className="stx-func-top">
                        <div>
                          <p className="stx-func-nome">
                            {p.nome}
                            {p.referencia && <span className="stx-badge blueprint">{p.referencia}</span>}
                            {!p.ativo && <span className="stx-badge">pausado</span>}
                          </p>
                          <p className="stx-func-itens">
                            {temRoteiro
                              ? p.roteiro.map((e) => {
                                  const nomesMaquinas = maquinas.filter((m) => (e.maquinasIds || []).includes(m.id)).map((m) => m.nome);
                                  const metasTexto = periodos.map((per) => `${per.nome}:${(e.metas || {})[per.id as keyof typeof e.metas] || 0}`).join(" ");
                                  return `${e.operacao} (${metasTexto}${nomesMaquinas.length ? " · " + nomesMaquinas.join(", ") : ""})`;
                                }).join(" → ")
                              : "sem fluxo de produção cadastrado"}
                          </p>
                        </div>
                        <div className="stx-entry-right">
                          <button
                            className={`stx-icon-btn ${p.ativo ? "on" : ""}`}
                            title={p.ativo ? "Pausar" : "Retomar"}
                            onClick={() => toggleProdutoAtivo(p.id)}
                          >
                            {p.ativo ? "⏸" : "▶"}
                          </button>
                          <button className="stx-icon-btn" title="Editar" onClick={() => editProduto(p)}>✎</button>
                          <button className="stx-icon-btn danger" title="Excluir" onClick={() => deleteProduto(p.id)}>✕</button>
                        </div>
                      </div>
                      <div className="stx-func-rates">
                        <div className="stx-func-rate">
                          <span className="stx-func-rate-label">Valor recebido</span>
                          <span className="stx-func-rate-value">{formatBRL(p.valorUnitario)}</span>
                        </div>
                        <div className="stx-func-rate">
                          <span className="stx-func-rate-label">Custo de produção</span>
                          <span className="stx-func-rate-value">{temRoteiro ? formatBRL(custo) : "—"}</span>
                        </div>
                        <div className="stx-func-rate">
                          <span className="stx-func-rate-label"><Percent size={11} className="stx-rate-icon" />Margem</span>
                          <span className="stx-func-rate-value" style={temRoteiro ? { color: corPorMargemPct(margemPct) } : undefined}>
                            {temRoteiro ? `${formatBRL(margemRS)} (${margemPct.toFixed(0)}%)` : "—"}
                          </span>
                        </div>
                        <div className="stx-func-rate">
                          <span className="stx-func-rate-label"><Clock size={11} className="stx-rate-icon" />Lucro/hora</span>
                          <span className="stx-func-rate-value highlight" style={temRoteiro ? { color: corPorLucroHora(lucroHora) } : undefined}>
                            {temRoteiro ? `${formatBRL(lucroHora)}/h` : "—"}
                          </span>
                        </div>
                      </div>
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
