// @ts-nocheck
// ---------------------------------------------------------------------------
// ARQUIVO TRANSPLANTADO DA FASE 1 (ver docs/legacy/briefing-claude-code-fase0-1.md).
//
// Este arquivo e o componente original (docs/legacy/sittech-custos.jsx, ~5.800
// linhas) migrado quase literalmente para dentro do projeto Next.js: as
// constantes, tipos, utilitarios puros e a camada de dados (window.storage ->
// storageService) ja foram extraidos para src/lib, src/types e src/services
// (Etapas 4, 5 parcial, 6, 7, 9 parcial). A quebra em componentes por dominio
// e em rotas reais (Etapas 2, 3, 8) ainda NAO foi feita - e o proximo passo,
// para poder validar cada dominio no navegador antes de mover o codigo.
//
// ts-nocheck suprimido de proposito nesta fase: o corpo do componente abaixo
// ainda nao esta tipado (formularios, handlers, calculos de capacidade e
// previsao). Tipar aqui agora seria retrabalho, ja que este arquivo sera
// desmontado na proxima etapa. Nao copiar este padrao para codigo novo.
// ---------------------------------------------------------------------------

"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Package, Clock, Users,
  DollarSign, TrendingUp, TrendingDown, Scale, Target, Sparkles, ClipboardList, Layers,
  AlertTriangle, Factory, Activity, PauseCircle, ClipboardCheck, Database,
} from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Cell, PieChart, Pie, ReferenceLine, ReferenceArea,
} from "recharts";

import {
  CATEGORIAS, OPERACOES, PIE_COLORS, TITULOS_ABA, THEMES,
} from "@/lib/constants";
import { monthKey, monthLabel, shiftMonth, toISODate, mondayOf, weekLabel } from "@/lib/date";
import { formatBRL, toNumber, monthLabelShort, setModoPrivadoAtivo, corPorMargemPct } from "@/lib/format";
import { uid } from "@/lib/id";
import { serializeBackup } from "@/services/backup-service";
import { useAuthSession } from "@/hooks/useAuthSession";
import { useCadastrosBase } from "@/hooks/useCadastrosBase";
import { useFuncionarios } from "@/hooks/useFuncionarios";
import { useMaquinas } from "@/hooks/useMaquinas";
import { useProdutos } from "@/hooks/useProdutos";
import { usePrevisoes } from "@/hooks/usePrevisoes";
import { useCustos } from "@/hooks/useCustos";
import { useFaturamentos } from "@/hooks/useFaturamentos";
import { useUsuarios } from "@/hooks/useUsuarios";
import { useAuditoria } from "@/hooks/useAuditoria";
import { useGruposAbertosSidebar } from "@/hooks/useGruposAbertosSidebar";
import { GRUPOS_PERMISSOES, PRESET_SUPERVISAO_PRODUCAO, temPermissao } from "@/lib/permissoes";
import GlobalStyles from "@/components/shell/GlobalStyles";
import Sidebar from "@/components/shell/Sidebar";
import LoginScreen from "@/components/shell/LoginScreen";
import RecoveryPasswordScreen from "@/components/shell/RecoveryPasswordScreen";
import TopBarActions from "@/components/shell/TopBarActions";
import AccountModal from "@/components/shell/AccountModal";
import {
  calcularPeriodosComDuracao, filtrarPeriodosValidos, calcularHorasPorDia,
} from "@/lib/calculations/periodos";
import {
  calcularTotalFixoAtivo, calcularCustoMensalFuncionario, calcularTotalCustoFuncionariosAtivos,
  calcularCustoHoraEOperacoes, calcularCustoHoraIndividual, calcularCustoHoraSittech,
  calcularMetaFaturamento,
} from "@/features/custo-hora/calculations";

const emptyForm = { descricao: "", categoria: CATEGORIAS[0], valor: "" };
const emptyFuncForm = { nome: "", operacao: OPERACOES[0], salarioBase: "" };

function BITooltip({ active, payload, label, unit }) {
  if (!active || !payload || !payload.length) return null;
  const fmt = (v) => (unit === "percent" ? `${Number(v).toFixed(1)}%` : unit === "number" ? `${v}` : formatBRL(v));
  return (
    <div className="stx-chart-tooltip">
      <p className="stx-chart-tooltip-label">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="stx-chart-tooltip-item" style={{ color: p.color || p.fill }}>{p.name}: {fmt(p.value)}</p>
      ))}
    </div>
  );
}

const TIPOS_GRAFICO = [
  { id: "bar", label: "Barra" },
  { id: "line", label: "Linha" },
  { id: "area", label: "Área" },
];

function ChartTypeToggle({ value, onChange }) {
  return (
    <div className="stx-chart-type-toggle">
      {TIPOS_GRAFICO.map((t) => (
        <button
          key={t.id}
          type="button"
          className={value === t.id ? "active" : ""}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function PainelAguardandoIntegracao({ icone, titulo, pergunta, descricao }) {
  const Icone = icone || Database;
  return (
    <div className="stx-panel stx-placeholder-pr">
      <span className="stx-placeholder-pr-icone"><Icone size={26} /></span>
      <p className="stx-placeholder-pr-titulo">{titulo}</p>
      <p className="stx-placeholder-pr-pergunta">"{pergunta}"</p>
      <p className="stx-placeholder-pr-descricao">{descricao}</p>
      <p className="stx-placeholder-pr-status">
        <Factory size={13} /> Aguardando integração com a Plataforma Ninja — essa página se popula sozinha assim que os dados de produção real chegarem.
      </p>
    </div>
  );
}

export default function SittechApp() {
  const router = useRouter();
  const [abaAtiva, setAbaAtiva] = useState("inicio"); // 'inicio' | 'custos' | 'funcionarios' | 'produtos' | 'previsao' | 'horaEmpresa' | 'faturamento' | 'bi' | 'importar'
  const [tema, setTema] = useState("dark"); // 'dark' | 'light'
  const cores = THEMES[tema];
  const [modoPrivado, setModoPrivado] = useState(false);
  function toggleModoPrivado() {
    const next = !modoPrivado;
    setModoPrivadoAtivo(next);
    setModoPrivado(next);
  }
  const { gruposAbertos, toggleGrupo } = useGruposAbertosSidebar(abaAtiva);

  // Autenticação unificada — Supabase Auth + public.usuarios, mesmo hook
  // usado por /previsao, /capacidade, /custo-hora, /produtos, /maquinas.
  const auth = useAuthSession();
  const {
    autenticado, usuarioLogado, restaurandoSessao,
    loginUsuario, setLoginUsuario, loginSenha, setLoginSenha, loginErro, loginCarregando, handleLogin, handleLogout,
    registrarAuditoria,
    minhaContaAberta, setMinhaContaAberta, abrirMinhaConta,
    minhaSenhaAtual, setMinhaSenhaAtual, minhaSenhaNova, setMinhaSenhaNova,
    minhaSenhaConfirma, setMinhaSenhaConfirma, minhaContaMsg, alterarMinhaSenha,
    emModoRecovery, novaSenhaRecovery, setNovaSenhaRecovery, confirmarSenhaRecovery, setConfirmarSenhaRecovery,
    recoveryMsg, recoverySalvando, recoverySucesso, definirNovaSenhaRecovery, concluirRecovery,
  } = auth;

  // "Início" mostra faturamento/lucro/meta — dado de Financeiro. Quem não
  // tem a permissão 'financeiro' (nem é admin) nunca deveria ver essa tela
  // por padrão; manda direto pra Produção Real, que é o que ela de fato
  // pode usar. Sem isso, o dashboard financeiro ficava visível de graça
  // pra qualquer login, já que "inicio" é sempre a aba inicial.
  useEffect(() => {
    if (!autenticado || !usuarioLogado || abaAtiva !== "inicio") return;
    if (usuarioLogado.papel === "admin" || temPermissao(usuarioLogado, "financeiro")) return;
    if (temPermissao(usuarioLogado, "producao_real_apontamento")) {
      router.push("/producao-real");
    }
  }, [autenticado, usuarioLogado, abaAtiva, router]);

  // Cadastros-base (categorias, operações, períodos, configurações da
  // empresa) já migrados pro Supabase — fonte única também aqui, pra não
  // divergir do que /produtos, /maquinas, /custo-hora, /capacidade já usam.
  // O estado local `categorias`/`operacoes`/`periodos`/`diasUteis*` abaixo
  // continua existindo só para o backup/restauração (fora do escopo desta
  // etapa) — não é mais a fonte usada pra exibir ou calcular nada.
  const cadastrosBase = useCadastrosBase(autenticado);
  // Ordem exigida: auth pronta -> cadastros-base -> funcionários -> máquinas
  // -> produtos -> previsões -> custos -> faturamentos. `/` não tem CRUD de
  // máquinas nem de produtos (extraído pra /maquinas e /produtos na Fase 1)
  // — máquinas só existe aqui pra manter a ordem; produtos alimenta o
  // indicador "Produtos cadastrados" do início; previsões alimenta o card
  // "Semana atual"; custos e faturamentos têm CRUD completo aqui (abas
  // "Custos mensais" e "Faturamento mensal", nunca extraídas na Fase 1).
  const funcionariosHook = useFuncionarios(autenticado && !cadastrosBase.loading);
  const maquinasHook = useMaquinas(autenticado && !cadastrosBase.loading && !funcionariosHook.loading);
  const produtosHook = useProdutos(autenticado && !cadastrosBase.loading && !funcionariosHook.loading && !maquinasHook.loading);
  const previsoesHook = usePrevisoes(
    autenticado && !cadastrosBase.loading && !funcionariosHook.loading && !maquinasHook.loading && !produtosHook.loading
  );
  const custosHook = useCustos(
    autenticado && !cadastrosBase.loading && !funcionariosHook.loading && !maquinasHook.loading && !produtosHook.loading && !previsoesHook.loading
  );
  const faturamentosHook = useFaturamentos(
    autenticado && !cadastrosBase.loading && !funcionariosHook.loading && !maquinasHook.loading && !produtosHook.loading && !previsoesHook.loading && !custosHook.loading
  );
  // Usuários + auditoria (aba "Usuários", admin only) — última no encadeamento,
  // nada mais depende deles.
  const usuariosHook = useUsuarios(
    autenticado && !cadastrosBase.loading && !funcionariosHook.loading && !maquinasHook.loading && !produtosHook.loading && !previsoesHook.loading && !custosHook.loading && !faturamentosHook.loading
  );
  const auditoriaHook = useAuditoria(
    autenticado && !cadastrosBase.loading && !funcionariosHook.loading && !maquinasHook.loading && !produtosHook.loading && !previsoesHook.loading && !custosHook.loading && !faturamentosHook.loading
  );

  const emptyUsuarioForm = { nome: "", email: "", papel: "usuario" };
  const [showUsuarioForm, setShowUsuarioForm] = useState(false);
  const [editingUsuarioId, setEditingUsuarioId] = useState(null);
  const [usuarioForm, setUsuarioForm] = useState(emptyUsuarioForm);
  const [permissoesForm, setPermissoesForm] = useState([]);
  const [novaSenhaForm, setNovaSenhaForm] = useState("");
  const [usuarioFormErro, setUsuarioFormErro] = useState("");
  const [resetandoSenhaId, setResetandoSenhaId] = useState(null);
  const [senhaResetForm, setSenhaResetForm] = useState("");

  function resetUsuarioForm() {
    setUsuarioForm(emptyUsuarioForm);
    setPermissoesForm([]);
    setEditingUsuarioId(null);
    setShowUsuarioForm(false);
    setNovaSenhaForm("");
    setUsuarioFormErro("");
  }
  async function editUsuario(u) {
    setUsuarioForm({ nome: u.nome, email: u.email, papel: u.papel });
    setPermissoesForm(u.papel === "admin" ? [] : await usuariosHook.carregarPermissoesUsuario(u.id));
    setEditingUsuarioId(u.id);
    setShowUsuarioForm(true);
    setUsuarioFormErro("");
  }
  function togglePermissaoForm(chave) {
    setPermissoesForm((prev) => (prev.includes(chave) ? prev.filter((p) => p !== chave) : [...prev, chave]));
  }
  function aplicarPresetSupervisaoProducao() {
    setPermissoesForm([...PRESET_SUPERVISAO_PRODUCAO]);
  }
  async function submitUsuario() {
    if (!usuarioForm.nome.trim() || !usuarioForm.email.trim()) {
      setUsuarioFormErro("Preenche nome e e-mail.");
      return;
    }
    const emailDuplicado = usuariosHook.usuarios.some(
      (u) => u.email.toLowerCase() === usuarioForm.email.trim().toLowerCase() && u.id !== editingUsuarioId
    );
    if (emailDuplicado) {
      setUsuarioFormErro("Já existe um usuário com esse e-mail.");
      return;
    }
    if (editingUsuarioId) {
      const usuarioAntigo = usuariosHook.usuarios.find((u) => u.id === editingUsuarioId);
      if (usuarioAntigo && usuarioAntigo.papel === "admin" && usuarioForm.papel !== "admin") {
        const outrosAdmins = usuariosHook.usuarios.filter((u) => u.papel === "admin" && u.ativo && u.id !== editingUsuarioId);
        if (outrosAdmins.length === 0) {
          setUsuarioFormErro("Não é possível rebaixar o último administrador ativo.");
          return;
        }
      }
      const ok = await usuariosHook.atualizarUsuario(editingUsuarioId, { nome: usuarioForm.nome, papel: usuarioForm.papel });
      if (!ok) {
        setUsuarioFormErro(usuariosHook.erro || "Não foi possível salvar o usuário.");
        return;
      }
      // admin nunca precisa de linhas em usuario_permissoes (acesso total
      // automático) — some com qualquer permissão que tivesse antes de virar admin.
      const permissoesParaSalvar = usuarioForm.papel === "admin" ? [] : permissoesForm;
      const okPermissoes = await usuariosHook.salvarPermissoesUsuario(editingUsuarioId, permissoesParaSalvar);
      if (!okPermissoes) {
        setUsuarioFormErro(usuariosHook.erro || "Usuário salvo, mas não foi possível salvar as permissões.");
        return;
      }
      await registrarAuditoria("Editou usuário", usuarioForm.nome);
      auditoriaHook.recarregar();
    } else {
      if (!novaSenhaForm || novaSenhaForm.length < 6) {
        setUsuarioFormErro("Define uma senha com pelo menos 6 caracteres.");
        return;
      }
      const novo = await usuariosHook.criarUsuario({
        nome: usuarioForm.nome, email: usuarioForm.email, senha: novaSenhaForm, papel: usuarioForm.papel,
        permissoes: usuarioForm.papel === "admin" ? [] : permissoesForm,
      });
      if (!novo) {
        setUsuarioFormErro(usuariosHook.erro || "Não foi possível criar o usuário.");
        return;
      }
      await registrarAuditoria("Criou usuário", usuarioForm.nome);
      auditoriaHook.recarregar();
    }
    resetUsuarioForm();
  }
  async function toggleAtivoUsuario(u) {
    if (u.ativo && u.papel === "admin") {
      const outrosAdminsAtivos = usuariosHook.usuarios.filter((x) => x.papel === "admin" && x.ativo && x.id !== u.id);
      if (outrosAdminsAtivos.length === 0) {
        setUsuarioFormErro("Não é possível desativar o último administrador ativo.");
        return;
      }
    }
    const ok = await usuariosHook.alternarUsuarioAtivo(u.id);
    if (!ok) return;
    await registrarAuditoria(u.ativo ? "Desativou usuário" : "Ativou usuário", u.nome);
    auditoriaHook.recarregar();
  }
  async function confirmarResetSenha(u) {
    if (!senhaResetForm || senhaResetForm.length < 6) {
      setUsuarioFormErro("Define uma senha com pelo menos 6 caracteres.");
      return;
    }
    const ok = await usuariosHook.resetarSenhaUsuario(u.id, senhaResetForm);
    if (!ok) {
      setUsuarioFormErro(usuariosHook.erro || "Não foi possível redefinir a senha.");
      return;
    }
    await registrarAuditoria("Redefiniu senha", u.nome);
    auditoriaHook.recarregar();
    setResetandoSenhaId(null);
    setSenhaResetForm("");
    setUsuarioFormErro("");
  }

  const [currentMonth, setCurrentMonth] = useState(monthKey(new Date()));

  const [showFixedForm, setShowFixedForm] = useState(false);
  const [editingFixedId, setEditingFixedId] = useState(null);
  const [fixedForm, setFixedForm] = useState(emptyForm);
  const [novaCategoriaFixed, setNovaCategoriaFixed] = useState(false);
  const [textoNovaCategoriaFixed, setTextoNovaCategoriaFixed] = useState("");

  const [showVarForm, setShowVarForm] = useState(false);
  const [editingVarId, setEditingVarId] = useState(null);
  const [varForm, setVarForm] = useState(emptyForm);
  const [novaCategoriaVar, setNovaCategoriaVar] = useState(false);
  const [textoNovaCategoriaVar, setTextoNovaCategoriaVar] = useState("");

  const [showFuncForm, setShowFuncForm] = useState(false);
  const [editingFuncId, setEditingFuncId] = useState(null);
  const [funcForm, setFuncForm] = useState(emptyFuncForm);
  const [funcCustos, setFuncCustos] = useState([]);
  const [novaOperacao, setNovaOperacao] = useState(false);
  const [textoNovaOperacao, setTextoNovaOperacao] = useState("");

  const emptyReceitaForm = { data: `${monthKey(new Date())}-01`, descricao: "", valor: "" };
  const [showReceitaForm, setShowReceitaForm] = useState(false);
  const [editingReceitaId, setEditingReceitaId] = useState(null);
  const [receitaForm, setReceitaForm] = useState(emptyReceitaForm);

  // Previsão Semanal/Capacidade migraram para /previsao e /capacidade
  // (features/previsao, features/capacidade) — só a margem desejada
  // continua aqui, lida pelo card "Meta semanal" do menu lateral.
  const margemDesejada = "20";

  // Custos fixos/pontuais vêm do Supabase (useCustos) — mesma fonte usada
  // em /produtos, /maquinas, /custo-hora, /previsao, /capacidade. O
  // `fixedCosts`/`variableEntries` local (useState acima) continua
  // existindo só para backup/restauração do blob legado.
  const activeFixed = useMemo(() => custosHook.fixedCosts.filter((f) => f.ativo), [custosHook.fixedCosts]);

  const filteredVariable = useMemo(
    () => custosHook.variableEntries.filter((e) => e.mes === currentMonth).sort((a, b) => b.valor - a.valor),
    [custosHook.variableEntries, currentMonth]
  );

  const totalFixo = useMemo(() => calcularTotalFixoAtivo(custosHook.fixedCosts), [custosHook.fixedCosts]);
  const totalVariavel = useMemo(() => filteredVariable.reduce((s, e) => s + Number(e.valor || 0), 0), [filteredVariable]);
  const total = totalFixo + totalVariavel;

  const porCategoria = useMemo(() => {
    const map = {};
    activeFixed.forEach((f) => { map[f.categoria] = (map[f.categoria] || 0) + Number(f.valor || 0); });
    filteredVariable.forEach((e) => { map[e.categoria] = (map[e.categoria] || 0) + Number(e.valor || 0); });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [activeFixed, filteredVariable]);

  const maxCategoria = porCategoria.length ? porCategoria[0][1] : 1;

  // ---- custos fixos ----
  function resetFixedForm() {
    setFixedForm(emptyForm);
    setEditingFixedId(null);
    setShowFixedForm(false);
  }
  async function submitFixed() {
    if (!fixedForm.descricao.trim() || !fixedForm.valor) return;
    const valorNum = toNumber(fixedForm.valor);
    const payload = { descricao: fixedForm.descricao, categoria: fixedForm.categoria, valor: valorNum };
    if (editingFixedId) {
      await custosHook.atualizarFixedCost(editingFixedId, payload);
    } else {
      await custosHook.criarFixedCost(payload);
    }
    resetFixedForm();
  }
  function editFixed(f) {
    setFixedForm({ descricao: f.descricao, categoria: f.categoria, valor: String(f.valor) });
    setEditingFixedId(f.id);
    setShowFixedForm(true);
  }
  async function confirmNovaCategoriaFixed() {
    const nome = await cadastrosBase.criarCategoria(textoNovaCategoriaFixed);
    if (nome) setFixedForm((f) => ({ ...f, categoria: nome }));
    setTextoNovaCategoriaFixed("");
    setNovaCategoriaFixed(false);
  }
  function toggleFixedAtivo(id) {
    custosHook.alternarFixedCostAtivo(id);
  }
  function deleteFixed(id) {
    custosHook.removerFixedCost(id);
  }

  // ---- custos pontuais ----
  function resetVarForm() {
    setVarForm(emptyForm);
    setEditingVarId(null);
    setShowVarForm(false);
  }
  async function submitVar() {
    if (!varForm.descricao.trim() || !varForm.valor) return;
    const valorNum = toNumber(varForm.valor);
    if (editingVarId) {
      await custosHook.atualizarVariableEntry(editingVarId, { mes: currentMonth, descricao: varForm.descricao, categoria: varForm.categoria, valor: valorNum });
    } else {
      await custosHook.criarVariableEntry({ mes: currentMonth, descricao: varForm.descricao, categoria: varForm.categoria, valor: valorNum });
    }
    resetVarForm();
  }
  async function confirmNovaCategoriaVar() {
    const nome = await cadastrosBase.criarCategoria(textoNovaCategoriaVar);
    if (nome) setVarForm((f) => ({ ...f, categoria: nome }));
    setTextoNovaCategoriaVar("");
    setNovaCategoriaVar(false);
  }
  function editVar(entry) {
    setVarForm({ descricao: entry.descricao, categoria: entry.categoria, valor: String(entry.valor) });
    setEditingVarId(entry.id);
    setShowVarForm(true);
  }
  function deleteVar(id) {
    custosHook.removerVariableEntry(id);
  }

  // ---- funcionários ----
  // Funcionários + custos vêm do Supabase (useFuncionarios) — mesma fonte
  // usada em /produtos, /maquinas, /custo-hora, /previsao, /capacidade.
  // O `funcionarios` local (useState acima) continua existindo só para
  // backup/restauração do blob legado (fora do escopo desta etapa).
  const funcionariosAtivos = useMemo(() => funcionariosHook.funcionarios.filter((f) => f.ativo), [funcionariosHook.funcionarios]);

  const custoMensalFunc = calcularCustoMensalFuncionario;
  const totalCustoFuncionariosAtivos = useMemo(
    () => calcularTotalCustoFuncionariosAtivos(funcionariosAtivos),
    [funcionariosAtivos]
  );

  // horas produtivas: derivadas dos períodos de trabalho reais (M1, M2, M3, T1, T2, T3)
  // — periodos/diasUteis vêm do Supabase (cadastrosBase), mesma fonte usada
  // em /custo-hora, pra não divergir do que aquela tela mostra.
  const periodosComDuracao = useMemo(() => calcularPeriodosComDuracao(cadastrosBase.periodos), [cadastrosBase.periodos]);
  const periodosValidos = useMemo(() => filtrarPeriodosValidos(periodosComDuracao), [periodosComDuracao]);
  const horasPorDiaCalc = useMemo(() => calcularHorasPorDia(periodosValidos), [periodosValidos]);

  const horasProdutivasFuncionario = useMemo(() => horasPorDiaCalc * toNumber(cadastrosBase.diasUteis), [horasPorDiaCalc, cadastrosBase.diasUteis]);

  const { custoHoraEmpresa, rateioPorHora } = useMemo(
    () => calcularCustoHoraEOperacoes(funcionariosHook.funcionarios, custosHook.fixedCosts, horasPorDiaCalc, cadastrosBase.diasUteis),
    [funcionariosHook.funcionarios, custosHook.fixedCosts, horasPorDiaCalc, cadastrosBase.diasUteis]
  );
  function custoHoraIndividual(f) {
    return calcularCustoHoraIndividual(custoMensalFunc(f), horasProdutivasFuncionario);
  }
  function custoHoraSittech(f) {
    return calcularCustoHoraSittech(custoHoraIndividual(f), rateioPorHora);
  }

  function resetFuncForm() {
    setFuncForm(emptyFuncForm);
    setFuncCustos([]);
    setEditingFuncId(null);
    setShowFuncForm(false);
  }
  function addFuncCustoItem() {
    setFuncCustos([...funcCustos, { id: uid(), descricao: "", valor: "" }]);
  }
  function updateFuncCustoItem(id, field, value) {
    setFuncCustos(funcCustos.map((c) => (c.id === id ? { ...c, [field]: value } : c)));
  }
  function removeFuncCustoItem(id) {
    setFuncCustos(funcCustos.filter((c) => c.id !== id));
  }
  const funcCustosTotalPreview = useMemo(
    () => toNumber(funcForm.salarioBase) + funcCustos.reduce((s, c) => s + toNumber(c.valor), 0),
    [funcCustos, funcForm.salarioBase]
  );
  async function submitFunc() {
    if (!funcForm.nome.trim()) return;
    const custosLimpos = funcCustos
      .filter((c) => c.descricao.trim() && c.valor)
      .map((c) => ({ descricao: c.descricao.trim(), valor: toNumber(c.valor) }));
    const payload = {
      nome: funcForm.nome.trim(),
      operacao: funcForm.operacao,
      salarioBase: toNumber(funcForm.salarioBase),
      custos: custosLimpos,
    };
    if (editingFuncId) {
      await funcionariosHook.atualizarFuncionario(editingFuncId, payload);
    } else {
      await funcionariosHook.criarFuncionario(payload);
    }
    resetFuncForm();
  }
  function editFunc(f) {
    setFuncForm({ nome: f.nome, operacao: f.operacao, salarioBase: String(f.salarioBase || "") });
    setFuncCustos(f.custos.map((c) => ({ ...c })));
    setEditingFuncId(f.id);
    setShowFuncForm(true);
  }
  async function confirmNovaOperacao() {
    const nome = await cadastrosBase.criarOperacao(textoNovaOperacao);
    if (nome) setFuncForm((f) => ({ ...f, operacao: nome }));
    setTextoNovaOperacao("");
    setNovaOperacao(false);
  }
  function toggleFuncAtivo(id) {
    funcionariosHook.alternarFuncionarioAtivo(id);
  }
  function deleteFunc(id) {
    funcionariosHook.removerFuncionario(id);
  }
  function duplicateFunc(f) {
    funcionariosHook.duplicarFuncionario(f);
  }

  // ---- faturamento mensal ----
  function formatDataBR(iso) {
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  }
  // Faturamento/receitas vêm do Supabase (useFaturamentos) — o
  // `faturamentos` local (useState acima) continua existindo só para
  // backup/restauração do blob legado.
  const fatAtual = useMemo(
    () => faturamentosHook.faturamentos.find((f) => f.mes === currentMonth) || { mes: currentMonth, receitas: [], numFuncionarios: "", custoFuncionariosTotal: "", custoFixoTotal: "" },
    [faturamentosHook.faturamentos, currentMonth]
  );
  const receitasDoMes = useMemo(
    () => [...fatAtual.receitas].sort((a, b) => a.data.localeCompare(b.data)),
    [fatAtual]
  );
  const faturamentoBruto = useMemo(() => receitasDoMes.reduce((s, r) => s + Number(r.valor || 0), 0), [receitasDoMes]);
  const impostoMes = faturamentoBruto * 0.09;
  const custoTotalMes = toNumber(fatAtual.custoFuncionariosTotal) + toNumber(fatAtual.custoFixoTotal);
  const lucroLiquidoMes = faturamentoBruto - impostoMes - custoTotalMes;
  const lucroLiquidoPctMes = faturamentoBruto > 0 ? (lucroLiquidoMes / faturamentoBruto) * 100 : 0;

  function resetReceitaForm() {
    setReceitaForm({ data: `${currentMonth}-01`, descricao: "", valor: "" });
    setEditingReceitaId(null);
    setShowReceitaForm(false);
  }
  async function submitReceita() {
    if (!receitaForm.data || !receitaForm.valor) return;
    const valorNum = toNumber(receitaForm.valor);
    await faturamentosHook.salvarReceita({
      id: editingReceitaId || undefined, data: receitaForm.data, descricao: receitaForm.descricao.trim(), valor: valorNum,
    });
    resetReceitaForm();
  }
  function editReceita(r) {
    setReceitaForm({ data: r.data, descricao: r.descricao || "", valor: String(r.valor) });
    setEditingReceitaId(r.id);
    setShowReceitaForm(true);
  }
  async function deleteReceita(id) {
    await faturamentosHook.removerReceita(id);
  }
  async function updateFatCampos(campos) {
    await faturamentosHook.atualizarCamposMes(currentMonth, campos);
  }
  async function preencherComDadosAtuais() {
    await updateFatCampos({
      numFuncionarios: String(funcionariosAtivos.length),
      custoFuncionariosTotal: String(Math.round(totalCustoFuncionariosAtivos * 100) / 100),
      custoFixoTotal: String(Math.round(totalFixo * 100) / 100),
    });
  }
  const historicoFaturamento = useMemo(() => {
    return [...faturamentosHook.faturamentos]
      .filter((f) => f.receitas.length > 0 || f.custoFuncionariosTotal || f.custoFixoTotal)
      .sort((a, b) => a.mes.localeCompare(b.mes))
      .map((f) => {
        const bruto = f.receitas.reduce((s, r) => s + Number(r.valor || 0), 0);
        const imposto = bruto * 0.09;
        const custoTotal = toNumber(f.custoFuncionariosTotal) + toNumber(f.custoFixoTotal);
        const lucro = bruto - imposto - custoTotal;
        const pct = bruto > 0 ? (lucro / bruto) * 100 : 0;
        return { mes: f.mes, bruto, custoTotal, lucro, pct };
      });
  }, [faturamentosHook.faturamentos]);

  // ---- painel BI ----
  const [biFiltroModo, setBiFiltroModo] = useState("todos"); // 'todos' | 'mes' | 'intervalo'
  const [biMes, setBiMes] = useState(currentMonth);
  const [biMesInicio, setBiMesInicio] = useState(currentMonth);
  const [biMesFim, setBiMesFim] = useState(currentMonth);

  const [textoImportFunc, setTextoImportFunc] = useState("");
  const [resultadoImportFunc, setResultadoImportFunc] = useState("");
  const [textoImportFatMeses, setTextoImportFatMeses] = useState("");
  const [resultadoImportFatMeses, setResultadoImportFatMeses] = useState("");
  const [textoImportReceitas, setTextoImportReceitas] = useState("");
  const [resultadoImportReceitas, setResultadoImportReceitas] = useState("");
  const [backupTexto, setBackupTexto] = useState("");

  const dadosBITodos = useMemo(() => {
    return [...faturamentosHook.faturamentos]
      .filter((f) => f.receitas.length > 0 || f.custoFuncionariosTotal || f.custoFixoTotal)
      .sort((a, b) => a.mes.localeCompare(b.mes))
      .map((f) => {
        const bruto = f.receitas.reduce((s, r) => s + Number(r.valor || 0), 0);
        const custoFunc = toNumber(f.custoFuncionariosTotal);
        const custoFixo = toNumber(f.custoFixoTotal);
        const custoTotal = custoFunc + custoFixo;
        const imposto = bruto * 0.09;
        const lucro = bruto - imposto - custoTotal;
        const margem = bruto > 0 ? (lucro / bruto) * 100 : 0;
        const numFunc = toNumber(f.numFuncionarios);
        const custoMedioFunc = numFunc > 0 ? custoFunc / numFunc : 0;
        return {
          mes: f.mes,
          mesLabel: monthLabelShort(f.mes),
          bruto, custoFunc, custoFixo, custoTotal, imposto, lucro, margem, numFunc, custoMedioFunc,
        };
      });
  }, [faturamentosHook.faturamentos]);

  const dadosBI = useMemo(() => {
    if (biFiltroModo === "mes") return dadosBITodos.filter((d) => d.mes === biMes);
    if (biFiltroModo === "intervalo") {
      const [inicio, fim] = biMesInicio <= biMesFim ? [biMesInicio, biMesFim] : [biMesFim, biMesInicio];
      return dadosBITodos.filter((d) => d.mes >= inicio && d.mes <= fim);
    }
    return dadosBITodos;
  }, [dadosBITodos, biFiltroModo, biMes, biMesInicio, biMesFim]);

  const totalBrutoAcumulado = useMemo(() => dadosBI.reduce((s, d) => s + d.bruto, 0), [dadosBI]);
  const totalLucroAcumulado = useMemo(() => dadosBI.reduce((s, d) => s + d.lucro, 0), [dadosBI]);
  const margemMediaBI = dadosBI.length ? dadosBI.reduce((s, d) => s + d.margem, 0) / dadosBI.length : 0;
  const melhorMesBI = dadosBI.length ? dadosBI.reduce((a, b) => (b.lucro > a.lucro ? b : a)) : null;
  const piorMesBI = dadosBI.length ? dadosBI.reduce((a, b) => (b.lucro < a.lucro ? b : a)) : null;
  const pieCategoriasBI = useMemo(() => porCategoria.map(([name, value]) => ({ name, value })), [porCategoria]);

  const [tipoGraficoBrutoCusto, setTipoGraficoBrutoCusto] = useState("bar");
  const [tipoGraficoLucro, setTipoGraficoLucro] = useState("bar");
  const [tipoGraficoMargem, setTipoGraficoMargem] = useState("line");
  const [tipoGraficoComposicao, setTipoGraficoComposicao] = useState("bar");
  const [tipoGraficoFuncionarios, setTipoGraficoFuncionarios] = useState("line");
  const [tipoGraficoCustoMedio, setTipoGraficoCustoMedio] = useState("line");

  function renderTimeSeriesChart({ tipo, data, series, yTickFormatter, unit, stacked }) {
    const grid = <CartesianGrid strokeDasharray="3 3" stroke={cores.border} vertical={false} />;
    const xAxis = <XAxis dataKey="mesLabel" tick={{ fill: cores.textMuted, fontSize: 11 }} axisLine={{ stroke: cores.border }} tickLine={false} />;
    const yAxis = <YAxis tick={{ fill: cores.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={yTickFormatter} allowDecimals={unit === "number" ? false : undefined} />;
    const tooltip = <Tooltip content={<BITooltip unit={unit} />} cursor={tipo === "bar" ? { fill: tema === "dark" ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)" } : undefined} />;
    const legend = series.length > 1 ? <Legend wrapperStyle={{ fontSize: 11, color: cores.textMuted }} /> : null;

    if (tipo === "line") {
      return (
        <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          {grid}{xAxis}{yAxis}{tooltip}{legend}
          {series.map((s) => (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={3} dot={{ r: 5, fill: s.color, stroke: cores.bg, strokeWidth: 2 }} activeDot={{ r: 7 }} />
          ))}
        </LineChart>
      );
    }
    if (tipo === "area") {
      return (
        <AreaChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          {grid}{xAxis}{yAxis}{tooltip}{legend}
          {series.map((s) => (
            <Area key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2.5} fill={s.color} fillOpacity={0.45} stackId={stacked ? "a" : undefined} />
          ))}
        </AreaChart>
      );
    }
    return (
      <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
        {grid}{xAxis}{yAxis}{tooltip}{legend}
        {series.map((s) => (
          <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} radius={[4, 4, 0, 0]} stackId={stacked ? "a" : undefined} />
        ))}
      </BarChart>
    );
  }

  function renderLucroChart(tipo) {
    const grid = <CartesianGrid strokeDasharray="3 3" stroke={cores.border} vertical={false} />;
    const xAxis = <XAxis dataKey="mesLabel" tick={{ fill: cores.textMuted, fontSize: 11 }} axisLine={{ stroke: cores.border }} tickLine={false} />;
    const yAxis = <YAxis tick={{ fill: cores.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />;
    const tooltip = <Tooltip content={<BITooltip unit="currency" />} cursor={tipo === "bar" ? { fill: tema === "dark" ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)" } : undefined} />;
    const ref = <ReferenceLine y={0} stroke={cores.border} strokeWidth={2} />;
    if (tipo === "line") {
      return (
        <LineChart data={dadosBI} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          {grid}{xAxis}{yAxis}{tooltip}{ref}
          <Line type="monotone" dataKey="lucro" name="Lucro líquido" stroke={cores.accent} strokeWidth={3} dot={dotPorMargem} activeDot={{ r: 8 }} />
        </LineChart>
      );
    }
    if (tipo === "area") {
      return (
        <AreaChart data={dadosBI} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          {grid}{xAxis}{yAxis}{tooltip}{ref}
          <Area type="monotone" dataKey="lucro" name="Lucro líquido" stroke={cores.accent} strokeWidth={3} fill={cores.accent} fillOpacity={0.35} dot={dotPorMargem} />
        </AreaChart>
      );
    }
    return (
      <BarChart data={dadosBI} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
        {grid}{xAxis}{yAxis}{tooltip}{ref}
        <Bar dataKey="lucro" name="Lucro líquido" radius={[4, 4, 0, 0]}>
          {dadosBI.map((d, i) => <Cell key={i} fill={d.margem < 0 ? cores.danger : d.margem < 20 ? cores.warning : cores.accent} />)}
        </Bar>
      </BarChart>
    );
  }

  function renderMargemChart(tipo) {
    const grid = <CartesianGrid strokeDasharray="3 3" stroke={cores.border} vertical={false} />;
    const xAxis = <XAxis dataKey="mesLabel" tick={{ fill: cores.textMuted, fontSize: 11 }} axisLine={{ stroke: cores.border }} tickLine={false} />;
    const yAxis = <YAxis tick={{ fill: cores.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />;
    const tooltip = <Tooltip content={<BITooltip unit="percent" />} cursor={tipo === "bar" ? { fill: tema === "dark" ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)" } : undefined} />;
    const faixas = (
      <>
        <ReferenceArea y1={-1000} y2={0} fill={cores.danger} fillOpacity={0.18} ifOverflow="hidden" />
        <ReferenceArea y1={0} y2={20} fill={cores.warning} fillOpacity={0.18} ifOverflow="hidden" />
        <ReferenceArea y1={20} y2={1000} fill={cores.accent} fillOpacity={0.14} ifOverflow="hidden" />
        <ReferenceLine y={20} stroke={cores.warning} strokeWidth={2} strokeDasharray="5 3" />
        <ReferenceLine y={0} stroke={cores.border} strokeWidth={2} />
      </>
    );
    if (tipo === "line") {
      return (
        <LineChart data={dadosBI} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          {grid}{faixas}{xAxis}{yAxis}{tooltip}
          <Line type="monotone" dataKey="margem" name="Margem de lucro" stroke={cores.accent} strokeWidth={3} dot={dotPorMargem} activeDot={{ r: 8 }} />
        </LineChart>
      );
    }
    if (tipo === "area") {
      return (
        <AreaChart data={dadosBI} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          {grid}{faixas}{xAxis}{yAxis}{tooltip}
          <Area type="monotone" dataKey="margem" name="Margem de lucro" stroke={cores.accent} strokeWidth={3} fill={cores.accent} fillOpacity={0.3} dot={dotPorMargem} />
        </AreaChart>
      );
    }
    return (
      <BarChart data={dadosBI} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
        {grid}{faixas}{xAxis}{yAxis}{tooltip}
        <Bar dataKey="margem" name="Margem de lucro" radius={[4, 4, 0, 0]}>
          {dadosBI.map((d, i) => <Cell key={i} fill={corHexPorMargem(d.margem)} />)}
        </Bar>
      </BarChart>
    );
  }

  // ---- cores de alerta pra números críticos ----
  function corHexPorMargem(pct) {
    if (pct < 0) return cores.danger;
    if (pct < 20) return cores.warning;
    return cores.accent;
  }
  function dotPorMargem(props) {
    const { cx, cy, payload } = props;
    if (cx == null || cy == null) return null;
    const cor = corHexPorMargem(payload.margem);
    return (
      <g key={`dot-${payload.mes}`}>
        <circle cx={cx} cy={cy} r={9} fill={cor} opacity={0.25} />
        <circle cx={cx} cy={cy} r={6} fill={cor} stroke={cores.bg} strokeWidth={2} />
      </g>
    );
  }

  // ---- meta de faturamento por margem desejada ----
  const custoTotalMensalAtual = totalFixo + totalCustoFuncionariosAtivos;
  const { metaInvalida, faturamentoSemanalNecessario } = useMemo(
    () => calcularMetaFaturamento(custoTotalMensalAtual, toNumber(margemDesejada)),
    [custoTotalMensalAtual, margemDesejada]
  );

  // ---- ponto de equilíbrio (breakeven, margem 0%) ----
  const faturamentoBreakevenMensal = custoTotalMensalAtual / 0.91; // 1 - 9% de imposto
  const faturamentoBreakevenSemanal = faturamentoBreakevenMensal / (52 / 12);

  // ---- visão geral (início) ----
  const mesAtualReal = monthKey(new Date());
  const mesAnteriorReal = shiftMonth(mesAtualReal, -1);
  const dadosMesAtual = dadosBITodos.find((d) => d.mes === mesAtualReal) || null;
  const dadosMesAnterior = dadosBITodos.find((d) => d.mes === mesAnteriorReal) || null;
  const crescimentoFaturamento =
    dadosMesAnterior && dadosMesAnterior.bruto > 0 && dadosMesAtual
      ? ((dadosMesAtual.bruto - dadosMesAnterior.bruto) / dadosMesAnterior.bruto) * 100
      : null;
  const crescimentoLucro =
    dadosMesAnterior && dadosMesAnterior.lucro !== 0 && dadosMesAtual
      ? ((dadosMesAtual.lucro - dadosMesAnterior.lucro) / Math.abs(dadosMesAnterior.lucro)) * 100
      : null;
  const tendenciaUltimosMeses = useMemo(() => dadosBITodos.slice(-6), [dadosBITodos]);

  const semanaHojeISO = toISODate(mondayOf(new Date()));
  const semanaHojeRec = previsoesHook.previsoes.find((p) => p.semanaInicio === semanaHojeISO) || { itens: [], itensRealizados: [] };
  const previstoSemanaHoje = semanaHojeRec.itens.reduce((s, it) => s + it.quantidade * it.valorUnitario, 0);
  const realizadoSemanaHoje = (semanaHojeRec.itensRealizados || []).reduce((s, it) => s + it.quantidade * it.valorUnitario, 0);
  const metaSemanalUsaPrevisto = previstoSemanaHoje > 0;
  const metaSemanalFinal = metaSemanalUsaPrevisto ? previstoSemanaHoje : faturamentoSemanalNecessario;

  // ---- backup completo (só exportar — ver painel "Restaurar backup" na
  // aba "Importar dados" pra explicação de por que a restauração foi
  // removida) ----
  // Lê direto dos hooks Supabase (mesma fonte que a tela usa pra exibir),
  // nunca de estado local — assim o backup gerado sempre reflete os dados
  // reais do banco no momento do clique, não uma cópia potencialmente
  // desatualizada.
  function gerarBackupTexto() {
    return serializeBackup({
      fixedCosts: custosHook.fixedCosts,
      variableEntries: custosHook.variableEntries,
      categorias: cadastrosBase.categorias,
      operacoes: cadastrosBase.operacoes,
      funcionarios: funcionariosHook.funcionarios,
      periodos: cadastrosBase.periodos,
      diasUteis: cadastrosBase.diasUteis,
      diasUteisSemana: cadastrosBase.diasUteisSemana,
      faturamentos: faturamentosHook.faturamentos,
      produtos: produtosHook.produtos,
      maquinas: maquinasHook.maquinas,
      previsoes: previsoesHook.previsoes,
    });
  }
  function handleGerarBackup() {
    setBackupTexto(gerarBackupTexto());
  }
  async function handleCopiarBackup() {
    const texto = backupTexto || gerarBackupTexto();
    try {
      await navigator.clipboard.writeText(texto);
      setBackupTexto(texto);
    } catch (e) {
      // clipboard pode falhar (ex: Safari) — o texto já fica na caixa pra selecionar/copiar na mão
      setBackupTexto(texto);
    }
  }
  function handleBaixarBackup() {
    const texto = backupTexto || gerarBackupTexto();
    setBackupTexto(texto);
    const blob = new Blob([texto], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sittech-backup-${toISODate(new Date())}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ---- importação em massa ----
  // funcionário novo -> Supabase; operação reaproveitada se já existe,
  // criada no Supabase (nunca só no blob) se não existir — mesma regra de
  // dedupe de sempre, via cadastrosBase.criarOperacao.
  async function importarFuncionarios() {
    const linhas = textoImportFunc.split("\n").map((l) => l.trim()).filter(Boolean);
    let count = 0;
    for (const linha of linhas) {
      const partes = linha.split(";").map((p) => p.trim());
      if (partes.length < 3 || !partes[0]) continue;
      const [nome, operacao, salarioBase, ...resto] = partes;
      const custos = resto
        .filter(Boolean)
        .map((item) => {
          const [desc, val] = item.split(":");
          return { descricao: (desc || "").trim(), valor: toNumber(val) };
        })
        .filter((c) => c.descricao);
      const opDesejada = operacao || cadastrosBase.operacoes[0] || "Produção";
      const opFinal = await cadastrosBase.criarOperacao(opDesejada);
      const criado = await funcionariosHook.criarFuncionario({
        nome, operacao: opFinal || opDesejada, salarioBase: toNumber(salarioBase), custos,
      });
      if (criado) count++;
    }
    setResultadoImportFunc(count > 0 ? `${count} funcionário(s) importado(s).` : "Nenhuma linha válida encontrada — confira o formato.");
    setTextoImportFunc("");
  }

  async function importarFatMeses() {
    const linhas = textoImportFatMeses.split("\n").map((l) => l.trim()).filter(Boolean);
    let count = 0;
    for (const linha of linhas) {
      const partes = linha.split(";").map((p) => p.trim());
      if (partes.length < 4) continue;
      const [mes, num, custoFunc, custoFixo] = partes;
      if (!/^\d{4}-\d{2}$/.test(mes)) continue;
      const ok = await faturamentosHook.atualizarCamposMes(mes, {
        numFuncionarios: String(toNumber(num)), custoFuncionariosTotal: String(toNumber(custoFunc)), custoFixoTotal: String(toNumber(custoFixo)),
      });
      if (ok) count++;
    }
    setResultadoImportFatMeses(count > 0 ? `${count} mês(es) importado(s).` : "Nenhuma linha válida encontrada — confira o formato (AAAA-MM no início).");
    setTextoImportFatMeses("");
  }

  async function importarReceitas() {
    const linhas = textoImportReceitas.split("\n").map((l) => l.trim()).filter(Boolean);
    let count = 0;
    for (const linha of linhas) {
      const partes = linha.split(";").map((p) => p.trim());
      if (partes.length < 2) continue;
      const [data, valor, descricao] = partes;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) continue;
      const ok = await faturamentosHook.salvarReceita({ data, valor: toNumber(valor), descricao: descricao || "" });
      if (ok) count++;
    }
    setResultadoImportReceitas(count > 0 ? `${count} lançamento(s) importado(s).` : "Nenhuma linha válida encontrada — confira o formato (AAAA-MM-DD no início).");
    setTextoImportReceitas("");
  }

  return (
    <div className="stx-root">
      <GlobalStyles cores={cores} />

      {emModoRecovery ? (
        <RecoveryPasswordScreen
          tema={tema}
          novaSenha={novaSenhaRecovery}
          setNovaSenha={setNovaSenhaRecovery}
          confirmarSenha={confirmarSenhaRecovery}
          setConfirmarSenha={setConfirmarSenhaRecovery}
          mensagem={recoveryMsg}
          salvando={recoverySalvando}
          sucesso={recoverySucesso}
          onSubmit={definirNovaSenhaRecovery}
          onContinuar={concluirRecovery}
        />
      ) : cadastrosBase.loading || funcionariosHook.loading || maquinasHook.loading || produtosHook.loading || previsoesHook.loading || custosHook.loading || faturamentosHook.loading || restaurandoSessao || !autenticado ? (
        <LoginScreen
          loading={restaurandoSessao || (autenticado && (cadastrosBase.loading || funcionariosHook.loading || maquinasHook.loading || produtosHook.loading || previsoesHook.loading || custosHook.loading || faturamentosHook.loading))}
          tema={tema}
          loginUsuario={loginUsuario}
          setLoginUsuario={setLoginUsuario}
          loginSenha={loginSenha}
          setLoginSenha={setLoginSenha}
          loginErro={loginErro}
          loginCarregando={loginCarregando}
          onSubmit={handleLogin}
          campoLogin="email"
        />
      ) : (
      <>
      <div className="stx-layout">
        <Sidebar
          tema={tema}
          abaAtiva={abaAtiva}
          onNavigateTab={setAbaAtiva}
          gruposAbertos={gruposAbertos}
          toggleGrupo={toggleGrupo}
          usuarioLogado={usuarioLogado}
          metaSemanalUsaPrevisto={metaSemanalUsaPrevisto}
          metaInvalida={metaInvalida}
          metaSemanalFinal={metaSemanalFinal}
          formatBRL={formatBRL}
          onMetaClick={() => setAbaAtiva("inicio")}
        />

        <div className="stx-content-wrapper">
      {cadastrosBase.erro && <p className="stx-save-error">{cadastrosBase.erro}</p>}
      {funcionariosHook.erro && <p className="stx-save-error">{funcionariosHook.erro}</p>}
      {maquinasHook.erro && <p className="stx-save-error">{maquinasHook.erro}</p>}
      {produtosHook.erro && <p className="stx-save-error">{produtosHook.erro}</p>}
      {previsoesHook.erro && <p className="stx-save-error">{previsoesHook.erro}</p>}
      {custosHook.erro && <p className="stx-save-error">{custosHook.erro}</p>}
      {faturamentosHook.erro && <p className="stx-save-error">{faturamentosHook.erro}</p>}
      <div className="stx-header">
        <div>
            <h1 className={`stx-title ${abaAtiva === "inicio" ? "stx-title-grande" : ""}`}>
              {TITULOS_ABA[abaAtiva] || abaAtiva}
            </h1>
          {abaAtiva === "inicio" && (
            <p className="stx-saudacao">
              Bem-vindo de volta, <span>{usuarioLogado?.nome || loginUsuario}</span>.
            </p>
          )}
          {(abaAtiva === "custos" || abaAtiva === "faturamento") && (
            <div className="stx-month-nav" style={{ marginTop: 12 }}>
              <button className="stx-nav-btn" onClick={() => setCurrentMonth(shiftMonth(currentMonth, -1))}>‹</button>
              <span className="stx-month-label">{monthLabel(currentMonth)}</span>
              <button className="stx-nav-btn" onClick={() => setCurrentMonth(shiftMonth(currentMonth, 1))}>›</button>
            </div>
          )}
        </div>
        <div className="stx-header-right">
          <TopBarActions
            modoPrivado={modoPrivado}
            onToggleModoPrivado={toggleModoPrivado}
            tema={tema}
            onToggleTema={() => setTema((t) => (t === "dark" ? "light" : "dark"))}
            onAbrirMinhaConta={abrirMinhaConta}
            onSair={() => handleLogout()}
          />
          <div className={`stx-total-box ${abaAtiva === "inicio" ? "stx-total-box-com-icone" : ""}`}>
          {abaAtiva === "inicio" && (
            <>
              <span className="stx-total-icone-alvo"><Target size={20} /></span>
              <p className="stx-total-label">Meta semanal</p>
              <p className="stx-total-value">{metaSemanalUsaPrevisto || !metaInvalida ? formatBRL(metaSemanalFinal) : "—"}</p>
              <p className="stx-total-split">
                {metaSemanalUsaPrevisto ? "da previsão já lançada essa semana" : `calculada pela margem de ${margemDesejada}%`}
              </p>
            </>
          )}
          {abaAtiva === "custos" && (
            <>
              <p className="stx-total-label">Total do mês</p>
              <p className="stx-total-value">{formatBRL(total)}</p>
              <p className="stx-total-split">fixo {formatBRL(totalFixo)} · pontual {formatBRL(totalVariavel)}</p>
            </>
          )}
          {abaAtiva === "funcionarios" && (
            <>
              <p className="stx-total-label">Custo funcionários / mês</p>
              <p className="stx-total-value">{formatBRL(totalCustoFuncionariosAtivos)}</p>
              <p className="stx-total-split">{funcionariosAtivos.length} funcionário{funcionariosAtivos.length !== 1 ? "s" : ""} ativo{funcionariosAtivos.length !== 1 ? "s" : ""}</p>
            </>
          )}
          {abaAtiva === "faturamento" && (
            <>
              <p className="stx-total-label">Lucro líquido do mês</p>
              <p className="stx-total-value" style={{ color: corPorMargemPct(lucroLiquidoPctMes) }}>{formatBRL(lucroLiquidoMes)}</p>
              <p className="stx-total-split">{lucroLiquidoPctMes.toFixed(1)}% · bruto {formatBRL(faturamentoBruto)}</p>
            </>
          )}
          {abaAtiva === "bi" && (
            <>
              <p className="stx-total-label">Faturamento acumulado</p>
              <p className="stx-total-value">{formatBRL(totalBrutoAcumulado)}</p>
              <p className="stx-total-split">lucro acumulado {formatBRL(totalLucroAcumulado)}</p>
            </>
          )}
          {abaAtiva === "previsao" && (
            <>
              <p className="stx-total-label">Previsão da semana</p>
              <p className="stx-total-value">{formatBRL(valorPrevistoSemana)}</p>
              <p className="stx-total-split">realizado {formatBRL(valorRealizadoSemana)} · {percentualConcluidoSemana.toFixed(1)}%</p>
            </>
          )}
        </div>
      </div>
      </div>

        <div className="stx-content">

      {abaAtiva === "inicio" && (
        <div>
          <div className="stx-bi-stats">
            <div className="stx-destaque-box stx-destaque-com-icone">
              <div>
                <p className="stx-destaque-label">Faturamento do mês</p>
                <p className="stx-destaque-value">{dadosMesAtual ? formatBRL(dadosMesAtual.bruto) : "—"}</p>
                <p className="stx-destaque-sub">
                  {crescimentoFaturamento === null
                    ? "sem mês anterior pra comparar"
                    : `${crescimentoFaturamento >= 0 ? "▲" : "▼"} ${Math.abs(crescimentoFaturamento).toFixed(1)}% vs mês passado`}
                </p>
              </div>
              <span className="stx-destaque-icone verde"><DollarSign size={18} /></span>
            </div>
            <div className="stx-destaque-box stx-destaque-com-icone">
              <div>
                <p className="stx-destaque-label">Lucro líquido do mês</p>
                <p className="stx-destaque-value" style={dadosMesAtual ? { color: corPorMargemPct(dadosMesAtual.margem) } : undefined}>
                  {dadosMesAtual ? formatBRL(dadosMesAtual.lucro) : "—"}
                </p>
                <p className="stx-destaque-sub">
                  {dadosMesAtual
                    ? `${dadosMesAtual.margem.toFixed(1)}% de margem${crescimentoLucro !== null ? ` · ${crescimentoLucro >= 0 ? "▲" : "▼"} ${Math.abs(crescimentoLucro).toFixed(1)}%` : ""}`
                    : "sem dados lançados"}
                </p>
              </div>
              <span className={`stx-destaque-icone ${dadosMesAtual && dadosMesAtual.margem < 0 ? "vermelho" : dadosMesAtual && dadosMesAtual.margem < 20 ? "amarelo" : "verde"}`}>
                {dadosMesAtual && dadosMesAtual.margem < 0 ? <TrendingDown size={18} /> : <TrendingUp size={18} />}
              </span>
            </div>
            <div className="stx-destaque-box stx-destaque-com-icone">
              <div>
                <p className="stx-destaque-label">Ponto de equilíbrio / semana</p>
                <p className="stx-destaque-value">{formatBRL(faturamentoBreakevenSemanal)}</p>
                <p className="stx-destaque-sub">cobre fixo + funcionários + imposto</p>
              </div>
              <span className="stx-destaque-icone azul"><Scale size={18} /></span>
            </div>
            <div className="stx-destaque-box stx-destaque-com-icone">
              <div>
                <p className="stx-destaque-label">Meta semanal</p>
                <p className="stx-destaque-value">{metaSemanalUsaPrevisto || !metaInvalida ? formatBRL(metaSemanalFinal) : "—"}</p>
                <p className="stx-destaque-sub">
                  {metaSemanalUsaPrevisto ? "da previsão já lançada essa semana" : `pela margem de ${margemDesejada}% (sem previsão lançada)`}
                </p>
              </div>
              <span className="stx-destaque-icone verde"><Target size={18} /></span>
            </div>
            <div className="stx-destaque-box stx-destaque-com-icone">
              <div>
                <p className="stx-destaque-label">Faturado essa semana</p>
                <p className="stx-destaque-value">{formatBRL(realizadoSemanaHoje)}</p>
                <p className="stx-destaque-sub">
                  {metaSemanalFinal > 0 ? `${((realizadoSemanaHoje / metaSemanalFinal) * 100).toFixed(0)}% da meta semanal` : "sem meta pra comparar ainda"}
                </p>
              </div>
              <span className="stx-destaque-icone roxo"><Sparkles size={18} /></span>
            </div>
          </div>

          {!dadosMesAtual && (
            <div className="stx-panel">
              <p className="stx-empty">Ainda não tem faturamento lançado pra {monthLabel(mesAtualReal)}. Lance na aba "Faturamento mensal" pra essa visão ficar completa.</p>
            </div>
          )}

          <div className="stx-panel">
            <p className="stx-panel-title" style={{ marginBottom: 14 }}>Tendência dos últimos meses</p>
            {tendenciaUltimosMeses.length === 0 ? (
              <div className="stx-empty">Sem histórico suficiente ainda.</div>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={tendenciaUltimosMeses} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={cores.border} vertical={false} />
                  <XAxis dataKey="mesLabel" tick={{ fill: cores.textMuted, fontSize: 11 }} axisLine={{ stroke: cores.border }} tickLine={false} />
                  <YAxis tick={{ fill: cores.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip content={<BITooltip unit="currency" />} />
                  <Legend wrapperStyle={{ fontSize: 11, color: cores.textMuted }} />
                  <ReferenceLine y={0} stroke={cores.border} />
                  <Area type="monotone" dataKey="bruto" name="Faturamento bruto" stroke={cores.blueprint} strokeWidth={3} fill={cores.blueprint} fillOpacity={0.4} />
                  <Area type="monotone" dataKey="lucro" name="Lucro líquido" stroke={cores.accent} strokeWidth={3} fill={cores.accent} fillOpacity={0.3} dot={dotPorMargem} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="stx-grid">
            <div className="stx-panel">
              <p className="stx-panel-title" style={{ marginBottom: 4 }}>Semana atual</p>
              <p className="stx-panel-sub">{weekLabel(semanaHojeISO)}</p>
              <div className="stx-rateio-line">
                <span className="l"><ClipboardList size={14} className="stx-indicador-icon" />Previsto</span>
                <span className="v">{formatBRL(previstoSemanaHoje)}</span>
              </div>
              <div className="stx-rateio-line">
                <span className="l"><TrendingUp size={14} className="stx-indicador-icon" />Realizado</span>
                <span className="v">{formatBRL(realizadoSemanaHoje)}</span>
              </div>
              <div className="stx-rateio-line stx-rateio-highlight">
                <span className="l"><Scale size={14} className="stx-indicador-icon" />Ponto de equilíbrio</span>
                <span className="v">{formatBRL(faturamentoBreakevenSemanal)}</span>
              </div>
              <p className={`stx-alerta-caixa ${realizadoSemanaHoje >= faturamentoBreakevenSemanal ? "ok" : "alerta"}`}>
                <TrendingUp size={14} />
                {realizadoSemanaHoje >= faturamentoBreakevenSemanal
                  ? "Essa semana já cobre o ponto de equilíbrio."
                  : `Faltam ${formatBRL(faturamentoBreakevenSemanal - realizadoSemanaHoje)} pra cobrir o ponto de equilíbrio dessa semana.`}
              </p>
            </div>

            <div className="stx-panel">
              <p className="stx-panel-title" style={{ marginBottom: 14 }}>Outros indicadores</p>
              <div className="stx-rateio-line">
                <span className="l"><Users size={14} className="stx-indicador-icon" />Funcionários ativos</span>
                <span className="v">{funcionariosAtivos.length}</span>
              </div>
              <div className="stx-rateio-line">
                <span className="l"><DollarSign size={14} className="stx-indicador-icon" />Custo total funcionários</span>
                <span className="v">{formatBRL(totalCustoFuncionariosAtivos)}</span>
              </div>
              <div className="stx-rateio-line">
                <span className="l"><Clock size={14} className="stx-indicador-icon" />Custo/hora empresa</span>
                <span className="v">{formatBRL(custoHoraEmpresa)}</span>
              </div>
              <div className="stx-rateio-line">
                <span className="l"><Package size={14} className="stx-indicador-icon" />Produtos cadastrados</span>
                <span className="v">{produtosHook.produtos.filter((p) => p.ativo).length}</span>
              </div>
              <div className="stx-rateio-line">
                <span className="l"><Layers size={14} className="stx-indicador-icon" />Custos fixos ativos</span>
                <span className="v">{formatBRL(totalFixo)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {abaAtiva === "custos" && (
        <div className="stx-grid">
          <div>
            <div className="stx-panel">
              <div className="stx-panel-title-row">
                <p className="stx-panel-title">Custos fixos</p>
              </div>
              <p className="stx-panel-sub">Repetem automaticamente todo mês, até você pausar ou excluir.</p>

              {!showFixedForm && (
                <button className="stx-add-btn blueprint" onClick={() => setShowFixedForm(true)}>+ Novo custo fixo</button>
              )}

              {showFixedForm && (
                <div className="stx-form">
                  <div className="stx-form-full">
                    <label className="stx-label">Descrição</label>
                    <input
                      className="stx-input"
                      value={fixedForm.descricao}
                      onChange={(e) => setFixedForm({ ...fixedForm, descricao: e.target.value })}
                      placeholder="Ex: Aluguel do galpão"
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="stx-label">Categoria</label>
                    <select
                      className="stx-select"
                      value={fixedForm.categoria}
                      onChange={(e) => {
                        if (e.target.value === "__nova__") setNovaCategoriaFixed(true);
                        else setFixedForm({ ...fixedForm, categoria: e.target.value });
                      }}
                    >
                      {cadastrosBase.categorias.map((c) => <option key={c} value={c}>{c}</option>)}
                      <option value="__nova__">+ Criar nova categoria…</option>
                    </select>
                    {novaCategoriaFixed && (
                      <div className="stx-nova-cat-row">
                        <input
                          className="stx-input"
                          value={textoNovaCategoriaFixed}
                          onChange={(e) => setTextoNovaCategoriaFixed(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && confirmNovaCategoriaFixed()}
                          placeholder="Nome da categoria"
                          autoFocus
                        />
                        <button type="button" className="stx-icon-btn on" title="Adicionar categoria" onClick={confirmNovaCategoriaFixed}>✓</button>
                        <button type="button" className="stx-icon-btn" title="Cancelar" onClick={() => { setNovaCategoriaFixed(false); setTextoNovaCategoriaFixed(""); }}>✕</button>
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="stx-label">Valor (R$)</label>
                    <input
                      className="stx-input"
                      value={fixedForm.valor}
                      onChange={(e) => setFixedForm({ ...fixedForm, valor: e.target.value })}
                      onKeyDown={(e) => e.key === "Enter" && submitFixed()}
                      placeholder="0,00"
                      inputMode="decimal"
                    />
                  </div>
                  <div className="stx-form-actions">
                    <button type="button" className="stx-btn-primary" onClick={submitFixed}>
                      {editingFixedId ? "Salvar alterações" : "Adicionar fixo"}
                    </button>
                    <button type="button" className="stx-btn-secondary" onClick={resetFixedForm}>Cancelar</button>
                  </div>
                </div>
              )}

              {custosHook.loading ? (
                <div className="stx-empty">Carregando…</div>
              ) : custosHook.fixedCosts.length === 0 ? (
                <div className="stx-empty">Nenhum custo fixo cadastrado ainda.</div>
              ) : (
                custosHook.fixedCosts.map((f) => (
                  <div className={`stx-entry ${!f.ativo ? "paused" : ""}`} key={f.id}>
                    <div>
                      <p className="stx-entry-desc">
                        {f.descricao}
                        {!f.ativo && <span className="stx-badge">pausado</span>}
                      </p>
                      <p className="stx-entry-meta">{f.categoria}</p>
                    </div>
                    <div className="stx-entry-right">
                      <span className="stx-entry-value">{formatBRL(f.valor)}</span>
                      <button
                        className={`stx-icon-btn ${f.ativo ? "on" : ""}`}
                        title={f.ativo ? "Pausar (não conta mais nos totais)" : "Retomar"}
                        onClick={() => toggleFixedAtivo(f.id)}
                      >
                        {f.ativo ? "⏸" : "▶"}
                      </button>
                      <button className="stx-icon-btn" title="Editar" onClick={() => editFixed(f)}>✎</button>
                      <button className="stx-icon-btn danger" title="Excluir" onClick={() => deleteFixed(f.id)}>✕</button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="stx-panel">
              <div className="stx-panel-title-row">
                <p className="stx-panel-title">Custos pontuais de {monthLabel(currentMonth)}</p>
              </div>
              <p className="stx-panel-sub">Valem só para o mês selecionado.</p>

              {!showVarForm && (
                <button className="stx-add-btn" onClick={() => setShowVarForm(true)}>+ Novo custo pontual</button>
              )}

              {showVarForm && (
                <div className="stx-form">
                  <div className="stx-form-full">
                    <label className="stx-label">Descrição</label>
                    <input
                      className="stx-input"
                      value={varForm.descricao}
                      onChange={(e) => setVarForm({ ...varForm, descricao: e.target.value })}
                      onKeyDown={(e) => e.key === "Enter" && submitVar()}
                      placeholder="Ex: Conserto da fresadora"
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="stx-label">Categoria</label>
                    <select
                      className="stx-select"
                      value={varForm.categoria}
                      onChange={(e) => {
                        if (e.target.value === "__nova__") setNovaCategoriaVar(true);
                        else setVarForm({ ...varForm, categoria: e.target.value });
                      }}
                    >
                      {cadastrosBase.categorias.map((c) => <option key={c} value={c}>{c}</option>)}
                      <option value="__nova__">+ Criar nova categoria…</option>
                    </select>
                    {novaCategoriaVar && (
                      <div className="stx-nova-cat-row">
                        <input
                          className="stx-input"
                          value={textoNovaCategoriaVar}
                          onChange={(e) => setTextoNovaCategoriaVar(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && confirmNovaCategoriaVar()}
                          placeholder="Nome da categoria"
                          autoFocus
                        />
                        <button type="button" className="stx-icon-btn on" title="Adicionar categoria" onClick={confirmNovaCategoriaVar}>✓</button>
                        <button type="button" className="stx-icon-btn" title="Cancelar" onClick={() => { setNovaCategoriaVar(false); setTextoNovaCategoriaVar(""); }}>✕</button>
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="stx-label">Valor (R$)</label>
                    <input
                      className="stx-input"
                      value={varForm.valor}
                      onChange={(e) => setVarForm({ ...varForm, valor: e.target.value })}
                      onKeyDown={(e) => e.key === "Enter" && submitVar()}
                      placeholder="0,00"
                      inputMode="decimal"
                    />
                  </div>
                  <div className="stx-form-actions">
                    <button type="button" className="stx-btn-primary" onClick={submitVar}>
                      {editingVarId ? "Salvar alterações" : "Adicionar"}
                    </button>
                    <button type="button" className="stx-btn-secondary" onClick={resetVarForm}>Cancelar</button>
                  </div>
                </div>
              )}

              {custosHook.loading ? (
                <div className="stx-empty">Carregando…</div>
              ) : filteredVariable.length === 0 ? (
                <div className="stx-empty">Nenhum custo pontual em {monthLabel(currentMonth)}.</div>
              ) : (
                filteredVariable.map((entry) => (
                  <div className="stx-entry" key={entry.id}>
                    <div>
                      <p className="stx-entry-desc">{entry.descricao}</p>
                      <p className="stx-entry-meta">{entry.categoria}</p>
                    </div>
                    <div className="stx-entry-right">
                      <span className="stx-entry-value">{formatBRL(entry.valor)}</span>
                      <button className="stx-icon-btn" title="Editar" onClick={() => editVar(entry)}>✎</button>
                      <button className="stx-icon-btn danger" title="Excluir" onClick={() => deleteVar(entry.id)}>✕</button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="stx-panel">
            <p className="stx-panel-title" style={{ marginBottom: 14 }}>Por categoria</p>
            {porCategoria.length === 0 ? (
              <div className="stx-empty">Sem dados neste mês.</div>
            ) : (
              porCategoria.map(([cat, val]) => (
                <div className="stx-cat-row" key={cat}>
                  <div className="stx-cat-top">
                    <span className="stx-cat-name">{cat}</span>
                    <span className="stx-cat-value">{formatBRL(val)}</span>
                  </div>
                  <div className="stx-cat-bar-bg">
                    <div className="stx-cat-bar-fill" style={{ width: `${(val / maxCategoria) * 100}%` }} />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {abaAtiva === "funcionarios" && (
        <div className="stx-grid" style={{ gridTemplateColumns: "1fr" }}>
          <div className="stx-panel">
            <div className="stx-panel-title-row">
              <p className="stx-panel-title">Funcionários</p>
            </div>
            <p className="stx-panel-sub">Cadastre o salário base e todos os custos extras do funcionário. O custo por hora é calculado na aba "Custo por hora".</p>

            {!showFuncForm && (
              <button className="stx-add-btn blueprint" onClick={() => setShowFuncForm(true)}>+ Novo funcionário</button>
            )}

            {showFuncForm && (
              <div className="stx-form">
                <div>
                  <label className="stx-label">Nome</label>
                  <input
                    className="stx-input"
                    value={funcForm.nome}
                    onChange={(e) => setFuncForm({ ...funcForm, nome: e.target.value })}
                    placeholder="Ex: João"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="stx-label">Salário base (R$)</label>
                  <input
                    className="stx-input"
                    value={funcForm.salarioBase}
                    onChange={(e) => setFuncForm({ ...funcForm, salarioBase: e.target.value })}
                    placeholder="0,00"
                    inputMode="decimal"
                  />
                </div>
                <div className="stx-form-full">
                  <label className="stx-label">Operação</label>
                  <select
                    className="stx-select"
                    value={funcForm.operacao}
                    onChange={(e) => {
                      if (e.target.value === "__nova__") setNovaOperacao(true);
                      else setFuncForm({ ...funcForm, operacao: e.target.value });
                    }}
                  >
                    {cadastrosBase.operacoes.map((o) => <option key={o} value={o}>{o}</option>)}
                    <option value="__nova__">+ Criar nova operação…</option>
                  </select>
                  {novaOperacao && (
                    <div className="stx-nova-cat-row">
                      <input
                        className="stx-input"
                        value={textoNovaOperacao}
                        onChange={(e) => setTextoNovaOperacao(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && confirmNovaOperacao()}
                        placeholder="Nome da operação"
                        autoFocus
                      />
                      <button type="button" className="stx-icon-btn on" title="Adicionar operação" onClick={confirmNovaOperacao}>✓</button>
                      <button type="button" className="stx-icon-btn" title="Cancelar" onClick={() => { setNovaOperacao(false); setTextoNovaOperacao(""); }}>✕</button>
                    </div>
                  )}
                </div>

                <div className="stx-custos-builder">
                  <p className="stx-custos-builder-title">Custos extras (Prêmio, INSS, VT, VR, FGTS, 13º, férias...)</p>
                  {funcCustos.map((c) => (
                    <div className="stx-custo-item-row" key={c.id}>
                      <input
                        className="stx-input"
                        value={c.descricao}
                        onChange={(e) => updateFuncCustoItem(c.id, "descricao", e.target.value)}
                        placeholder="Ex: INSS, VT, 13º..."
                      />
                      <input
                        className="stx-input"
                        value={c.valor}
                        onChange={(e) => updateFuncCustoItem(c.id, "valor", e.target.value)}
                        placeholder="0,00"
                        inputMode="decimal"
                      />
                      <button type="button" className="stx-icon-btn danger" title="Remover" onClick={() => removeFuncCustoItem(c.id)}>✕</button>
                    </div>
                  ))}
                  <button type="button" className="stx-add-btn" style={{ marginTop: 4, marginBottom: 0 }} onClick={addFuncCustoItem}>+ Adicionar item de custo</button>
                  <p className="stx-custos-total">Total mensal (salário + extras): <b>{formatBRL(funcCustosTotalPreview)}</b></p>
                </div>

                <div className="stx-form-actions">
                  <button type="button" className="stx-btn-primary" onClick={submitFunc}>
                    {editingFuncId ? "Salvar alterações" : "Salvar funcionário"}
                  </button>
                  <button type="button" className="stx-btn-secondary" onClick={resetFuncForm}>Cancelar</button>
                </div>
              </div>
            )}

            {funcionariosHook.loading ? (
              <div className="stx-empty">Carregando…</div>
            ) : funcionariosHook.funcionarios.length === 0 ? (
              <div className="stx-empty">Nenhum funcionário cadastrado ainda.</div>
            ) : (
              funcionariosHook.funcionarios.map((f) => (
                <div className={`stx-func-card ${!f.ativo ? "paused" : ""}`} key={f.id}>
                  <div className="stx-func-top">
                    <div>
                      <p className="stx-func-nome">
                        {f.nome}
                        <span className="stx-badge blueprint">{f.operacao}</span>
                        {!f.ativo && <span className="stx-badge">pausado</span>}
                      </p>
                      <p className="stx-func-itens">
                        Salário base {formatBRL(f.salarioBase)}
                        {f.custos.length > 0 ? " · " + f.custos.map((c) => `${c.descricao} ${formatBRL(c.valor)}`).join(" · ") : ""}
                      </p>
                    </div>
                    <div className="stx-entry-right">
                      <button
                        className={`stx-icon-btn ${f.ativo ? "on" : ""}`}
                        title={f.ativo ? "Pausar" : "Retomar"}
                        onClick={() => toggleFuncAtivo(f.id)}
                      >
                        {f.ativo ? "⏸" : "▶"}
                      </button>
                      <button className="stx-icon-btn" title="Duplicar" onClick={() => duplicateFunc(f)}>⧉</button>
                      <button className="stx-icon-btn" title="Editar" onClick={() => editFunc(f)}>✎</button>
                      <button className="stx-icon-btn danger" title="Excluir" onClick={() => deleteFunc(f.id)}>✕</button>
                    </div>
                  </div>
                  <div className="stx-func-rates">
                    <div className="stx-func-rate">
                      <span className="stx-func-rate-label">Custo mensal total</span>
                      <span className="stx-func-rate-value">{formatBRL(custoMensalFunc(f))}</span>
                    </div>
                    <div className="stx-func-rate">
                      <span className="stx-func-rate-label">Custo/hora Sittech</span>
                      <span className="stx-func-rate-value highlight">{formatBRL(custoHoraSittech(f))}</span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}


      {abaAtiva === "faturamento" && (
        <div className="stx-grid">
          <div>
            <div className="stx-panel">
              <div className="stx-panel-title-row">
                <p className="stx-panel-title">Faturamento por data — {monthLabel(currentMonth)}</p>
              </div>
              <p className="stx-panel-sub">Lance cada recebimento/nota do mês; a soma vira o faturamento bruto.</p>

              {!showReceitaForm && (
                <button className="stx-add-btn" onClick={() => setShowReceitaForm(true)}>+ Novo lançamento</button>
              )}

              {showReceitaForm && (
                <div className="stx-form">
                  <div>
                    <label className="stx-label">Data</label>
                    <input
                      type="date"
                      className="stx-input"
                      value={receitaForm.data}
                      onChange={(e) => setReceitaForm({ ...receitaForm, data: e.target.value })}
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="stx-label">Valor (R$)</label>
                    <input
                      className="stx-input"
                      value={receitaForm.valor}
                      onChange={(e) => setReceitaForm({ ...receitaForm, valor: e.target.value })}
                      onKeyDown={(e) => e.key === "Enter" && submitReceita()}
                      placeholder="0,00"
                      inputMode="decimal"
                    />
                  </div>
                  <div className="stx-form-full">
                    <label className="stx-label">Descrição (opcional)</label>
                    <input
                      className="stx-input"
                      value={receitaForm.descricao}
                      onChange={(e) => setReceitaForm({ ...receitaForm, descricao: e.target.value })}
                      onKeyDown={(e) => e.key === "Enter" && submitReceita()}
                      placeholder="Ex: NF 1234 - Cliente X"
                    />
                  </div>
                  <div className="stx-form-actions">
                    <button type="button" className="stx-btn-primary" onClick={submitReceita}>
                      {editingReceitaId ? "Salvar alterações" : "Adicionar"}
                    </button>
                    <button type="button" className="stx-btn-secondary" onClick={resetReceitaForm}>Cancelar</button>
                  </div>
                </div>
              )}

              {faturamentosHook.loading ? (
                <div className="stx-empty">Carregando…</div>
              ) : receitasDoMes.length === 0 ? (
                <div className="stx-empty">Nenhum lançamento em {monthLabel(currentMonth)}.</div>
              ) : (
                receitasDoMes.map((r) => (
                  <div className="stx-entry" key={r.id}>
                    <div>
                      <p className="stx-entry-desc">{r.descricao || "Faturamento"}</p>
                      <p className="stx-entry-meta">{formatDataBR(r.data)}</p>
                    </div>
                    <div className="stx-entry-right">
                      <span className="stx-entry-value">{formatBRL(r.valor)}</span>
                      <button className="stx-icon-btn" title="Editar" onClick={() => editReceita(r)}>✎</button>
                      <button className="stx-icon-btn danger" title="Excluir" onClick={() => deleteReceita(r.id)}>✕</button>
                    </div>
                  </div>
                ))
              )}
              <p className="stx-custos-total" style={{ marginTop: 10 }}>Faturamento bruto do mês: <b>{formatBRL(faturamentoBruto)}</b></p>
            </div>

            <div className="stx-panel">
              <div className="stx-panel-title-row">
                <p className="stx-panel-title">Custos do mês</p>
              </div>
              <p className="stx-panel-sub">
                Meses antigos (antes do sistema): preencha na mão, já que os custos eram diferentes de hoje. Mês atual: pode puxar os dados já cadastrados no app.
              </p>
              <button type="button" className="stx-add-btn blueprint" onClick={preencherComDadosAtuais}>↺ Preencher com dados atuais do sistema</button>
              <div className="stx-form" style={{ gridTemplateColumns: "1fr" }}>
                <div>
                  <label className="stx-label">Número de funcionários</label>
                  <input
                    className="stx-input"
                    value={fatAtual.numFuncionarios}
                    onChange={(e) => updateFatCampos({ numFuncionarios: e.target.value })}
                    placeholder="Ex: 12"
                    inputMode="numeric"
                  />
                </div>
                <div>
                  <label className="stx-label">Custo funcionários total (R$)</label>
                  <input
                    className="stx-input"
                    value={fatAtual.custoFuncionariosTotal}
                    onChange={(e) => updateFatCampos({ custoFuncionariosTotal: e.target.value })}
                    placeholder="0,00"
                    inputMode="decimal"
                  />
                </div>
                <div>
                  <label className="stx-label">Custo fixo total (R$)</label>
                  <input
                    className="stx-input"
                    value={fatAtual.custoFixoTotal}
                    onChange={(e) => updateFatCampos({ custoFixoTotal: e.target.value })}
                    placeholder="0,00"
                    inputMode="decimal"
                  />
                </div>
              </div>
            </div>
          </div>

          <div>
            <div className="stx-panel">
              <p className="stx-panel-title" style={{ marginBottom: 14 }}>Resultado de {monthLabel(currentMonth)}</p>
              <div className="stx-rateio-line">
                <span className="l">Faturamento bruto</span>
                <span className="v">{formatBRL(faturamentoBruto)}</span>
              </div>
              <div className="stx-rateio-line">
                <span className="l">Imposto (9%)</span>
                <span className="v">− {formatBRL(impostoMes)}</span>
              </div>
              <div className="stx-rateio-line">
                <span className="l">Custo total (func. + fixo)</span>
                <span className="v">− {formatBRL(custoTotalMes)}</span>
              </div>
              <div className="stx-destaque-box" style={{ marginTop: 12 }}>
                <p className="stx-destaque-label">Lucro líquido</p>
                <p className="stx-destaque-value" style={{ color: corPorMargemPct(lucroLiquidoPctMes) }}>{formatBRL(lucroLiquidoMes)}</p>
                <p className="stx-destaque-sub" style={{ color: corPorMargemPct(lucroLiquidoPctMes) }}>{lucroLiquidoPctMes.toFixed(1)}% do faturamento bruto</p>
              </div>
            </div>

            <div className="stx-panel">
              <p className="stx-panel-title" style={{ marginBottom: 14 }}>Histórico mensal</p>
              {historicoFaturamento.length === 0 ? (
                <div className="stx-empty">Nenhum mês lançado ainda.</div>
              ) : (
                <div className="stx-hist-table">
                  <div className="stx-hist-row stx-hist-head">
                    <span>Mês</span><span>Bruto</span><span>Custo total</span><span>Lucro</span><span>%</span>
                  </div>
                  {historicoFaturamento.map((h) => (
                    <div className="stx-hist-row" key={h.mes} onClick={() => setCurrentMonth(h.mes)}>
                      <span>{monthLabel(h.mes)}</span>
                      <span>{formatBRL(h.bruto)}</span>
                      <span>{formatBRL(h.custoTotal)}</span>
                      <span style={{ color: corPorMargemPct(h.pct) }}>{formatBRL(h.lucro)}</span>
                      <span style={{ color: corPorMargemPct(h.pct) }}>{h.pct.toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {abaAtiva === "bi" && (
        <div>
          <div className="stx-panel stx-bi-filtro">
            <div className="stx-bi-filtro-modos">
              <button className={`stx-tab ${biFiltroModo === "todos" ? "active" : ""}`} onClick={() => setBiFiltroModo("todos")}>Todo o período</button>
              <button className={`stx-tab ${biFiltroModo === "mes" ? "active" : ""}`} onClick={() => setBiFiltroModo("mes")}>Um mês específico</button>
              <button className={`stx-tab ${biFiltroModo === "intervalo" ? "active" : ""}`} onClick={() => setBiFiltroModo("intervalo")}>Intervalo de meses</button>
            </div>
            {biFiltroModo === "mes" && (
              <div className="stx-bi-filtro-campos">
                <div>
                  <label className="stx-label">Mês</label>
                  <input type="month" className="stx-input" value={biMes} onChange={(e) => setBiMes(e.target.value)} />
                </div>
              </div>
            )}
            {biFiltroModo === "intervalo" && (
              <div className="stx-bi-filtro-campos">
                <div>
                  <label className="stx-label">De</label>
                  <input type="month" className="stx-input" value={biMesInicio} onChange={(e) => setBiMesInicio(e.target.value)} />
                </div>
                <div>
                  <label className="stx-label">Até</label>
                  <input type="month" className="stx-input" value={biMesFim} onChange={(e) => setBiMesFim(e.target.value)} />
                </div>
              </div>
            )}
          </div>

          <div className="stx-bi-stats">
            <div className="stx-destaque-box">
              <p className="stx-destaque-label">Faturamento acumulado</p>
              <p className="stx-destaque-value">{formatBRL(totalBrutoAcumulado)}</p>
              <p className="stx-destaque-sub">{dadosBI.length} mês(es) lançado(s)</p>
            </div>
            <div className="stx-destaque-box">
              <p className="stx-destaque-label">Lucro acumulado</p>
              <p className="stx-destaque-value" style={totalLucroAcumulado < 0 ? { color: "var(--danger)" } : undefined}>{formatBRL(totalLucroAcumulado)}</p>
              <p className="stx-destaque-sub">margem média {margemMediaBI.toFixed(1)}%</p>
            </div>
            <div className="stx-destaque-box">
              <p className="stx-destaque-label">Melhor mês</p>
              <p className="stx-destaque-value">{melhorMesBI ? formatBRL(melhorMesBI.lucro) : "—"}</p>
              <p className="stx-destaque-sub">{melhorMesBI ? melhorMesBI.mesLabel : "sem dados"}</p>
            </div>
            <div className="stx-destaque-box">
              <p className="stx-destaque-label">Pior mês</p>
              <p className="stx-destaque-value" style={piorMesBI && piorMesBI.lucro < 0 ? { color: "var(--danger)" } : undefined}>{piorMesBI ? formatBRL(piorMesBI.lucro) : "—"}</p>
              <p className="stx-destaque-sub">{piorMesBI ? piorMesBI.mesLabel : "sem dados"}</p>
            </div>
          </div>

          {dadosBI.length === 0 ? (
            <div className="stx-panel"><div className="stx-empty">{dadosBITodos.length === 0 ? 'Lance alguns meses na aba "Faturamento mensal" pra ver os gráficos aqui.' : "Nenhum mês lançado dentro do período selecionado."}</div></div>
          ) : (
            <>
              <div className="stx-panel">
                <div className="stx-chart-header">
                  <p className="stx-panel-title" style={{ marginBottom: 0 }}>Faturamento bruto x Custo total</p>
                  <ChartTypeToggle value={tipoGraficoBrutoCusto} onChange={setTipoGraficoBrutoCusto} />
                </div>
                <ResponsiveContainer width="100%" height={260}>
                  {renderTimeSeriesChart({
                    tipo: tipoGraficoBrutoCusto,
                    data: dadosBI,
                    series: [
                      { key: "bruto", name: "Faturamento bruto", color: cores.accent },
                      { key: "custoTotal", name: "Custo total", color: cores.blueprint },
                    ],
                    yTickFormatter: (v) => `${(v / 1000).toFixed(0)}k`,
                    unit: "currency",
                  })}
                </ResponsiveContainer>
              </div>

              <div className="stx-panel">
                <div className="stx-chart-header">
                  <p className="stx-panel-title" style={{ marginBottom: 0 }}>Lucro líquido por mês</p>
                  <ChartTypeToggle value={tipoGraficoLucro} onChange={setTipoGraficoLucro} />
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  {renderLucroChart(tipoGraficoLucro)}
                </ResponsiveContainer>
                <p className="stx-legenda-cores">
                  <span><i style={{ background: cores.danger }} />prejuízo</span>
                  <span><i style={{ background: cores.warning }} />abaixo de 20% de margem</span>
                  <span><i style={{ background: cores.accent }} />margem saudável (≥20%)</span>
                </p>
              </div>

              <div className="stx-panel">
                <div className="stx-chart-header">
                  <p className="stx-panel-title" style={{ marginBottom: 0 }}>Margem de lucro (%)</p>
                  <ChartTypeToggle value={tipoGraficoMargem} onChange={setTipoGraficoMargem} />
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  {renderMargemChart(tipoGraficoMargem)}
                </ResponsiveContainer>
                <p className="stx-legenda-cores">
                  <span><i style={{ background: cores.danger }} />prejuízo</span>
                  <span><i style={{ background: cores.warning }} />abaixo de 20%</span>
                  <span><i style={{ background: cores.accent }} />20% ou mais</span>
                </p>
              </div>

              <div className="stx-panel">
                <div className="stx-chart-header">
                  <p className="stx-panel-title" style={{ marginBottom: 0 }}>Composição do custo (funcionários x fixo)</p>
                  <ChartTypeToggle value={tipoGraficoComposicao} onChange={setTipoGraficoComposicao} />
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  {renderTimeSeriesChart({
                    tipo: tipoGraficoComposicao,
                    data: dadosBI,
                    series: [
                      { key: "custoFunc", name: "Custo funcionários", color: cores.blueprint },
                      { key: "custoFixo", name: "Custo fixo", color: tema === "dark" ? "#7C8B93" : "#5C6B73" },
                    ],
                    yTickFormatter: (v) => `${(v / 1000).toFixed(0)}k`,
                    unit: "currency",
                    stacked: true,
                  })}
                </ResponsiveContainer>
              </div>

              <div className="stx-grid">
                <div className="stx-panel">
                  <div className="stx-chart-header">
                    <p className="stx-panel-title" style={{ marginBottom: 0 }}>Número de funcionários</p>
                    <ChartTypeToggle value={tipoGraficoFuncionarios} onChange={setTipoGraficoFuncionarios} />
                  </div>
                  <ResponsiveContainer width="100%" height={220}>
                    {renderTimeSeriesChart({
                      tipo: tipoGraficoFuncionarios,
                      data: dadosBI,
                      series: [{ key: "numFunc", name: "Funcionários", color: cores.blueprint }],
                      yTickFormatter: undefined,
                      unit: "number",
                    })}
                  </ResponsiveContainer>
                </div>
                <div className="stx-panel">
                  <div className="stx-chart-header">
                    <p className="stx-panel-title" style={{ marginBottom: 0 }}>Custo médio por funcionário</p>
                    <ChartTypeToggle value={tipoGraficoCustoMedio} onChange={setTipoGraficoCustoMedio} />
                  </div>
                  <ResponsiveContainer width="100%" height={220}>
                    {renderTimeSeriesChart({
                      tipo: tipoGraficoCustoMedio,
                      data: dadosBI,
                      series: [{ key: "custoMedioFunc", name: "Custo médio/func.", color: cores.accent }],
                      yTickFormatter: (v) => `${(v / 1000).toFixed(1)}k`,
                      unit: "currency",
                    })}
                  </ResponsiveContainer>
                </div>
              </div>

              {pieCategoriasBI.length > 0 && (
                <div className="stx-panel">
                  <p className="stx-panel-title" style={{ marginBottom: 4 }}>Custos do mês atual por categoria</p>
                  <p className="stx-panel-sub">Referente a {monthLabel(currentMonth)} (fixos ativos + pontuais).</p>
                  <ResponsiveContainer width="100%" height={280}>
                    <PieChart>
                      <Pie data={pieCategoriasBI} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={95} label={(entry) => entry.name}>
                        {pieCategoriasBI.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                      </Pie>
                      <Tooltip content={<BITooltip unit="currency" />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {abaAtiva === "importar" && (
        <div className="stx-grid" style={{ gridTemplateColumns: "1fr" }}>
          <div className="stx-panel stx-resumo-panel">
            <p className="stx-panel-title" style={{ marginBottom: 4 }}>Backup completo (somente leitura)</p>
            <p className="stx-panel-sub">
              Gera um retrato dos dados atuais (custos, funcionários, produtos, máquinas, previsões e faturamento),
              lido direto do banco. Serve só como registro/consulta — restaurar um backup antigo por aqui não está
              disponível (ver explicação ao lado).
            </p>
            <div className="stx-form-actions" style={{ marginBottom: 10 }}>
              <button type="button" className="stx-btn-primary" onClick={handleGerarBackup}>Gerar backup</button>
              {backupTexto && <button type="button" className="stx-btn-secondary" onClick={handleCopiarBackup}>Copiar</button>}
              {backupTexto && <button type="button" className="stx-btn-secondary" onClick={handleBaixarBackup}>Baixar arquivo</button>}
            </div>
            {backupTexto && (
              <textarea
                className="stx-textarea"
                readOnly
                value={backupTexto}
                onClick={(e) => e.target.select()}
                style={{ minHeight: 100 }}
              />
            )}
          </div>

          <div className="stx-panel">
            <p className="stx-panel-title" style={{ marginBottom: 4 }}>Restaurar backup</p>
            <p className="stx-panel-sub">
              A restauração de backup não está disponível nesta versão. Os dados do sistema agora vivem no Supabase
              (banco compartilhado, não mais no navegador) — restaurar um backup antigo com segurança exige
              substituir dados reais em várias tabelas relacionadas, o que essa tela ainda não faz. Se precisar
              restaurar dados de um backup antigo, fale com quem administra o banco (Supabase) diretamente.
            </p>
          </div>

          <div className="stx-panel">
            <p className="stx-panel-title" style={{ marginBottom: 4 }}>Importar funcionários em massa</p>
            <p className="stx-panel-sub">Uma linha por funcionário. Cola várias linhas de uma vez.</p>
            <p className="stx-import-formato">
              Nome;Operação;SalárioBase;Item1:Valor1;Item2:Valor2;...{"\n"}
              {"\n"}
              Exemplo:{"\n"}
              Clarice Marques;Produção;2536,77;Premio:250;INSS:226,49;Refeição:123;Vale combustível:130;FGTS:222,94;13º:211,40;Férias:211,40;1/3 das férias:70,50;Multa FGTS 40%:98,20;Desconto Sindicato:16,91;FGTS Ferias 1/3:5,64
            </p>
            <textarea
              className="stx-textarea"
              value={textoImportFunc}
              onChange={(e) => setTextoImportFunc(e.target.value)}
              placeholder="Cole aqui, uma linha por funcionário..."
            />
            <div className="stx-form-actions" style={{ marginTop: 10 }}>
              <button type="button" className="stx-btn-primary" onClick={importarFuncionarios}>Importar funcionários</button>
            </div>
            {resultadoImportFunc && <p className="stx-import-resultado">{resultadoImportFunc}</p>}
          </div>

          <div className="stx-panel">
            <p className="stx-panel-title" style={{ marginBottom: 4 }}>Importar dados mensais (Faturamento → Custos do mês)</p>
            <p className="stx-panel-sub">Uma linha por mês. Preenche número de funcionários, custo funcionários e custo fixo daquele mês.</p>
            <p className="stx-import-formato">
              AAAA-MM;NúmeroFuncionários;CustoFuncionariosTotal;CustoFixoTotal{"\n"}
              {"\n"}
              Exemplo:{"\n"}
              2025-07;10;38000;15000{"\n"}
              2025-08;10;38500;15200
            </p>
            <textarea
              className="stx-textarea"
              value={textoImportFatMeses}
              onChange={(e) => setTextoImportFatMeses(e.target.value)}
              placeholder="Cole aqui, uma linha por mês..."
            />
            <div className="stx-form-actions" style={{ marginTop: 10 }}>
              <button type="button" className="stx-btn-primary" onClick={importarFatMeses}>Importar meses</button>
            </div>
            {resultadoImportFatMeses && <p className="stx-import-resultado">{resultadoImportFatMeses}</p>}
          </div>

          <div className="stx-panel">
            <p className="stx-panel-title" style={{ marginBottom: 4 }}>Importar faturamento por data</p>
            <p className="stx-panel-sub">Uma linha por lançamento/nota. O mês é identificado automaticamente pela data.</p>
            <p className="stx-import-formato">
              AAAA-MM-DD;Valor;Descrição (opcional){"\n"}
              {"\n"}
              Exemplo:{"\n"}
              2025-07-05;12500;NF 1001 - Cliente A{"\n"}
              2025-07-18;8300;NF 1002 - Cliente B
            </p>
            <textarea
              className="stx-textarea"
              value={textoImportReceitas}
              onChange={(e) => setTextoImportReceitas(e.target.value)}
              placeholder="Cole aqui, uma linha por lançamento..."
            />
            <div className="stx-form-actions" style={{ marginTop: 10 }}>
              <button type="button" className="stx-btn-primary" onClick={importarReceitas}>Importar lançamentos</button>
            </div>
            {resultadoImportReceitas && <p className="stx-import-resultado">{resultadoImportReceitas}</p>}
          </div>
        </div>
      )}

      {abaAtiva === "prVisaoGeral" && (
        <div>
          <PainelAguardandoIntegracao
            icone={Factory}
            titulo="Visão Geral da Produção Real"
            pergunta="Estamos atingindo a meta? Estamos eficientes? Onde estamos perdendo produção?"
            descricao="Vai mostrar meta x produzido, disponibilidade/performance/qualidade, decomposição de onde a produção está sendo perdida (paradas, baixa performance, qualidade, não explicado), e as maiores oportunidades ordenadas por impacto financeiro."
          />
        </div>
      )}

      {abaAtiva === "prProdutividade" && (
        <div>
          <PainelAguardandoIntegracao
            icone={Activity}
            titulo="Produtividade real"
            pergunta="Quanto cada produto realmente produz, em cada máquina?"
            descricao="Produtividade sempre pela combinação Produto + Operação + Máquina (nunca só pela máquina, já que produtos diferentes rendem diferente). Mostra média, mediana, nº de amostras e comparação com a meta teórica cadastrada."
          />
        </div>
      )}

      {abaAtiva === "prFuncionarios" && (
        <div>
          <PainelAguardandoIntegracao
            icone={Users}
            titulo="Funcionários — Produção Real"
            pergunta="Como cada funcionário performa, e quanto resultado ele gera?"
            descricao="Performance sempre contextualizada por produto/operação/máquina (não é ranking bruto de quantidade). Mostra resultado financeiro estimado e resultado por hora de cada funcionário, com a fórmula sempre documentada."
          />
        </div>
      )}

      {abaAtiva === "prDesvios" && (
        <div>
          <PainelAguardandoIntegracao
            icone={AlertTriangle}
            titulo="Análise de desvios"
            pergunta="Por que não atingimos a meta?"
            descricao="Decompõe o déficit entre meta e produção real em disponibilidade, performance, qualidade e não-explicado — nunca forçando 100% da diferença numa categoria só. Permite abrir o detalhe até chegar no apontamento específico."
          />
        </div>
      )}

      {abaAtiva === "prParadas" && (
        <div>
          <PainelAguardandoIntegracao
            icone={PauseCircle}
            titulo="Paradas de máquinas"
            pergunta="Quanto as paradas estão nos custando?"
            descricao="Consolida paradas por máquina, motivo, produto afetado e período, convertendo em produção potencial perdida e impacto financeiro estimado — pra saber qual problema de manutenção mais custa dinheiro."
          />
        </div>
      )}

      {abaAtiva === "prValidacao" && (
        <div>
          <PainelAguardandoIntegracao
            icone={ClipboardCheck}
            titulo="Validação da Previsão"
            pergunta="O que programei na Previsão Semanal é realmente possível, dado o histórico real?"
            descricao="Pega a mesma programação já lançada na Previsão Semanal e faz uma segunda análise, baseada em capacidade histórica real (não só cadastro teórico). Mostra três cenários (conservador, realista, potencial) e status por máquina — sem nunca alterar a Previsão Semanal original."
          />
        </div>
      )}

      {abaAtiva === "prDadosImportados" && (
        <div>
          <PainelAguardandoIntegracao
            icone={Database}
            titulo="Dados importados"
            pergunta="De onde vieram os dados, e estão íntegros?"
            descricao="Área administrativa mostrando origem dos dados de produção, última sincronização, quantidade de registros, período coberto, erros e registros sem mapeamento — quando a integração com a Plataforma Ninja estiver ativa."
          />
        </div>
      )}

      {abaAtiva === "usuarios" && usuarioLogado?.papel !== "admin" && (
        <div className="stx-panel">
          <p className="stx-panel-title">Acesso restrito</p>
          <p className="stx-panel-sub">Essa área é só para administradores.</p>
        </div>
      )}
      {abaAtiva === "usuarios" && usuarioLogado?.papel === "admin" && (
        <div>
          <div className="stx-panel">
            <div className="stx-panel-title-row">
              <p className="stx-panel-title">Usuários com acesso ao sistema</p>
              {!showUsuarioForm && (
                <button className="stx-add-btn" onClick={() => { setShowUsuarioForm(true); setUsuarioFormErro(""); }}>+ Novo usuário</button>
              )}
            </div>
            <p className="stx-panel-sub">
              Administrador tem acesso completo, incluindo essa tela. Usuário acessa o resto do sistema normalmente.
              Nunca é possível ficar sem nenhum administrador ativo.
            </p>

            {showUsuarioForm && (
              <div className="stx-form-grid" style={{ marginTop: 14 }}>
                <div>
                  <label className="stx-label">Nome</label>
                  <input className="stx-input" value={usuarioForm.nome} onChange={(e) => setUsuarioForm({ ...usuarioForm, nome: e.target.value })} placeholder="Nome completo" />
                </div>
                <div>
                  <label className="stx-label">E-mail</label>
                  <input className="stx-input" value={usuarioForm.email} onChange={(e) => setUsuarioForm({ ...usuarioForm, email: e.target.value })} placeholder="usuario@empresa.com" disabled={!!editingUsuarioId} />
                </div>
                <div>
                  <label className="stx-label">Papel</label>
                  <select className="stx-select" value={usuarioForm.papel} onChange={(e) => setUsuarioForm({ ...usuarioForm, papel: e.target.value })}>
                    <option value="usuario">Usuário</option>
                    <option value="admin">Administrador</option>
                  </select>
                </div>
                {!editingUsuarioId && (
                  <div>
                    <label className="stx-label">Senha inicial</label>
                    <input type="password" className="stx-input" value={novaSenhaForm} onChange={(e) => setNovaSenhaForm(e.target.value)} placeholder="mínimo 6 caracteres" />
                  </div>
                )}

                {usuarioForm.papel === "admin" ? (
                  <p className="stx-form-full stx-panel-sub" style={{ marginTop: 4 }}>
                    Administrador tem acesso completo a todas as áreas automaticamente — não precisa marcar permissão nenhuma.
                  </p>
                ) : (
                  <div className="stx-form-full">
                    <div className="stx-panel-title-row">
                      <label className="stx-label" style={{ marginBottom: 0 }}>Permissões de acesso</label>
                      <button type="button" className="stx-btn-secondary" onClick={aplicarPresetSupervisaoProducao} style={{ padding: "4px 10px", fontSize: 12 }}>
                        Supervisão de Produção
                      </button>
                    </div>
                    <p className="stx-panel-sub" style={{ marginTop: -4, marginBottom: 8 }}>
                      O atalho acima só marca um conjunto inicial — pode marcar/desmarcar qualquer item individualmente depois.
                    </p>
                    <div className="stx-permissoes-grupos">
                      {GRUPOS_PERMISSOES.map((grupo) => (
                        <div key={grupo.titulo}>
                          <p className="stx-permissoes-grupo-titulo">{grupo.titulo}</p>
                          {grupo.itens.map((item) => (
                            <label key={item.chave} className="stx-permissoes-item">
                              <input
                                type="checkbox"
                                checked={permissoesForm.includes(item.chave)}
                                onChange={() => togglePermissaoForm(item.chave)}
                              />
                              {item.label}
                            </label>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {usuarioFormErro && <p className="stx-form-full" style={{ color: "var(--danger)", fontSize: 12.5 }}>{usuarioFormErro}</p>}
                <div className="stx-form-actions stx-form-full">
                  <button type="button" className="stx-btn-primary" onClick={submitUsuario}>{editingUsuarioId ? "Salvar alterações" : "Criar usuário"}</button>
                  <button type="button" className="stx-btn-secondary" onClick={resetUsuarioForm}>Cancelar</button>
                </div>
              </div>
            )}

            {usuariosHook.usuarios.length === 0 ? (
              <div className="stx-empty">Nenhum usuário cadastrado ainda.</div>
            ) : (
              usuariosHook.usuarios.map((u) => (
                <div key={u.id}>
                  <div className={`stx-entry ${!u.ativo ? "paused" : ""}`}>
                    <div>
                      <p className="stx-entry-desc">
                        {u.nome}
                        <span className={`stx-badge ${u.papel === "admin" ? "blueprint" : ""}`}>{u.papel === "admin" ? "Administrador" : "Usuário"}</span>
                        {!u.ativo && <span className="stx-badge" style={{ background: "rgba(217,83,79,0.15)", color: "var(--danger)" }}>inativo</span>}
                      </p>
                      <p className="stx-entry-meta">
                        {u.email} · criado em {new Date(u.criadoEm).toLocaleDateString("pt-BR")}
                        {u.ultimoAcesso && ` · último acesso ${new Date(u.ultimoAcesso).toLocaleDateString("pt-BR")}`}
                      </p>
                    </div>
                    <div className="stx-entry-right">
                      <button className="stx-icon-btn" title="Redefinir senha" onClick={() => { setResetandoSenhaId(resetandoSenhaId === u.id ? null : u.id); setSenhaResetForm(""); setUsuarioFormErro(""); }}>🔑</button>
                      <button className={`stx-icon-btn ${u.ativo ? "on" : ""}`} title={u.ativo ? "Desativar" : "Ativar"} onClick={() => toggleAtivoUsuario(u)}>{u.ativo ? "⏸" : "▶"}</button>
                      <button className="stx-icon-btn" title="Editar" onClick={() => editUsuario(u)}>✎</button>
                    </div>
                  </div>
                  {resetandoSenhaId === u.id && (
                    <div className="stx-reset-senha-box">
                      <input type="password" className="stx-input" value={senhaResetForm} onChange={(e) => setSenhaResetForm(e.target.value)} placeholder="Nova senha (mínimo 6 caracteres)" />
                      <button className="stx-btn-primary" onClick={() => confirmarResetSenha(u)}>Confirmar</button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="stx-panel">
            <p className="stx-panel-title" style={{ marginBottom: 10 }}>Registro de atividade</p>
            {auditoriaHook.registros.length === 0 ? (
              <div className="stx-empty">Nenhuma ação administrativa registrada ainda.</div>
            ) : (
              auditoriaHook.registros.map((a) => (
                <div className="stx-op-func-line" key={a.id}>
                  <span className="n">{a.quem} — {a.acao}{a.usuarioAfetado ? ` (${a.usuarioAfetado})` : ""}</span>
                  <span className="v" style={{ fontSize: 11 }}>{new Date(a.quando).toLocaleString("pt-BR")}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

        </div>
        </div>
      </div>

      <AccountModal
        usuarioLogado={usuarioLogado}
        aberta={minhaContaAberta}
        onFechar={() => setMinhaContaAberta(false)}
        minhaSenhaAtual={minhaSenhaAtual}
        setMinhaSenhaAtual={setMinhaSenhaAtual}
        minhaSenhaNova={minhaSenhaNova}
        setMinhaSenhaNova={setMinhaSenhaNova}
        minhaSenhaConfirma={minhaSenhaConfirma}
        setMinhaSenhaConfirma={setMinhaSenhaConfirma}
        minhaContaMsg={minhaContaMsg}
        onSalvar={alterarMinhaSenha}
      />
      </>
      )}
    </div>
  );
}
