"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  Home, CalendarClock, Gauge, Package, Cog, Receipt, LineChart as LineChartIcon, Wallet, Clock, Users, Upload,
  ChevronDown, ChevronRight, ChevronLeft, LayoutGrid, BarChart3, PauseCircle, ClipboardCheck, ClipboardList,
  Database, UserCog, AlertTriangle, X,
} from "lucide-react";
import { temPermissao, temAlgumaPermissaoProducaoReal } from "@/lib/permissoes";
import { LOGO_DARK, LOGO_LIGHT } from "@/lib/logos";

export interface GruposAbertos {
  gestao: boolean;
  financeiro: boolean;
  planejamento: boolean;
  producaoReal: boolean;
  administracao: boolean;
}

export interface SidebarProps {
  // Logo oficial (src/lib/logos.ts, mesmos assets já usados no LoginScreen)
  // — troca com o tema, igual lá; nunca recriado/estilizado.
  tema: "dark" | "light";
  abaAtiva: string;
  onNavigateTab: (key: string) => void;
  gruposAbertos: GruposAbertos;
  toggleGrupo: (grupo: keyof GruposAbertos) => void;
  // Aceita tanto o `Usuario` do blob local (monólito) quanto o `UsuarioLogado`
  // do Supabase Auth (rotas migradas). `permissoes` vem vazio/ausente pra
  // quem ainda não carregou (trata como "sem nenhuma", nunca libera à toa).
  usuarioLogado: { papel: "admin" | "usuario"; permissoes?: string[]; nome?: string } | null;
  metaSemanalUsaPrevisto: boolean;
  metaInvalida: boolean;
  metaSemanalFinal: number;
  formatBRL: (v: number) => string;
  onMetaClick: () => void;
  // Conta (movida do TopBar pro rodapé da sidebar nesta etapa — ver 4B).
  onAbrirMinhaConta: () => void;
  onSair: () => void;
  // Recolher/expandir (desktop ≥1024 e tablet 768–1023, rail de 72px) —
  // lembrado por dispositivo (ver useSidebarState.ts).
  recolhida: boolean;
  onToggleRecolhida: () => void;
  // Gaveta mobile (<768px) — aberta pelo botão de menu na TopBar, fecha
  // por Esc/clique fora/este próprio X.
  gavetaAberta: boolean;
  onFecharGaveta: () => void;
}

function iniciais(nome: string | undefined): string {
  if (!nome) return "?";
  const partes = nome.trim().split(/\s+/);
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

function ContaRodape({
  usuarioLogado, onAbrirMinhaConta, onSair, recolhida,
}: {
  usuarioLogado: { nome?: string } | null;
  onAbrirMinhaConta: () => void;
  onSair: () => void;
  recolhida: boolean;
}) {
  const [menuAberto, setMenuAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuAberto) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenuAberto(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuAberto(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuAberto]);

  return (
    <div className="stx-conta-rodape" ref={ref}>
      <button type="button" className="stx-conta-rodape-btn" onClick={() => setMenuAberto((v) => !v)} title={usuarioLogado?.nome}>
        <span className="stx-conta-avatar">{iniciais(usuarioLogado?.nome)}</span>
        {!recolhida && (
          <>
            <span className="stx-conta-nome">{usuarioLogado?.nome || "Conta"}</span>
            <ChevronDown size={13} className="stx-conta-chevron" />
          </>
        )}
      </button>
      {menuAberto && (
        <div className="stx-conta-menu">
          <button type="button" onClick={() => { setMenuAberto(false); onAbrirMinhaConta(); }}>Minha conta</button>
          <button type="button" onClick={() => { setMenuAberto(false); onSair(); }}>Sair</button>
        </div>
      )}
    </div>
  );
}

// Sidebar — redesign visual "Estúdio" (ver design_handoff_sittech_estudio,
// seções 4B/4H). Mesmo componente pro monólito legado e pras 14 páginas
// migradas (nenhuma duplicação). Itens que já navegam por rota real do
// Next.js usam <Link>; os que ainda vivem só dentro do monólito usam
// onNavigateTab — mas agora TODOS levam pro destino certo (ver correção do
// bug de navegação em cada onNavigateTab, resolvida no componente
// chamador: cada página migrada passa `(key) => router.push('/?aba='+key)`
// em vez do `() => router.push('/')` cego de antes).
export default function Sidebar({
  tema, abaAtiva, onNavigateTab, gruposAbertos, toggleGrupo, usuarioLogado,
  metaSemanalUsaPrevisto, metaInvalida, metaSemanalFinal, formatBRL, onMetaClick,
  onAbrirMinhaConta, onSair, recolhida, onToggleRecolhida, gavetaAberta, onFecharGaveta,
}: SidebarProps) {
  const logoSrc = tema === "dark" ? LOGO_DARK : LOGO_LIGHT;
  const conteudo = (
    <>
      <div className="stx-sidebar-marca">
        {recolhida ? (
          <span className="stx-sidebar-logo-wrap">
            <img src={logoSrc} alt="Sittech" className="stx-sidebar-logo-crop" />
          </span>
        ) : (
          <img src={logoSrc} alt="Sittech" className="stx-sidebar-logo" />
        )}
        {!recolhida && (
          <button type="button" className="stx-sidebar-recolher" onClick={onToggleRecolhida} title="Recolher menu" aria-label="Recolher menu">
            <ChevronLeft size={16} />
          </button>
        )}
      </div>

      <div className="stx-sidebar-itens">
        <button className={`stx-tab-v ${abaAtiva === "inicio" ? "active" : ""}`} onClick={() => onNavigateTab("inicio")} title="Início">
          <Home size={16} />{!recolhida && "Início"}
        </button>

        {(temPermissao(usuarioLogado, "financeiro") || temPermissao(usuarioLogado, "funcionarios") ||
          temPermissao(usuarioLogado, "produtos") || temPermissao(usuarioLogado, "maquinas") ||
          temPermissao(usuarioLogado, "custo_hora")) && (
          <>
            {!recolhida && (
              <button className="stx-sidebar-grupo-header" onClick={() => toggleGrupo("gestao")}>
                Gestão{gruposAbertos.gestao ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </button>
            )}
            {(recolhida || gruposAbertos.gestao) && (
              <>
                {temPermissao(usuarioLogado, "financeiro") && (
                  <button className={`stx-tab-v ${abaAtiva === "custos" ? "active" : ""}`} onClick={() => onNavigateTab("custos")} title="Custos mensais"><Wallet size={16} />{!recolhida && "Custos mensais"}</button>
                )}
                {temPermissao(usuarioLogado, "funcionarios") && (
                  <button className={`stx-tab-v ${abaAtiva === "funcionarios" ? "active" : ""}`} onClick={() => onNavigateTab("funcionarios")} title="Funcionários"><Users size={16} />{!recolhida && "Funcionários"}</button>
                )}
                {temPermissao(usuarioLogado, "produtos") && (
                  <Link href="/produtos" className={`stx-tab-v ${abaAtiva === "produtos" ? "active" : ""}`} title="Produtos"><Package size={16} />{!recolhida && "Produtos"}</Link>
                )}
                {temPermissao(usuarioLogado, "maquinas") && (
                  <Link href="/maquinas" className={`stx-tab-v ${abaAtiva === "maquinas" ? "active" : ""}`} title="Máquinas"><Cog size={16} />{!recolhida && "Máquinas"}</Link>
                )}
                {temPermissao(usuarioLogado, "custo_hora") && (
                  <Link href="/custo-hora" className={`stx-tab-v ${abaAtiva === "horaEmpresa" ? "active" : ""}`} title="Custo por hora"><Clock size={16} />{!recolhida && "Custo por hora"}</Link>
                )}
              </>
            )}
          </>
        )}

        {temPermissao(usuarioLogado, "financeiro") && (
          <>
            {!recolhida && (
              <button className="stx-sidebar-grupo-header" onClick={() => toggleGrupo("financeiro")}>
                Financeiro{gruposAbertos.financeiro ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </button>
            )}
            {(recolhida || gruposAbertos.financeiro) && (
              <>
                <button className={`stx-tab-v ${abaAtiva === "faturamento" ? "active" : ""}`} onClick={() => onNavigateTab("faturamento")} title="Faturamento mensal"><Receipt size={16} />{!recolhida && "Faturamento mensal"}</button>
                <button className={`stx-tab-v ${abaAtiva === "bi" ? "active" : ""}`} onClick={() => onNavigateTab("bi")} title="Análise de faturamento"><LineChartIcon size={16} />{!recolhida && "Análise de faturamento"}</button>
              </>
            )}
          </>
        )}

        {(temPermissao(usuarioLogado, "previsao") || temPermissao(usuarioLogado, "capacidade")) && (
          <>
            {!recolhida && (
              <button className="stx-sidebar-grupo-header" onClick={() => toggleGrupo("planejamento")}>
                Planejamento{gruposAbertos.planejamento ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </button>
            )}
            {(recolhida || gruposAbertos.planejamento) && (
              <>
                {temPermissao(usuarioLogado, "previsao") && (
                  <Link href="/previsao" className={`stx-tab-v ${abaAtiva === "previsao" ? "active" : ""}`} title="Previsão semanal"><CalendarClock size={16} />{!recolhida && "Previsão semanal"}</Link>
                )}
                {temPermissao(usuarioLogado, "capacidade") && (
                  <Link href="/capacidade" className={`stx-tab-v ${abaAtiva === "capacidade" ? "active" : ""}`} title="Capacidade semanal"><Gauge size={16} />{!recolhida && "Capacidade semanal"}</Link>
                )}
              </>
            )}
          </>
        )}

        {temAlgumaPermissaoProducaoReal(usuarioLogado) && (
          <>
            {!recolhida && (
              <button className="stx-sidebar-grupo-header" onClick={() => toggleGrupo("producaoReal")}>
                Produção real{gruposAbertos.producaoReal ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </button>
            )}
            {(recolhida || gruposAbertos.producaoReal) && (
              <>
                {temPermissao(usuarioLogado, "producao_real_apontamento") && (
                  <Link href="/producao-real" className={`stx-tab-v ${abaAtiva === "producaoRealPainel" ? "active" : ""}`} title="Apontamento"><ClipboardCheck size={16} />{!recolhida && "Apontamento"}</Link>
                )}
                {temPermissao(usuarioLogado, "producao_real_historico") && (
                  <Link href="/producao-real/apontamentos" className={`stx-tab-v ${abaAtiva === "producaoRealApontamentos" ? "active" : ""}`} title="Apontamentos realizados"><ClipboardList size={16} />{!recolhida && "Apontamentos realizados"}</Link>
                )}
                {temPermissao(usuarioLogado, "producao_real_historico") && (
                  <Link href="/producao-real/visao-geral" className={`stx-tab-v ${abaAtiva === "prVisaoGeral" ? "active" : ""}`} title="Visão geral"><LayoutGrid size={16} />{!recolhida && "Visão geral"}</Link>
                )}
                {temPermissao(usuarioLogado, "producao_real_historico") && (
                  <Link href="/producao-real/indicadores" className={`stx-tab-v ${abaAtiva === "prIndicadores" ? "active" : ""}`} title="Produtividade"><BarChart3 size={16} />{!recolhida && "Produtividade"}</Link>
                )}
                {temPermissao(usuarioLogado, "producao_real_historico") && (
                  <Link href="/producao-real/funcionarios" className={`stx-tab-v ${abaAtiva === "prFuncionarios" ? "active" : ""}`} title="Funcionários"><Users size={16} />{!recolhida && "Funcionários"}</Link>
                )}
                {temPermissao(usuarioLogado, "producao_real_historico") && (
                  <Link href="/producao-real/desvios" className={`stx-tab-v ${abaAtiva === "prDesvios" ? "active" : ""}`} title="Desvios"><AlertTriangle size={16} />{!recolhida && "Desvios"}</Link>
                )}
                {temPermissao(usuarioLogado, "producao_real_historico") && (
                  <Link href="/producao-real/paradas" className={`stx-tab-v ${abaAtiva === "prParadas" ? "active" : ""}`} title="Paradas"><PauseCircle size={16} />{!recolhida && "Paradas"}</Link>
                )}
                {(temPermissao(usuarioLogado, "previsao") && temPermissao(usuarioLogado, "producao_real_historico")) && (
                  <Link href="/producao-real/validacao-previsao" className={`stx-tab-v ${abaAtiva === "prValidacao" ? "active" : ""}`} title="Validação da previsão"><ClipboardCheck size={16} />{!recolhida && "Validação da previsão"}</Link>
                )}
                <button className={`stx-tab-v ${abaAtiva === "prDadosImportados" ? "active" : ""}`} onClick={() => onNavigateTab("prDadosImportados")} title="Dados importados"><Database size={16} />{!recolhida && "Dados importados"}</button>
              </>
            )}
          </>
        )}

        {usuarioLogado?.papel === "admin" && (
          <>
            {!recolhida && (
              <button className="stx-sidebar-grupo-header" onClick={() => toggleGrupo("administracao")}>
                Administração{gruposAbertos.administracao ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </button>
            )}
            {(recolhida || gruposAbertos.administracao) && (
              <>
                <button className={`stx-tab-v ${abaAtiva === "usuarios" ? "active" : ""}`} onClick={() => onNavigateTab("usuarios")} title="Usuários"><UserCog size={16} />{!recolhida && "Usuários"}</button>
                <button className={`stx-tab-v ${abaAtiva === "importar" ? "active" : ""}`} onClick={() => onNavigateTab("importar")} title="Importar dados"><Upload size={16} />{!recolhida && "Importar dados"}</button>
              </>
            )}
          </>
        )}
      </div>

      <div className="stx-sidebar-rodape">
        {recolhida && (
          <button type="button" className="stx-sidebar-expandir" onClick={onToggleRecolhida} title="Expandir menu" aria-label="Expandir menu">
            <ChevronRight size={16} />
          </button>
        )}
        {temPermissao(usuarioLogado, "financeiro") && !recolhida && (
          <div className="stx-sidebar-meta-card" onClick={onMetaClick}>
            <p className="stx-sidebar-meta-titulo">Meta semanal</p>
            <div className="stx-sidebar-meta-linha">
              <span className="stx-sidebar-meta-valor">{metaSemanalUsaPrevisto || !metaInvalida ? formatBRL(metaSemanalFinal) : "—"}</span>
            </div>
            <p className="stx-sidebar-meta-sub">da previsão já lançada</p>
            <div className="stx-sidebar-meta-barra"><span /></div>
          </div>
        )}
        <ContaRodape usuarioLogado={usuarioLogado} onAbrirMinhaConta={onAbrirMinhaConta} onSair={onSair} recolhida={recolhida} />
      </div>
    </>
  );

  return (
    <>
      {/* Gaveta mobile (<768px): a própria sidebar, sempre expandida dentro
          da gaveta (nunca faz sentido uma gaveta recolhida). */}
      {gavetaAberta && <div className="stx-sidebar-backdrop" onClick={onFecharGaveta} aria-hidden="true" />}
      <div className={`stx-sidebar ${recolhida ? "recolhida" : ""} ${gavetaAberta ? "gaveta-aberta" : ""}`}>
        {gavetaAberta && (
          <button type="button" className="stx-sidebar-fechar-gaveta" onClick={onFecharGaveta} aria-label="Fechar menu">
            <X size={17} />
          </button>
        )}
        {conteudo}
      </div>
    </>
  );
}
