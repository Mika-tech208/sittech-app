"use client";

import Link from "next/link";
import {
  Home, CalendarClock, Gauge, Package, Cog, Receipt, LineChart as LineChartIcon, Wallet, Clock, Users, Upload,
  Crown, ChevronDown, ChevronRight, Factory, Activity, PauseCircle, ClipboardCheck, ClipboardList, History, Database, UserCog, AlertTriangle,
} from "lucide-react";
import { LOGO_DARK, LOGO_LIGHT } from "@/lib/logos";
import { temPermissao, temAlgumaPermissaoProducaoReal } from "@/lib/permissoes";

export interface GruposAbertos {
  gestao: boolean;
  financeiro: boolean;
  planejamento: boolean;
  producaoReal: boolean;
  administracao: boolean;
}

export interface SidebarProps {
  tema: "dark" | "light";
  abaAtiva: string;
  onNavigateTab: (key: string) => void;
  gruposAbertos: GruposAbertos;
  toggleGrupo: (grupo: keyof GruposAbertos) => void;
  // Aceita tanto o `Usuario` do blob local (monólito) quanto o `UsuarioLogado`
  // do Supabase Auth (rotas migradas). `permissoes` vem vazio/ausente pra
  // quem ainda não carregou (trata como "sem nenhuma", nunca libera à toa).
  usuarioLogado: { papel: "admin" | "usuario"; permissoes?: string[] } | null;
  metaSemanalUsaPrevisto: boolean;
  metaInvalida: boolean;
  metaSemanalFinal: number;
  formatBRL: (v: number) => string;
  onMetaClick: () => void;
}

// Menu lateral — idêntico visualmente ao do app legado (mesmas classes
// stx-sidebar/stx-tab-v/stx-sidebar-grupo-header). "Previsão semanal",
// "Capacidade semanal", "Custo por hora", "Produtos" e "Máquinas" navegam
// por rota real do Next.js; os demais itens ainda usam onNavigateTab
// (abaAtiva), já que só esses domínios migraram até esta etapa.
export default function Sidebar({
  tema, abaAtiva, onNavigateTab, gruposAbertos, toggleGrupo, usuarioLogado,
  metaSemanalUsaPrevisto, metaInvalida, metaSemanalFinal, formatBRL, onMetaClick,
}: SidebarProps) {
  return (
    <div className="stx-sidebar">
      <div className="stx-sidebar-logo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={tema === "dark" ? LOGO_DARK : LOGO_LIGHT} alt="Sittech" className="stx-logo-sidebar" />
      </div>

      <button className={`stx-tab-v ${abaAtiva === "inicio" ? "active" : ""}`} onClick={() => onNavigateTab("inicio")}><Home size={16} />Início</button>

      {(temPermissao(usuarioLogado, "financeiro") || temPermissao(usuarioLogado, "funcionarios") ||
        temPermissao(usuarioLogado, "produtos") || temPermissao(usuarioLogado, "maquinas") ||
        temPermissao(usuarioLogado, "custo_hora")) && (
        <>
          <button className="stx-sidebar-grupo-header" onClick={() => toggleGrupo("gestao")}>
            {gruposAbertos.gestao ? <ChevronDown size={13} /> : <ChevronRight size={13} />}Gestão
          </button>
          {gruposAbertos.gestao && (
            <>
              {temPermissao(usuarioLogado, "financeiro") && (
                <button className={`stx-tab-v ${abaAtiva === "custos" ? "active" : ""}`} onClick={() => onNavigateTab("custos")}><Wallet size={16} />Custos mensais</button>
              )}
              {temPermissao(usuarioLogado, "funcionarios") && (
                <button className={`stx-tab-v ${abaAtiva === "funcionarios" ? "active" : ""}`} onClick={() => onNavigateTab("funcionarios")}><Users size={16} />Funcionários</button>
              )}
              {temPermissao(usuarioLogado, "produtos") && (
                <Link href="/produtos" className={`stx-tab-v ${abaAtiva === "produtos" ? "active" : ""}`}><Package size={16} />Produtos</Link>
              )}
              {temPermissao(usuarioLogado, "maquinas") && (
                <Link href="/maquinas" className={`stx-tab-v ${abaAtiva === "maquinas" ? "active" : ""}`}><Cog size={16} />Máquinas</Link>
              )}
              {temPermissao(usuarioLogado, "custo_hora") && (
                <Link href="/custo-hora" className={`stx-tab-v ${abaAtiva === "horaEmpresa" ? "active" : ""}`}><Clock size={16} />Custo por hora</Link>
              )}
            </>
          )}
        </>
      )}

      {temPermissao(usuarioLogado, "financeiro") && (
        <>
          <button className="stx-sidebar-grupo-header" onClick={() => toggleGrupo("financeiro")}>
            {gruposAbertos.financeiro ? <ChevronDown size={13} /> : <ChevronRight size={13} />}Financeiro
          </button>
          {gruposAbertos.financeiro && (
            <>
              <button className={`stx-tab-v ${abaAtiva === "faturamento" ? "active" : ""}`} onClick={() => onNavigateTab("faturamento")}><Receipt size={16} />Faturamento mensal</button>
              <button className={`stx-tab-v ${abaAtiva === "bi" ? "active" : ""}`} onClick={() => onNavigateTab("bi")}><LineChartIcon size={16} />Análise de faturamento</button>
            </>
          )}
        </>
      )}

      {(temPermissao(usuarioLogado, "previsao") || temPermissao(usuarioLogado, "capacidade")) && (
        <>
          <button className="stx-sidebar-grupo-header" onClick={() => toggleGrupo("planejamento")}>
            {gruposAbertos.planejamento ? <ChevronDown size={13} /> : <ChevronRight size={13} />}Planejamento
          </button>
          {gruposAbertos.planejamento && (
            <>
              {temPermissao(usuarioLogado, "previsao") && (
                <Link href="/previsao" className={`stx-tab-v ${abaAtiva === "previsao" ? "active" : ""}`}><CalendarClock size={16} />Previsão semanal</Link>
              )}
              {temPermissao(usuarioLogado, "capacidade") && (
                <Link href="/capacidade" className={`stx-tab-v ${abaAtiva === "capacidade" ? "active" : ""}`}><Gauge size={16} />Capacidade semanal</Link>
              )}
            </>
          )}
        </>
      )}

      {temAlgumaPermissaoProducaoReal(usuarioLogado) && (
        <>
          <button className="stx-sidebar-grupo-header" onClick={() => toggleGrupo("producaoReal")}>
            {gruposAbertos.producaoReal ? <ChevronDown size={13} /> : <ChevronRight size={13} />}Produção Real
          </button>
          {gruposAbertos.producaoReal && (
            <>
              {temPermissao(usuarioLogado, "producao_real_apontamento") && (
                <Link href="/producao-real" className={`stx-tab-v ${abaAtiva === "producaoRealPainel" ? "active" : ""}`}><ClipboardList size={16} />Apontamento</Link>
              )}
              {temPermissao(usuarioLogado, "producao_real_historico") && (
                <Link href="/producao-real/apontamentos" className={`stx-tab-v ${abaAtiva === "producaoRealApontamentos" ? "active" : ""}`}><History size={16} />Apontamentos realizados</Link>
              )}
              <button className={`stx-tab-v ${abaAtiva === "prVisaoGeral" ? "active" : ""}`} onClick={() => onNavigateTab("prVisaoGeral")}><Factory size={16} />Visão Geral</button>
              {temPermissao(usuarioLogado, "producao_real_historico") && (
                <Link href="/producao-real/indicadores" className={`stx-tab-v ${abaAtiva === "prIndicadores" ? "active" : ""}`}><Activity size={16} />Produtividade</Link>
              )}
              <button className={`stx-tab-v ${abaAtiva === "prFuncionarios" ? "active" : ""}`} onClick={() => onNavigateTab("prFuncionarios")}><Users size={16} />Funcionários</button>
              <button className={`stx-tab-v ${abaAtiva === "prDesvios" ? "active" : ""}`} onClick={() => onNavigateTab("prDesvios")}><AlertTriangle size={16} />Desvios</button>
              <button className={`stx-tab-v ${abaAtiva === "prParadas" ? "active" : ""}`} onClick={() => onNavigateTab("prParadas")}><PauseCircle size={16} />Paradas</button>
              <button className={`stx-tab-v ${abaAtiva === "prValidacao" ? "active" : ""}`} onClick={() => onNavigateTab("prValidacao")}><ClipboardCheck size={16} />Validação da Previsão</button>
              <button className={`stx-tab-v ${abaAtiva === "prDadosImportados" ? "active" : ""}`} onClick={() => onNavigateTab("prDadosImportados")}><Database size={16} />Dados Importados</button>
            </>
          )}
        </>
      )}

      {usuarioLogado?.papel === "admin" && (
        <>
          <button className="stx-sidebar-grupo-header" onClick={() => toggleGrupo("administracao")}>
            {gruposAbertos.administracao ? <ChevronDown size={13} /> : <ChevronRight size={13} />}Administração
          </button>
          {gruposAbertos.administracao && (
            <>
              <button className={`stx-tab-v ${abaAtiva === "usuarios" ? "active" : ""}`} onClick={() => onNavigateTab("usuarios")}><UserCog size={16} />Usuários</button>
              <button className={`stx-tab-v ${abaAtiva === "importar" ? "active" : ""}`} onClick={() => onNavigateTab("importar")}><Upload size={16} />Importar dados</button>
            </>
          )}
        </>
      )}

      {temPermissao(usuarioLogado, "financeiro") && (
        <div className="stx-sidebar-meta-card" onClick={onMetaClick}>
          <p className="stx-sidebar-meta-titulo"><Crown size={14} />Meta semanal</p>
          <p className="stx-sidebar-meta-valor">{metaSemanalUsaPrevisto || !metaInvalida ? formatBRL(metaSemanalFinal) : "—"}</p>
          <p className="stx-sidebar-meta-sub">da previsão já lançada</p>
        </div>
      )}
    </div>
  );
}
