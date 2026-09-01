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

import { useState, useEffect, useMemo } from "react";
import {
  Package, Clock, Users, Percent,
  DollarSign, TrendingUp, TrendingDown, Scale, Target, Sparkles, ClipboardList, Layers,
  AlertTriangle, Factory, Activity, PauseCircle, ClipboardCheck, Database,
} from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Cell, PieChart, Pie, ReferenceLine, ReferenceArea,
} from "recharts";

import type {
  FixedCost, VariableEntry, Funcionario, Periodo, Faturamento, Produto, Maquina, Previsao, Usuario, AuditoriaEntry,
} from "@/types/domain";
import {
  STORAGE_KEY, CATEGORIAS, OPERACOES, PERIODOS_PADRAO, PIE_COLORS, TITULOS_ABA, THEMES, USUARIOS_SEED,
} from "@/lib/constants";
import { duracaoPeriodoHorasCalc } from "@/lib/calculations/periodos";
import { monthKey, monthLabel, shiftMonth, toISODate, mondayOf } from "@/lib/date";
import { formatBRL, toNumber, monthLabelShort, setModoPrivadoAtivo } from "@/lib/format";
import { uid } from "@/lib/id";
import { gerarSalt, hashSenha } from "@/lib/auth";
import { storageService } from "@/services/storage-service";
import GlobalStyles from "@/components/shell/GlobalStyles";
import Sidebar from "@/components/shell/Sidebar";
import LoginScreen from "@/components/shell/LoginScreen";
import TopBarActions from "@/components/shell/TopBarActions";
import AccountModal from "@/components/shell/AccountModal";
import {
  calcularPeriodosComDuracao, filtrarPeriodosValidos, calcularHorasPorDia, calcularDuracaoMediaPeriodo,
} from "@/lib/calculations/periodos";
import {
  calcularTotalFixoAtivo, calcularCustoMensalFuncionario, calcularTotalCustoFuncionariosAtivos,
  calcularCustoHoraPorOperacao, calcularMargemProduto,
} from "@/lib/calculations/custoHora";
import { calcularMetaFaturamento } from "@/lib/calculations/metaFaturamento";

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
  const [abaAtiva, setAbaAtiva] = useState("inicio"); // 'inicio' | 'custos' | 'funcionarios' | 'produtos' | 'previsao' | 'horaEmpresa' | 'faturamento' | 'bi' | 'importar'
  const [tema, setTema] = useState("dark"); // 'dark' | 'light'
  const cores = THEMES[tema];
  const [modoPrivado, setModoPrivado] = useState(false);
  function toggleModoPrivado() {
    const next = !modoPrivado;
    setModoPrivadoAtivo(next);
    setModoPrivado(next);
  }
  const [gruposAbertos, setGruposAbertos] = useState({ gestao: true, financeiro: true, planejamento: true, producaoReal: true, administracao: true });
  function toggleGrupo(grupo) {
    setGruposAbertos((prev) => ({ ...prev, [grupo]: !prev[grupo] }));
  }

  const [autenticado, setAutenticado] = useState(false);
  const [loginUsuario, setLoginUsuario] = useState("");
  const [loginSenha, setLoginSenha] = useState("");
  const [loginErro, setLoginErro] = useState("");
  const [loginCarregando, setLoginCarregando] = useState(false);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [auditoria, setAuditoria] = useState<AuditoriaEntry[]>([]);
  const usuarioLogado = usuarios.find((u) => u.login.toLowerCase() === loginUsuario.trim().toLowerCase()) || null;

  async function handleLogin() {
    setLoginCarregando(true);
    const candidato = usuarios.find((u) => u.login.toLowerCase() === loginUsuario.trim().toLowerCase() && u.ativo);
    if (!candidato) {
      setLoginErro("Usuário ou senha incorretos.");
      setLoginCarregando(false);
      return;
    }
    const hashDigitado = await hashSenha(loginSenha, candidato.senhaSalt);
    if (hashDigitado === candidato.senhaHash) {
      setAutenticado(true);
      setLoginErro("");
      setLoginSenha("");
      const usuariosAtualizados = usuarios.map((u) => (u.id === candidato.id ? { ...u, ultimoAcesso: new Date().toISOString() } : u));
      setUsuarios(usuariosAtualizados);
      try {
        await storageService.set(STORAGE_KEY, JSON.stringify({
          fixedCosts, variableEntries, categorias, operacoes, funcionarios, periodos, diasUteis, diasUteisSemana,
          faturamentos, produtos, maquinas, previsoes, usuarios: usuariosAtualizados, auditoria,
        }), true);
      } catch (e) { /* não bloqueia o login se isso falhar */ }
    } else {
      setLoginErro("Usuário ou senha incorretos.");
    }
    setLoginCarregando(false);
  }

  function registrarAuditoria(acao, usuarioAfetado) {
    const entrada = { id: uid(), quando: new Date().toISOString(), quem: usuarioLogado?.nome || loginUsuario, acao, usuarioAfetado: usuarioAfetado || null };
    const novaAuditoria = [entrada, ...auditoria].slice(0, 200);
    setAuditoria(novaAuditoria);
    persist({ auditoria: novaAuditoria });
  }

  const emptyUsuarioForm = { nome: "", login: "", papel: "usuario" };
  const [showUsuarioForm, setShowUsuarioForm] = useState(false);
  const [editingUsuarioId, setEditingUsuarioId] = useState(null);
  const [usuarioForm, setUsuarioForm] = useState(emptyUsuarioForm);
  const [novaSenhaForm, setNovaSenhaForm] = useState("");
  const [usuarioFormErro, setUsuarioFormErro] = useState("");
  const [resetandoSenhaId, setResetandoSenhaId] = useState(null);
  const [senhaResetForm, setSenhaResetForm] = useState("");
  const [minhaContaAberta, setMinhaContaAberta] = useState(false);
  const [minhaSenhaAtual, setMinhaSenhaAtual] = useState("");
  const [minhaSenhaNova, setMinhaSenhaNova] = useState("");
  const [minhaSenhaConfirma, setMinhaSenhaConfirma] = useState("");
  const [minhaContaMsg, setMinhaContaMsg] = useState("");

  function resetUsuarioForm() {
    setUsuarioForm(emptyUsuarioForm);
    setEditingUsuarioId(null);
    setShowUsuarioForm(false);
    setNovaSenhaForm("");
    setUsuarioFormErro("");
  }
  function editUsuario(u) {
    setUsuarioForm({ nome: u.nome, login: u.login, papel: u.papel });
    setEditingUsuarioId(u.id);
    setShowUsuarioForm(true);
    setUsuarioFormErro("");
  }
  async function submitUsuario() {
    if (!usuarioForm.nome.trim() || !usuarioForm.login.trim()) {
      setUsuarioFormErro("Preenche nome e login.");
      return;
    }
    const loginDuplicado = usuarios.some(
      (u) => u.login.toLowerCase() === usuarioForm.login.trim().toLowerCase() && u.id !== editingUsuarioId
    );
    if (loginDuplicado) {
      setUsuarioFormErro("Já existe um usuário com esse login.");
      return;
    }
    if (editingUsuarioId) {
      const usuarioAntigo = usuarios.find((u) => u.id === editingUsuarioId);
      if (usuarioAntigo && usuarioAntigo.papel === "admin" && usuarioForm.papel !== "admin") {
        const outrosAdmins = usuarios.filter((u) => u.papel === "admin" && u.ativo && u.id !== editingUsuarioId);
        if (outrosAdmins.length === 0) {
          setUsuarioFormErro("Não é possível rebaixar o último administrador ativo.");
          return;
        }
      }
      const atualizados = usuarios.map((u) =>
        u.id === editingUsuarioId ? { ...u, nome: usuarioForm.nome, login: usuarioForm.login, papel: usuarioForm.papel } : u
      );
      persist({ usuarios: atualizados });
      registrarAuditoria("Editou usuário", usuarioForm.nome);
    } else {
      if (!novaSenhaForm || novaSenhaForm.length < 4) {
        setUsuarioFormErro("Define uma senha com pelo menos 4 caracteres.");
        return;
      }
      const salt = gerarSalt();
      const hash = await hashSenha(novaSenhaForm, salt);
      const novo = {
        id: uid(), nome: usuarioForm.nome, login: usuarioForm.login, senhaHash: hash, senhaSalt: salt,
        papel: usuarioForm.papel, ativo: true, criadoEm: new Date().toISOString(), ultimoAcesso: null,
      };
      persist({ usuarios: [...usuarios, novo] });
      registrarAuditoria("Criou usuário", usuarioForm.nome);
    }
    resetUsuarioForm();
  }
  function toggleAtivoUsuario(u) {
    if (u.ativo && u.papel === "admin") {
      const outrosAdminsAtivos = usuarios.filter((x) => x.papel === "admin" && x.ativo && x.id !== u.id);
      if (outrosAdminsAtivos.length === 0) {
        setUsuarioFormErro("Não é possível desativar o último administrador ativo.");
        return;
      }
    }
    const atualizados = usuarios.map((x) => (x.id === u.id ? { ...x, ativo: !x.ativo } : x));
    persist({ usuarios: atualizados });
    registrarAuditoria(u.ativo ? "Desativou usuário" : "Ativou usuário", u.nome);
  }
  async function confirmarResetSenha(u) {
    if (!senhaResetForm || senhaResetForm.length < 4) {
      setUsuarioFormErro("Define uma senha com pelo menos 4 caracteres.");
      return;
    }
    const salt = gerarSalt();
    const hash = await hashSenha(senhaResetForm, salt);
    const atualizados = usuarios.map((x) => (x.id === u.id ? { ...x, senhaHash: hash, senhaSalt: salt } : x));
    persist({ usuarios: atualizados });
    registrarAuditoria("Redefiniu senha", u.nome);
    setResetandoSenhaId(null);
    setSenhaResetForm("");
    setUsuarioFormErro("");
  }
  async function alterarMinhaSenha() {
    if (!usuarioLogado) return;
    const hashAtual = await hashSenha(minhaSenhaAtual, usuarioLogado.senhaSalt);
    if (hashAtual !== usuarioLogado.senhaHash) {
      setMinhaContaMsg("Senha atual incorreta.");
      return;
    }
    if (!minhaSenhaNova || minhaSenhaNova.length < 4) {
      setMinhaContaMsg("A nova senha precisa ter pelo menos 4 caracteres.");
      return;
    }
    if (minhaSenhaNova !== minhaSenhaConfirma) {
      setMinhaContaMsg("As senhas novas não coincidem.");
      return;
    }
    const salt = gerarSalt();
    const hash = await hashSenha(minhaSenhaNova, salt);
    const atualizados = usuarios.map((u) => (u.id === usuarioLogado.id ? { ...u, senhaHash: hash, senhaSalt: salt } : u));
    persist({ usuarios: atualizados });
    registrarAuditoria("Alterou a própria senha", usuarioLogado.nome);
    setMinhaSenhaAtual("");
    setMinhaSenhaNova("");
    setMinhaSenhaConfirma("");
    setMinhaContaMsg("Senha alterada com sucesso.");
  }

  const [fixedCosts, setFixedCosts] = useState<FixedCost[]>([]);
  const [variableEntries, setVariableEntries] = useState<VariableEntry[]>([]);
  const [categorias, setCategorias] = useState(CATEGORIAS);
  const [operacoes, setOperacoes] = useState(OPERACOES);
  const [funcionarios, setFuncionarios] = useState<Funcionario[]>([]);
  const [periodos, setPeriodos] = useState<Periodo[]>(PERIODOS_PADRAO);
  const [diasUteis, setDiasUteis] = useState("22");
  const [diasUteisSemana, setDiasUteisSemana] = useState("5");
  const [faturamentos, setFaturamentos] = useState<Faturamento[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [maquinas, setMaquinas] = useState<Maquina[]>([]);
  const [previsoes, setPrevisoes] = useState<Previsao[]>([]);

  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState(false);
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

  const emptyProdutoForm = { nome: "", referencia: "", valorUnitario: "", prioridade: "media" };
  const [showProdutoForm, setShowProdutoForm] = useState(false);
  const [editingProdutoId, setEditingProdutoId] = useState(null);
  const [produtoForm, setProdutoForm] = useState(emptyProdutoForm);
  const [produtoRoteiro, setProdutoRoteiro] = useState([]);
  const [novaOperacaoEtapaId, setNovaOperacaoEtapaId] = useState(null);
  const [textoNovaOperacaoEtapa, setTextoNovaOperacaoEtapa] = useState("");

  const emptyMaquinaForm = { nome: "", operacao: OPERACOES[0] };
  const [showMaquinaForm, setShowMaquinaForm] = useState(false);
  const [editingMaquinaId, setEditingMaquinaId] = useState(null);
  const [maquinaForm, setMaquinaForm] = useState(emptyMaquinaForm);
  const [novaOperacaoMaquina, setNovaOperacaoMaquina] = useState(false);
  const [textoNovaOperacaoMaquina, setTextoNovaOperacaoMaquina] = useState("");

  // Previsão Semanal/Capacidade migraram para /previsao e /capacidade
  // (features/previsao, features/capacidade) — só a margem desejada
  // continua aqui, lida pelo card "Meta semanal" do menu lateral.
  const margemDesejada = "20";

  useEffect(() => {
    (async () => {
      try {
        const res = await storageService.get(STORAGE_KEY, true);
        if (res && res.value) {
          const parsed = JSON.parse(res.value);
          if (Array.isArray(parsed)) {
            setVariableEntries(
              parsed.map((e) => ({
                id: e.id, mes: e.mes, descricao: e.descricao, categoria: e.categoria, valor: e.valor,
              }))
            );
          } else {
            setFixedCosts(parsed.fixedCosts || []);
            setVariableEntries(parsed.variableEntries || []);
            if (parsed.categorias && parsed.categorias.length) setCategorias(parsed.categorias);
            if (parsed.operacoes && parsed.operacoes.length) setOperacoes(parsed.operacoes);
            setFuncionarios(
              (parsed.funcionarios || []).map((f) => ({
                ...f,
                salarioBase: f.salarioBase !== undefined ? f.salarioBase : 0,
              }))
            );
            if (parsed.periodos !== undefined) setPeriodos(parsed.periodos);
            if (parsed.diasUteis !== undefined) setDiasUteis(String(parsed.diasUteis));
            setFaturamentos(parsed.faturamentos || []);
            setProdutos(parsed.produtos || []);
            setMaquinas(parsed.maquinas || []);
            if (parsed.diasUteisSemana !== undefined) setDiasUteisSemana(String(parsed.diasUteisSemana));
            setPrevisoes(parsed.previsoes || []);
            setAuditoria(parsed.auditoria || []);

            if (parsed.usuarios && parsed.usuarios.length) {
              setUsuarios(parsed.usuarios);
            } else {
              // migração única: primeira vez que esse formato roda — converte a lista antiga
              // (senha em texto puro, fixa no código) pro formato novo, com senha em hash + salt.
              const migrados = await Promise.all(
                USUARIOS_SEED.map(async (u) => {
                  const salt = gerarSalt();
                  const hash = await hashSenha(u.senha, salt);
                  return {
                    id: uid(), nome: u.nome, login: u.usuario, senhaHash: hash, senhaSalt: salt,
                    papel: "admin", ativo: true, criadoEm: new Date().toISOString(), ultimoAcesso: null,
                  };
                })
              );
              setUsuarios(migrados);
              try {
                await storageService.set(STORAGE_KEY, JSON.stringify({ ...parsed, usuarios: migrados }), true);
              } catch (e) { /* segue mesmo se não conseguir salvar a migração agora */ }
            }
          }
        } else {
          // storage vazio de verdade — mesma migração, garantindo que sempre existam usuários pra logar
          const migrados = await Promise.all(
            USUARIOS_SEED.map(async (u) => {
              const salt = gerarSalt();
              const hash = await hashSenha(u.senha, salt);
              return {
                id: uid(), nome: u.nome, login: u.usuario, senhaHash: hash, senhaSalt: salt,
                papel: "admin", ativo: true, criadoEm: new Date().toISOString(), ultimoAcesso: null,
              };
            })
          );
          setUsuarios(migrados);
        }
      } catch (e) {
        // chave ainda não existe — começa vazio (use a aba "Importar dados" > Restaurar backup pra repor os dados)
        const migrados = await Promise.all(
          USUARIOS_SEED.map(async (u) => {
            const salt = gerarSalt();
            const hash = await hashSenha(u.senha, salt);
            return {
              id: uid(), nome: u.nome, login: u.usuario, senhaHash: hash, senhaSalt: salt,
              papel: "admin", ativo: true, criadoEm: new Date().toISOString(), ultimoAcesso: null,
            };
          })
        );
        setUsuarios(migrados);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function persist(overrides = {}) {
    if (loading) return; // proteção: nunca escreve enquanto o carregamento inicial não terminar
    const next = {
      fixedCosts, variableEntries, categorias, operacoes, funcionarios, periodos, diasUteis, diasUteisSemana, faturamentos, produtos, maquinas, previsoes,
      usuarios, auditoria,
      ...overrides,
    };
    setFixedCosts(next.fixedCosts);
    setVariableEntries(next.variableEntries);
    setCategorias(next.categorias);
    setOperacoes(next.operacoes);
    setFuncionarios(next.funcionarios);
    setPeriodos(next.periodos);
    setDiasUteis(String(next.diasUteis));
    setDiasUteisSemana(String(next.diasUteisSemana));
    setFaturamentos(next.faturamentos);
    setProdutos(next.produtos);
    setMaquinas(next.maquinas);
    setPrevisoes(next.previsoes);
    setUsuarios(next.usuarios);
    setAuditoria(next.auditoria);
    try {
      const res = await storageService.set(STORAGE_KEY, JSON.stringify(next), true);
      setSaveError(!res);
    } catch (e) {
      setSaveError(true);
    }
  }

  function addCategoria(nome) {
    const trimmed = nome.trim();
    if (!trimmed) return null;
    const existente = categorias.find((c) => c.toLowerCase() === trimmed.toLowerCase());
    if (existente) return existente;
    persist({ categorias: [...categorias, trimmed] });
    return trimmed;
  }

  function addOperacao(nome) {
    const trimmed = nome.trim();
    if (!trimmed) return null;
    const existente = operacoes.find((o) => o.toLowerCase() === trimmed.toLowerCase());
    if (existente) return existente;
    persist({ operacoes: [...operacoes, trimmed] });
    return trimmed;
  }

  const activeFixed = useMemo(() => fixedCosts.filter((f) => f.ativo), [fixedCosts]);

  const filteredVariable = useMemo(
    () => variableEntries.filter((e) => e.mes === currentMonth).sort((a, b) => b.valor - a.valor),
    [variableEntries, currentMonth]
  );

  const totalFixo = useMemo(() => calcularTotalFixoAtivo(fixedCosts), [fixedCosts]);
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
  function submitFixed() {
    if (!fixedForm.descricao.trim() || !fixedForm.valor) return;
    const valorNum = toNumber(fixedForm.valor);
    if (editingFixedId) {
      persist({ fixedCosts: fixedCosts.map((f) => (f.id === editingFixedId ? { ...f, ...fixedForm, valor: valorNum } : f)) });
    } else {
      persist({ fixedCosts: [...fixedCosts, { id: uid(), ...fixedForm, valor: valorNum, ativo: true }] });
    }
    resetFixedForm();
  }
  function editFixed(f) {
    setFixedForm({ descricao: f.descricao, categoria: f.categoria, valor: String(f.valor) });
    setEditingFixedId(f.id);
    setShowFixedForm(true);
  }
  function confirmNovaCategoriaFixed() {
    const nome = addCategoria(textoNovaCategoriaFixed);
    if (nome) setFixedForm((f) => ({ ...f, categoria: nome }));
    setTextoNovaCategoriaFixed("");
    setNovaCategoriaFixed(false);
  }
  function toggleFixedAtivo(id) {
    persist({ fixedCosts: fixedCosts.map((f) => (f.id === id ? { ...f, ativo: !f.ativo } : f)) });
  }
  function deleteFixed(id) {
    persist({ fixedCosts: fixedCosts.filter((f) => f.id !== id) });
  }

  // ---- custos pontuais ----
  function resetVarForm() {
    setVarForm(emptyForm);
    setEditingVarId(null);
    setShowVarForm(false);
  }
  function submitVar() {
    if (!varForm.descricao.trim() || !varForm.valor) return;
    const valorNum = toNumber(varForm.valor);
    if (editingVarId) {
      persist({ variableEntries: variableEntries.map((it) => (it.id === editingVarId ? { ...it, ...varForm, valor: valorNum } : it)) });
    } else {
      persist({ variableEntries: [...variableEntries, { id: uid(), mes: currentMonth, ...varForm, valor: valorNum }] });
    }
    resetVarForm();
  }
  function confirmNovaCategoriaVar() {
    const nome = addCategoria(textoNovaCategoriaVar);
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
    persist({ variableEntries: variableEntries.filter((e) => e.id !== id) });
  }

  // ---- funcionários ----
  const funcionariosAtivos = useMemo(() => funcionarios.filter((f) => f.ativo), [funcionarios]);

  const custoMensalFunc = calcularCustoMensalFuncionario;
  const totalCustoFuncionariosAtivos = useMemo(
    () => calcularTotalCustoFuncionariosAtivos(funcionariosAtivos),
    [funcionariosAtivos]
  );

  // horas produtivas: derivadas dos períodos de trabalho reais (M1, M2, M3, T1, T2, T3)
  const periodosComDuracao = useMemo(() => calcularPeriodosComDuracao(periodos), [periodos]);
  const periodosValidos = useMemo(() => filtrarPeriodosValidos(periodosComDuracao), [periodosComDuracao]);
  const horasPorDiaCalc = useMemo(() => calcularHorasPorDia(periodosValidos), [periodosValidos]);
  const duracaoMediaPeriodo = calcularDuracaoMediaPeriodo(periodosValidos, horasPorDiaCalc);

  const horasProdutivasFuncionario = useMemo(() => horasPorDiaCalc * toNumber(diasUteis), [horasPorDiaCalc, diasUteis]);
  const totalHorasProdutivasEmpresa = useMemo(
    () => horasProdutivasFuncionario * funcionariosAtivos.length,
    [horasProdutivasFuncionario, funcionariosAtivos]
  );
  const custoMedioFuncionarioMensal = funcionariosAtivos.length ? totalCustoFuncionariosAtivos / funcionariosAtivos.length : 0;

  const porOperacao = useMemo(() => {
    const map = {};
    funcionarios.forEach((f) => {
      if (!map[f.operacao]) map[f.operacao] = [];
      map[f.operacao].push(f);
    });
    return Object.entries(map);
  }, [funcionarios]);

  const { custoHoraPorOperacao, custoHoraEmpresa, rateioPorHora } = useMemo(
    () => calcularCustoHoraPorOperacao(funcionarios, fixedCosts, horasPorDiaCalc, diasUteis),
    [funcionarios, fixedCosts, horasPorDiaCalc, diasUteis]
  );
  function custoHoraIndividual(f) {
    return horasProdutivasFuncionario > 0 ? custoMensalFunc(f) / horasProdutivasFuncionario : 0;
  }
  function custoHoraSittech(f) {
    return custoHoraIndividual(f) + rateioPorHora;
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
  function submitFunc() {
    if (!funcForm.nome.trim()) return;
    const custosLimpos = funcCustos
      .filter((c) => c.descricao.trim() && c.valor)
      .map((c) => ({ id: c.id, descricao: c.descricao.trim(), valor: toNumber(c.valor) }));
    const payload = {
      nome: funcForm.nome.trim(),
      operacao: funcForm.operacao,
      salarioBase: toNumber(funcForm.salarioBase),
      custos: custosLimpos,
    };
    if (editingFuncId) {
      persist({ funcionarios: funcionarios.map((f) => (f.id === editingFuncId ? { ...f, ...payload } : f)) });
    } else {
      persist({ funcionarios: [...funcionarios, { id: uid(), ativo: true, ...payload }] });
    }
    resetFuncForm();
  }
  function editFunc(f) {
    setFuncForm({ nome: f.nome, operacao: f.operacao, salarioBase: String(f.salarioBase || "") });
    setFuncCustos(f.custos.map((c) => ({ ...c })));
    setEditingFuncId(f.id);
    setShowFuncForm(true);
  }
  function confirmNovaOperacao() {
    const nome = addOperacao(textoNovaOperacao);
    if (nome) setFuncForm((f) => ({ ...f, operacao: nome }));
    setTextoNovaOperacao("");
    setNovaOperacao(false);
  }
  function toggleFuncAtivo(id) {
    persist({ funcionarios: funcionarios.map((f) => (f.id === id ? { ...f, ativo: !f.ativo } : f)) });
  }
  function deleteFunc(id) {
    persist({ funcionarios: funcionarios.filter((f) => f.id !== id) });
  }
  function duplicateFunc(f) {
    persist({
      funcionarios: [
        ...funcionarios,
        { ...f, id: uid(), nome: f.nome + " (cópia)", custos: f.custos.map((c) => ({ ...c, id: uid() })) },
      ],
    });
  }

  function updatePeriodo(id, campo, valor) {
    persist({ periodos: periodos.map((p) => (p.id === id ? { ...p, [campo]: valor } : p)) });
  }
  function updateDiasUteis(v) { persist({ diasUteis: v }); }

  // ---- faturamento mensal ----
  function formatDataBR(iso) {
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  }
  const fatAtual = useMemo(
    () => faturamentos.find((f) => f.mes === currentMonth) || { mes: currentMonth, receitas: [], numFuncionarios: "", custoFuncionariosTotal: "", custoFixoTotal: "" },
    [faturamentos, currentMonth]
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

  function removeReceitaEverywhere(id) {
    return faturamentos.map((f) => ({ ...f, receitas: f.receitas.filter((r) => r.id !== id) }));
  }
  function addReceitaToMonth(list, mes, receita) {
    const idx = list.findIndex((f) => f.mes === mes);
    if (idx === -1) {
      return [...list, { mes, receitas: [receita], numFuncionarios: "", custoFuncionariosTotal: "", custoFixoTotal: "" }];
    }
    return list.map((f) => (f.mes === mes ? { ...f, receitas: [...f.receitas, receita] } : f));
  }
  function resetReceitaForm() {
    setReceitaForm({ data: `${currentMonth}-01`, descricao: "", valor: "" });
    setEditingReceitaId(null);
    setShowReceitaForm(false);
  }
  function submitReceita() {
    if (!receitaForm.data || !receitaForm.valor) return;
    const mes = receitaForm.data.slice(0, 7);
    const valorNum = toNumber(receitaForm.valor);
    const receita = { id: editingReceitaId || uid(), data: receitaForm.data, descricao: receitaForm.descricao.trim(), valor: valorNum };
    const base = editingReceitaId ? removeReceitaEverywhere(editingReceitaId) : faturamentos;
    persist({ faturamentos: addReceitaToMonth(base, mes, receita) });
    resetReceitaForm();
  }
  function editReceita(r) {
    setReceitaForm({ data: r.data, descricao: r.descricao || "", valor: String(r.valor) });
    setEditingReceitaId(r.id);
    setShowReceitaForm(true);
  }
  function deleteReceita(id) {
    persist({ faturamentos: removeReceitaEverywhere(id) });
  }
  function updateFatCampos(campos) {
    const idx = faturamentos.findIndex((f) => f.mes === currentMonth);
    if (idx === -1) {
      persist({ faturamentos: [...faturamentos, { mes: currentMonth, receitas: [], numFuncionarios: "", custoFuncionariosTotal: "", custoFixoTotal: "", ...campos }] });
    } else {
      persist({ faturamentos: faturamentos.map((f) => (f.mes === currentMonth ? { ...f, ...campos } : f)) });
    }
  }
  function preencherComDadosAtuais() {
    updateFatCampos({
      numFuncionarios: funcionariosAtivos.length,
      custoFuncionariosTotal: Math.round(totalCustoFuncionariosAtivos * 100) / 100,
      custoFixoTotal: Math.round(totalFixo * 100) / 100,
    });
  }
  const historicoFaturamento = useMemo(() => {
    return [...faturamentos]
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
  }, [faturamentos]);

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
  const [textoImportBackup, setTextoImportBackup] = useState("");
  const [resultadoImportBackup, setResultadoImportBackup] = useState("");

  const dadosBITodos = useMemo(() => {
    return [...faturamentos]
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
  }, [faturamentos]);

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

  // ---- produtos ----
  function calcularMargem(produto) {
    return calcularMargemProduto(produto, custoHoraPorOperacao, custoHoraEmpresa, periodosComDuracao);
  }

  // ---- cores de alerta pra números críticos ----
  function corPorMargemPct(pct) {
    if (pct < 0) return "var(--danger)";
    if (pct < 20) return "var(--warning)";
    return "var(--accent)";
  }
  function corPorLucroHora(valor) {
    if (valor < 0) return "var(--danger)";
    if (valor < 20) return "var(--warning)";
    return "var(--accent)";
  }
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

  const produtosOrdenados = useMemo(() => {
    const comRoteiro = produtos.filter((p) => (p.roteiro || []).length > 0);
    const semRoteiro = produtos.filter((p) => !(p.roteiro || []).length);
    comRoteiro.sort((a, b) => calcularMargem(b).lucroHora - calcularMargem(a).lucroHora);
    semRoteiro.sort((a, b) => a.nome.localeCompare(b.nome));
    return [...comRoteiro, ...semRoteiro];
  }, [produtos, custoHoraPorOperacao, periodosComDuracao]);

  function resetProdutoForm() {
    setProdutoForm(emptyProdutoForm);
    setProdutoRoteiro([]);
    setEditingProdutoId(null);
    setShowProdutoForm(false);
    setNovaOperacaoEtapaId(null);
    setTextoNovaOperacaoEtapa("");
  }
  function addEtapaProduto() {
    setProdutoRoteiro([
      ...produtoRoteiro,
      { id: uid(), operacao: operacoes[0] || "", metas: { m1: "", m2: "", m3: "", t1: "", t2: "", t3: "" }, maquinasIds: [] },
    ]);
  }
  function updateEtapaProduto(id, campo, valor) {
    setProdutoRoteiro(produtoRoteiro.map((e) => (e.id === id ? { ...e, [campo]: valor } : e)));
  }
  function updateEtapaMeta(id, periodoId, valor) {
    setProdutoRoteiro(
      produtoRoteiro.map((e) => (e.id === id ? { ...e, metas: { ...e.metas, [periodoId]: valor } } : e))
    );
  }
  function toggleEtapaMaquina(id, maquinaId) {
    setProdutoRoteiro(
      produtoRoteiro.map((e) => {
        if (e.id !== id) return e;
        const jaTem = e.maquinasIds.includes(maquinaId);
        return { ...e, maquinasIds: jaTem ? e.maquinasIds.filter((m) => m !== maquinaId) : [...e.maquinasIds, maquinaId] };
      })
    );
  }
  function removeEtapaProduto(id) {
    setProdutoRoteiro(produtoRoteiro.filter((e) => e.id !== id));
  }
  function confirmNovaOperacaoEtapa() {
    const nome = addOperacao(textoNovaOperacaoEtapa);
    if (nome && novaOperacaoEtapaId) updateEtapaProduto(novaOperacaoEtapaId, "operacao", nome);
    setTextoNovaOperacaoEtapa("");
    setNovaOperacaoEtapaId(null);
  }
  function submitProduto() {
    if (!produtoForm.nome.trim() || !produtoForm.valorUnitario) return;
    const valorNum = toNumber(produtoForm.valorUnitario);
    const roteiroLimpo = produtoRoteiro
      .filter((e) => e.operacao)
      .map((e) => ({
        id: e.id,
        operacao: e.operacao,
        metas: {
          m1: toNumber(e.metas.m1), m2: toNumber(e.metas.m2), m3: toNumber(e.metas.m3),
          t1: toNumber(e.metas.t1), t2: toNumber(e.metas.t2), t3: toNumber(e.metas.t3),
        },
        maquinasIds: e.maquinasIds,
      }));
    if (editingProdutoId) {
      persist({
        produtos: produtos.map((p) =>
          p.id === editingProdutoId ? { ...p, ...produtoForm, valorUnitario: valorNum, roteiro: roteiroLimpo } : p
        ),
      });
    } else {
      persist({
        produtos: [...produtos, { id: uid(), ...produtoForm, valorUnitario: valorNum, ativo: true, roteiro: roteiroLimpo }],
      });
    }
    resetProdutoForm();
  }
  function editProduto(p) {
    setProdutoForm({ nome: p.nome, referencia: p.referencia, valorUnitario: String(p.valorUnitario), prioridade: p.prioridade || "media" });
    setProdutoRoteiro(
      (p.roteiro || []).map((e) => ({
        id: e.id,
        operacao: e.operacao,
        metas: {
          m1: String(e.metas?.m1 || ""), m2: String(e.metas?.m2 || ""), m3: String(e.metas?.m3 || ""),
          t1: String(e.metas?.t1 || ""), t2: String(e.metas?.t2 || ""), t3: String(e.metas?.t3 || ""),
        },
        maquinasIds: e.maquinasIds || [],
      }))
    );
    setEditingProdutoId(p.id);
    setShowProdutoForm(true);
  }
  function toggleProdutoAtivo(id) {
    persist({ produtos: produtos.map((p) => (p.id === id ? { ...p, ativo: !p.ativo } : p)) });
  }
  function deleteProduto(id) {
    persist({ produtos: produtos.filter((p) => p.id !== id) });
  }

  // ---- máquinas ----
  const maquinasOrdenadas = useMemo(() => [...maquinas].sort((a, b) => a.nome.localeCompare(b.nome)), [maquinas]);
  const [maquinaExpandidaId, setMaquinaExpandidaId] = useState(null);
  function produtosQueUsamMaquina(maquinaId) {
    return produtos
      .map((p) => {
        const etapas = (p.roteiro || []).filter((e) => (e.maquinasIds || []).includes(maquinaId));
        return etapas.length > 0 ? { produto: p, etapas } : null;
      })
      .filter(Boolean);
  }
  function resetMaquinaForm() {
    setMaquinaForm(emptyMaquinaForm);
    setEditingMaquinaId(null);
    setShowMaquinaForm(false);
    setNovaOperacaoMaquina(false);
    setTextoNovaOperacaoMaquina("");
  }
  function confirmNovaOperacaoMaquina() {
    const nome = addOperacao(textoNovaOperacaoMaquina);
    if (nome) setMaquinaForm((f) => ({ ...f, operacao: nome }));
    setTextoNovaOperacaoMaquina("");
    setNovaOperacaoMaquina(false);
  }
  function submitMaquina() {
    if (!maquinaForm.nome.trim()) return;
    if (editingMaquinaId) {
      persist({ maquinas: maquinas.map((m) => (m.id === editingMaquinaId ? { ...m, ...maquinaForm } : m)) });
    } else {
      persist({ maquinas: [...maquinas, { id: uid(), ...maquinaForm, ativo: true }] });
    }
    resetMaquinaForm();
  }
  function editMaquina(m) {
    setMaquinaForm({ nome: m.nome, operacao: m.operacao });
    setEditingMaquinaId(m.id);
    setShowMaquinaForm(true);
  }
  function toggleMaquinaAtivo(id) {
    persist({ maquinas: maquinas.map((m) => (m.id === id ? { ...m, ativo: !m.ativo } : m)) });
  }
  function deleteMaquina(id) {
    persist({ maquinas: maquinas.filter((m) => m.id !== id) });
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
  const semanaHojeRec = previsoes.find((p) => p.semanaInicio === semanaHojeISO) || { itens: [], itensRealizados: [] };
  const previstoSemanaHoje = semanaHojeRec.itens.reduce((s, it) => s + it.quantidade * it.valorUnitario, 0);
  const realizadoSemanaHoje = (semanaHojeRec.itensRealizados || []).reduce((s, it) => s + it.quantidade * it.valorUnitario, 0);
  const metaSemanalUsaPrevisto = previstoSemanaHoje > 0;
  const metaSemanalFinal = metaSemanalUsaPrevisto ? previstoSemanaHoje : faturamentoSemanalNecessario;

  // ---- backup completo (exportar/restaurar) ----
  function gerarBackupTexto() {
    return JSON.stringify({
      fixedCosts, variableEntries, categorias, operacoes, funcionarios, periodos, diasUteis, diasUteisSemana, faturamentos, produtos, maquinas, previsoes,
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
  function handleRestaurarBackupColado() {
    try {
      const dados = JSON.parse(textoImportBackup);
      persist({
        fixedCosts: dados.fixedCosts || [],
        variableEntries: dados.variableEntries || [],
        categorias: dados.categorias && dados.categorias.length ? dados.categorias : CATEGORIAS,
        operacoes: dados.operacoes && dados.operacoes.length ? dados.operacoes : OPERACOES,
        funcionarios: dados.funcionarios || [],
        periodos: dados.periodos && dados.periodos.length ? dados.periodos : PERIODOS_PADRAO,
        diasUteis: dados.diasUteis !== undefined ? String(dados.diasUteis) : "22",
        diasUteisSemana: dados.diasUteisSemana !== undefined ? String(dados.diasUteisSemana) : "5",
        faturamentos: dados.faturamentos || [],
        produtos: dados.produtos || [],
        maquinas: dados.maquinas || [],
        previsoes: dados.previsoes || [],
      });
      setResultadoImportBackup("Backup restaurado com sucesso — todos os dados foram substituídos pelos do backup.");
      setTextoImportBackup("");
    } catch (e) {
      setResultadoImportBackup("Não consegui ler esse texto como backup válido. Confere se colou o conteúdo completo, sem cortar nada.");
    }
  }

  // ---- importação em massa ----
  function importarFuncionarios() {
    const linhas = textoImportFunc.split("\n").map((l) => l.trim()).filter(Boolean);
    const novosFuncionarios = [...funcionarios];
    const novasOperacoes = [...operacoes];
    let count = 0;
    linhas.forEach((linha) => {
      const partes = linha.split(";").map((p) => p.trim());
      if (partes.length < 3 || !partes[0]) return;
      const [nome, operacao, salarioBase, ...resto] = partes;
      const custos = resto
        .filter(Boolean)
        .map((item) => {
          const [desc, val] = item.split(":");
          return { id: uid(), descricao: (desc || "").trim(), valor: toNumber(val) };
        })
        .filter((c) => c.descricao);
      const opFinal = operacao || novasOperacoes[0] || "Produção";
      if (opFinal && !novasOperacoes.some((o) => o.toLowerCase() === opFinal.toLowerCase())) {
        novasOperacoes.push(opFinal);
      }
      novosFuncionarios.push({ id: uid(), ativo: true, nome, operacao: opFinal, salarioBase: toNumber(salarioBase), custos });
      count++;
    });
    persist({ funcionarios: novosFuncionarios, operacoes: novasOperacoes });
    setResultadoImportFunc(count > 0 ? `${count} funcionário(s) importado(s).` : "Nenhuma linha válida encontrada — confira o formato.");
    setTextoImportFunc("");
  }

  function importarFatMeses() {
    const linhas = textoImportFatMeses.split("\n").map((l) => l.trim()).filter(Boolean);
    const novosFaturamentos = [...faturamentos];
    let count = 0;
    linhas.forEach((linha) => {
      const partes = linha.split(";").map((p) => p.trim());
      if (partes.length < 4) return;
      const [mes, num, custoFunc, custoFixo] = partes;
      if (!/^\d{4}-\d{2}$/.test(mes)) return;
      const campos = { numFuncionarios: toNumber(num), custoFuncionariosTotal: toNumber(custoFunc), custoFixoTotal: toNumber(custoFixo) };
      const idx = novosFaturamentos.findIndex((f) => f.mes === mes);
      if (idx === -1) {
        novosFaturamentos.push({ mes, receitas: [], ...campos });
      } else {
        novosFaturamentos[idx] = { ...novosFaturamentos[idx], ...campos };
      }
      count++;
    });
    persist({ faturamentos: novosFaturamentos });
    setResultadoImportFatMeses(count > 0 ? `${count} mês(es) importado(s).` : "Nenhuma linha válida encontrada — confira o formato (AAAA-MM no início).");
    setTextoImportFatMeses("");
  }

  function importarReceitas() {
    const linhas = textoImportReceitas.split("\n").map((l) => l.trim()).filter(Boolean);
    const novosFaturamentos = [...faturamentos];
    let count = 0;
    linhas.forEach((linha) => {
      const partes = linha.split(";").map((p) => p.trim());
      if (partes.length < 2) return;
      const [data, valor, descricao] = partes;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return;
      const mes = data.slice(0, 7);
      const receita = { id: uid(), data, valor: toNumber(valor), descricao: descricao || "" };
      const idx = novosFaturamentos.findIndex((f) => f.mes === mes);
      if (idx === -1) {
        novosFaturamentos.push({ mes, receitas: [receita], numFuncionarios: "", custoFuncionariosTotal: "", custoFixoTotal: "" });
      } else {
        novosFaturamentos[idx] = { ...novosFaturamentos[idx], receitas: [...novosFaturamentos[idx].receitas, receita] };
      }
      count++;
    });
    persist({ faturamentos: novosFaturamentos });
    setResultadoImportReceitas(count > 0 ? `${count} lançamento(s) importado(s).` : "Nenhuma linha válida encontrada — confira o formato (AAAA-MM-DD no início).");
    setTextoImportReceitas("");
  }

  return (
    <div className="stx-root">
      <GlobalStyles cores={cores} />

      {loading || !autenticado ? (
        <LoginScreen
          loading={loading}
          tema={tema}
          loginUsuario={loginUsuario}
          setLoginUsuario={setLoginUsuario}
          loginSenha={loginSenha}
          setLoginSenha={setLoginSenha}
          loginErro={loginErro}
          loginCarregando={loginCarregando}
          onSubmit={handleLogin}
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
            onAbrirMinhaConta={() => { setMinhaContaAberta(true); setMinhaContaMsg(""); }}
            onSair={() => setAutenticado(false)}
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
          {abaAtiva === "horaEmpresa" && (
            <>
              <p className="stx-total-label">Custo/hora empresa</p>
              <p className="stx-total-value">{formatBRL(custoHoraEmpresa)}</p>
              <p className="stx-total-split">média {formatBRL(custoMedioFuncionarioMensal)}/mês por funcionário</p>
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
                <span className="v">{produtos.filter((p) => p.ativo).length}</span>
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
                      {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
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

              {loading ? (
                <div className="stx-empty">Carregando…</div>
              ) : fixedCosts.length === 0 ? (
                <div className="stx-empty">Nenhum custo fixo cadastrado ainda.</div>
              ) : (
                fixedCosts.map((f) => (
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
                      {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
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

              {loading ? (
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
            {saveError && <p className="stx-save-error">Não foi possível salvar agora. Tente novamente.</p>}
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
                    {operacoes.map((o) => <option key={o} value={o}>{o}</option>)}
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

            {loading ? (
              <div className="stx-empty">Carregando…</div>
            ) : funcionarios.length === 0 ? (
              <div className="stx-empty">Nenhum funcionário cadastrado ainda.</div>
            ) : (
              funcionarios.map((f) => (
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
          {saveError && <p className="stx-save-error">Não foi possível salvar agora. Tente novamente.</p>}
        </div>
      )}

      {abaAtiva === "produtos" && (
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
              <div className="stx-form">
                <div className="stx-form-full">
                  <label className="stx-label">Nome do produto</label>
                  <input
                    className="stx-input"
                    value={produtoForm.nome}
                    onChange={(e) => setProdutoForm({ ...produtoForm, nome: e.target.value })}
                    placeholder="Ex: Suporte de fixação industrial"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="stx-label">Referência</label>
                  <input
                    className="stx-input"
                    value={produtoForm.referencia}
                    onChange={(e) => setProdutoForm({ ...produtoForm, referencia: e.target.value })}
                    placeholder="Ex: SF-1024"
                  />
                </div>
                <div>
                  <label className="stx-label">Valor unitário (R$)</label>
                  <input
                    className="stx-input"
                    value={produtoForm.valorUnitario}
                    onChange={(e) => setProdutoForm({ ...produtoForm, valorUnitario: e.target.value })}
                    placeholder="0,00"
                    inputMode="decimal"
                  />
                </div>
                <div>
                  <label className="stx-label">Prioridade</label>
                  <select
                    className="stx-select"
                    value={produtoForm.prioridade}
                    onChange={(e) => setProdutoForm({ ...produtoForm, prioridade: e.target.value })}
                  >
                    <option value="alta">Alta</option>
                    <option value="media">Média</option>
                    <option value="baixa">Baixa</option>
                  </select>
                  <p className="stx-panel-sub" style={{ margin: "4px 0 0 0", fontSize: 11 }}>Ainda não afeta os cálculos — fica pronta pra quando formos priorizar entre produtos.</p>
                </div>

                <div className="stx-custos-builder">
                  <p className="stx-custos-builder-title">Fluxo de produção (etapas até a peça pronta)</p>
                  {produtoRoteiro.map((e) => {
                    const maquinasDaOperacao = maquinas.filter((m) => m.operacao === e.operacao && m.ativo);
                    return (
                      <div className="stx-etapa-card" key={e.id}>
                        <div className="stx-etapa-row">
                          <select
                            className="stx-select"
                            value={e.operacao}
                            onChange={(ev) => {
                              if (ev.target.value === "__nova__") { setNovaOperacaoEtapaId(e.id); }
                              else {
                                setProdutoRoteiro(produtoRoteiro.map((it) => (it.id === e.id ? { ...it, operacao: ev.target.value, maquinasIds: [] } : it)));
                              }
                            }}
                          >
                            {operacoes.map((op) => <option key={op} value={op}>{op}</option>)}
                            <option value="__nova__">+ Criar nova etapa/operação…</option>
                          </select>
                          <button type="button" className="stx-icon-btn danger" title="Remover etapa" onClick={() => removeEtapaProduto(e.id)}>✕</button>
                        </div>

                        {novaOperacaoEtapaId === e.id && (
                          <div className="stx-nova-cat-row">
                            <input
                              className="stx-input"
                              value={textoNovaOperacaoEtapa}
                              onChange={(ev) => setTextoNovaOperacaoEtapa(ev.target.value)}
                              onKeyDown={(ev) => ev.key === "Enter" && confirmNovaOperacaoEtapa()}
                              placeholder="Ex: Rosquear, Parafusar…"
                              autoFocus
                            />
                            <button type="button" className="stx-icon-btn on" title="Adicionar" onClick={confirmNovaOperacaoEtapa}>✓</button>
                            <button type="button" className="stx-icon-btn" title="Cancelar" onClick={() => { setNovaOperacaoEtapaId(null); setTextoNovaOperacaoEtapa(""); }}>✕</button>
                          </div>
                        )}

                        <p className="stx-etapa-sublabel">Meta de peças por período</p>
                        <div className="stx-etapa-metas">
                          {periodos.map((p) => (
                            <div className="stx-etapa-meta-campo" key={p.id}>
                              <label>{p.nome}</label>
                              <input
                                className="stx-input"
                                value={e.metas[p.id]}
                                onChange={(ev) => updateEtapaMeta(e.id, p.id, ev.target.value)}
                                placeholder="0"
                                inputMode="decimal"
                              />
                            </div>
                          ))}
                        </div>

                        <p className="stx-etapa-sublabel">Máquinas disponíveis pra essa etapa</p>
                        {maquinasDaOperacao.length === 0 ? (
                          <p className="stx-panel-sub" style={{ margin: 0 }}>
                            Nenhuma máquina cadastrada pra "{e.operacao}" ainda — cadastre na aba Máquinas.
                          </p>
                        ) : (
                          <div className="stx-etapa-maquinas">
                            {maquinasDaOperacao.map((m) => (
                              <label className="stx-maquina-chip" key={m.id}>
                                <input
                                  type="checkbox"
                                  checked={e.maquinasIds.includes(m.id)}
                                  onChange={() => toggleEtapaMaquina(e.id, m.id)}
                                />
                                {m.nome}
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <button type="button" className="stx-add-btn" style={{ marginTop: 4, marginBottom: 0 }} onClick={addEtapaProduto}>+ Adicionar etapa</button>
                </div>

                <div className="stx-form-actions">
                  <button type="button" className="stx-btn-primary" onClick={submitProduto}>
                    {editingProdutoId ? "Salvar alterações" : "Adicionar produto"}
                  </button>
                  <button type="button" className="stx-btn-secondary" onClick={resetProdutoForm}>Cancelar</button>
                </div>
              </div>
            )}

            {loading ? (
              <div className="stx-empty">Carregando…</div>
            ) : produtosOrdenados.length === 0 ? (
              <div className="stx-empty">Nenhum produto cadastrado ainda.</div>
            ) : (
              produtosOrdenados.map((p) => {
                const temRoteiro = (p.roteiro || []).length > 0;
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
                                const metasTexto = periodos.map((per) => `${per.nome}:${(e.metas || {})[per.id] || 0}`).join(" ");
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
          {saveError && <p className="stx-save-error">Não foi possível salvar agora. Tente novamente.</p>}
        </div>
      )}

      {abaAtiva === "maquinas" && (
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
              <div className="stx-form">
                <div>
                  <label className="stx-label">Nome da máquina</label>
                  <input
                    className="stx-input"
                    value={maquinaForm.nome}
                    onChange={(e) => setMaquinaForm({ ...maquinaForm, nome: e.target.value })}
                    onKeyDown={(e) => e.key === "Enter" && submitMaquina()}
                    placeholder="Ex: Rosqueadeira 3"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="stx-label">Operação</label>
                  <select
                    className="stx-select"
                    value={maquinaForm.operacao}
                    onChange={(e) => {
                      if (e.target.value === "__nova__") setNovaOperacaoMaquina(true);
                      else setMaquinaForm({ ...maquinaForm, operacao: e.target.value });
                    }}
                  >
                    {operacoes.map((op) => <option key={op} value={op}>{op}</option>)}
                    <option value="__nova__">+ Criar nova operação…</option>
                  </select>
                  {novaOperacaoMaquina && (
                    <div className="stx-nova-cat-row">
                      <input
                        className="stx-input"
                        value={textoNovaOperacaoMaquina}
                        onChange={(e) => setTextoNovaOperacaoMaquina(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && confirmNovaOperacaoMaquina()}
                        placeholder="Nome da operação"
                        autoFocus
                      />
                      <button type="button" className="stx-icon-btn on" title="Adicionar operação" onClick={confirmNovaOperacaoMaquina}>✓</button>
                      <button type="button" className="stx-icon-btn" title="Cancelar" onClick={() => { setNovaOperacaoMaquina(false); setTextoNovaOperacaoMaquina(""); }}>✕</button>
                    </div>
                  )}
                </div>
                <div className="stx-form-actions">
                  <button type="button" className="stx-btn-primary" onClick={submitMaquina}>
                    {editingMaquinaId ? "Salvar alterações" : "Adicionar máquina"}
                  </button>
                  <button type="button" className="stx-btn-secondary" onClick={resetMaquinaForm}>Cancelar</button>
                </div>
              </div>
            )}

            {loading ? (
              <div className="stx-empty">Carregando…</div>
            ) : maquinasOrdenadas.length === 0 ? (
              <div className="stx-empty">Nenhuma máquina cadastrada ainda.</div>
            ) : (
              maquinasOrdenadas.map((m) => {
                const usos = produtosQueUsamMaquina(m.id);
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
          {saveError && <p className="stx-save-error">Não foi possível salvar agora. Tente novamente.</p>}
        </div>
      )}

      {abaAtiva === "horaEmpresa" && (
        <div className="stx-grid">
          <div>
            <div className="stx-panel">
              <p className="stx-panel-title" style={{ marginBottom: 4 }}>Períodos de trabalho</p>
              <p className="stx-panel-sub">Horário real de cada período (3 no turno da manhã, 3 no da tarde). É a partir daqui que o sistema calcula as horas produtivas.</p>
              {periodos.map((p) => (
                <div className="stx-periodo-row" key={p.id}>
                  <span className="stx-periodo-nome">{p.nome}</span>
                  <input
                    type="time"
                    className="stx-input"
                    value={p.inicio}
                    onChange={(e) => updatePeriodo(p.id, "inicio", e.target.value)}
                  />
                  <span className="stx-periodo-ate">até</span>
                  <input
                    type="time"
                    className="stx-input"
                    value={p.fim}
                    onChange={(e) => updatePeriodo(p.id, "fim", e.target.value)}
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
                  value={diasUteis}
                  onChange={(e) => updateDiasUteis(e.target.value)}
                  placeholder="22"
                  inputMode="decimal"
                />
              </div>
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
            {porOperacao.length === 0 ? (
              <div className="stx-empty">Sem funcionários cadastrados.</div>
            ) : (
              porOperacao.map(([op, lista]) => {
                const ativosGrupo = lista.filter((f) => f.ativo);
                const totalMensalGrupo = ativosGrupo.reduce((s, f) => s + custoMensalFunc(f), 0);
                const totalHoraGrupo = ativosGrupo.reduce((s, f) => s + custoHoraSittech(f), 0);
                const totalHorasGrupo = horasProdutivasFuncionario * ativosGrupo.length;
                const mediaMensal = ativosGrupo.length ? totalMensalGrupo / ativosGrupo.length : 0;
                const mediaHora = ativosGrupo.length ? totalHoraGrupo / ativosGrupo.length : 0;
                return (
                  <div className="stx-op-group" key={op}>
                    <p className="stx-op-group-title">{op} · {ativosGrupo.length} ativo{ativosGrupo.length !== 1 ? "s" : ""}</p>
                    <div className="stx-op-summary">
                      <div className="stx-op-summary-item">
                        <span className="stx-op-summary-label">Custo médio / funcionário</span>
                        <span className="stx-op-summary-value">{formatBRL(mediaMensal)}/mês · {formatBRL(mediaHora)}/h</span>
                      </div>
                      <div className="stx-op-summary-item">
                        <span className="stx-op-summary-label">Total do grupo</span>
                        <span className="stx-op-summary-value highlight">{formatBRL(totalMensalGrupo)}/mês · {formatBRL(totalHoraGrupo)}/h</span>
                      </div>
                      <div className="stx-op-summary-item">
                        <span className="stx-op-summary-label">Horas produtivas do grupo</span>
                        <span className="stx-op-summary-value">{totalHorasGrupo}h/mês</span>
                      </div>
                    </div>
                    {lista.map((f) => (
                      <div className={`stx-op-func-line ${!f.ativo ? "paused" : ""}`} key={f.id}>
                        <span className="n">{f.nome}{!f.ativo ? " (pausado)" : ""}</span>
                        <span className="v">{formatBRL(custoHoraSittech(f))}/h</span>
                      </div>
                    ))}
                  </div>
                );
              })
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

              {loading ? (
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
            {saveError && <p className="stx-save-error">Não foi possível salvar agora. Tente novamente.</p>}
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
            <p className="stx-panel-title" style={{ marginBottom: 4 }}>Backup completo</p>
            <p className="stx-panel-sub">
              Gera um texto com absolutamente tudo que está salvo agora. Guarda isso antes de qualquer atualização do sistema —
              se um link novo vier vazio, é só colar de volta aqui embaixo, sem precisar redigitar nada.
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
            <p className="stx-panel-sub">Cola aqui um backup gerado antes. Isso substitui TODOS os dados atuais pelos do backup — use com cuidado.</p>
            <textarea
              className="stx-textarea"
              value={textoImportBackup}
              onChange={(e) => setTextoImportBackup(e.target.value)}
              placeholder="Cole o backup completo aqui..."
            />
            <div className="stx-form-actions" style={{ marginTop: 10 }}>
              <button type="button" className="stx-btn-primary" onClick={handleRestaurarBackupColado}>Restaurar backup</button>
            </div>
            {resultadoImportBackup && <p className="stx-import-resultado">{resultadoImportBackup}</p>}
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
                  <label className="stx-label">Login</label>
                  <input className="stx-input" value={usuarioForm.login} onChange={(e) => setUsuarioForm({ ...usuarioForm, login: e.target.value })} placeholder="usuario.login" />
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
                    <input type="password" className="stx-input" value={novaSenhaForm} onChange={(e) => setNovaSenhaForm(e.target.value)} placeholder="mínimo 4 caracteres" />
                  </div>
                )}
                {usuarioFormErro && <p className="stx-form-full" style={{ color: "var(--danger)", fontSize: 12.5 }}>{usuarioFormErro}</p>}
                <div className="stx-form-actions stx-form-full">
                  <button type="button" className="stx-btn-primary" onClick={submitUsuario}>{editingUsuarioId ? "Salvar alterações" : "Criar usuário"}</button>
                  <button type="button" className="stx-btn-secondary" onClick={resetUsuarioForm}>Cancelar</button>
                </div>
              </div>
            )}

            {usuarios.length === 0 ? (
              <div className="stx-empty">Nenhum usuário cadastrado ainda.</div>
            ) : (
              usuarios.map((u) => (
                <div key={u.id}>
                  <div className={`stx-entry ${!u.ativo ? "paused" : ""}`}>
                    <div>
                      <p className="stx-entry-desc">
                        {u.nome}
                        <span className={`stx-badge ${u.papel === "admin" ? "blueprint" : ""}`}>{u.papel === "admin" ? "Administrador" : "Usuário"}</span>
                        {!u.ativo && <span className="stx-badge" style={{ background: "rgba(217,83,79,0.15)", color: "var(--danger)" }}>inativo</span>}
                      </p>
                      <p className="stx-entry-meta">
                        login: {u.login} · criado em {new Date(u.criadoEm).toLocaleDateString("pt-BR")}
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
                      <input type="password" className="stx-input" value={senhaResetForm} onChange={(e) => setSenhaResetForm(e.target.value)} placeholder="Nova senha (mínimo 4 caracteres)" />
                      <button className="stx-btn-primary" onClick={() => confirmarResetSenha(u)}>Confirmar</button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="stx-panel">
            <p className="stx-panel-title" style={{ marginBottom: 10 }}>Registro de atividade</p>
            {auditoria.length === 0 ? (
              <div className="stx-empty">Nenhuma ação administrativa registrada ainda.</div>
            ) : (
              auditoria.slice(0, 30).map((a) => (
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
