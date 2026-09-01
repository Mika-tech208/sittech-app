"use client";

import Link from "next/link";
import {
  Home, CalendarClock, Gauge, Package, Cog, Receipt, LineChart as LineChartIcon, Wallet, Clock, Users, Upload,
  Crown, ChevronDown, ChevronRight, Factory, Activity, PauseCircle, ClipboardCheck, Database, UserCog, AlertTriangle,
} from "lucide-react";
import { LOGO_DARK, LOGO_LIGHT } from "@/lib/logos";
import type { Usuario } from "@/types/domain";

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
  usuarioLogado: Usuario | null;
  metaSemanalUsaPrevisto: boolean;
  metaInvalida: boolean;
  metaSemanalFinal: number;
  formatBRL: (v: number) => string;
  onMetaClick: () => void;
}

// Menu lateral — idêntico visualmente ao do app legado (mesmas classes
// stx-sidebar/stx-tab-v/stx-sidebar-grupo-header). "Previsão semanal" e
// "Capacidade semanal" navegam por rota real do Next.js (Etapa de extração
// de interface); os demais itens ainda usam onNavigateTab (abaAtiva), já
// que só esses dois domínios migraram nesta etapa.
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

      <button className="stx-sidebar-grupo-header" onClick={() => toggleGrupo("gestao")}>
        {gruposAbertos.gestao ? <ChevronDown size={13} /> : <ChevronRight size={13} />}Gestão
      </button>
      {gruposAbertos.gestao && (
        <>
          <button className={`stx-tab-v ${abaAtiva === "custos" ? "active" : ""}`} onClick={() => onNavigateTab("custos")}><Wallet size={16} />Custos mensais</button>
          <button className={`stx-tab-v ${abaAtiva === "funcionarios" ? "active" : ""}`} onClick={() => onNavigateTab("funcionarios")}><Users size={16} />Funcionários</button>
          <button className={`stx-tab-v ${abaAtiva === "produtos" ? "active" : ""}`} onClick={() => onNavigateTab("produtos")}><Package size={16} />Produtos</button>
          <button className={`stx-tab-v ${abaAtiva === "maquinas" ? "active" : ""}`} onClick={() => onNavigateTab("maquinas")}><Cog size={16} />Máquinas</button>
          <button className={`stx-tab-v ${abaAtiva === "horaEmpresa" ? "active" : ""}`} onClick={() => onNavigateTab("horaEmpresa")}><Clock size={16} />Custo por hora</button>
        </>
      )}

      <button className="stx-sidebar-grupo-header" onClick={() => toggleGrupo("financeiro")}>
        {gruposAbertos.financeiro ? <ChevronDown size={13} /> : <ChevronRight size={13} />}Financeiro
      </button>
      {gruposAbertos.financeiro && (
        <>
          <button className={`stx-tab-v ${abaAtiva === "faturamento" ? "active" : ""}`} onClick={() => onNavigateTab("faturamento")}><Receipt size={16} />Faturamento mensal</button>
          <button className={`stx-tab-v ${abaAtiva === "bi" ? "active" : ""}`} onClick={() => onNavigateTab("bi")}><LineChartIcon size={16} />Análise de faturamento</button>
        </>
      )}

      <button className="stx-sidebar-grupo-header" onClick={() => toggleGrupo("planejamento")}>
        {gruposAbertos.planejamento ? <ChevronDown size={13} /> : <ChevronRight size={13} />}Planejamento
      </button>
      {gruposAbertos.planejamento && (
        <>
          <Link href="/previsao" className={`stx-tab-v ${abaAtiva === "previsao" ? "active" : ""}`}><CalendarClock size={16} />Previsão semanal</Link>
          <Link href="/capacidade" className={`stx-tab-v ${abaAtiva === "capacidade" ? "active" : ""}`}><Gauge size={16} />Capacidade semanal</Link>
        </>
      )}

      <button className="stx-sidebar-grupo-header" onClick={() => toggleGrupo("producaoReal")}>
        {gruposAbertos.producaoReal ? <ChevronDown size={13} /> : <ChevronRight size={13} />}Produção Real
      </button>
      {gruposAbertos.producaoReal && (
        <>
          <button className={`stx-tab-v ${abaAtiva === "prVisaoGeral" ? "active" : ""}`} onClick={() => onNavigateTab("prVisaoGeral")}><Factory size={16} />Visão Geral</button>
          <button className={`stx-tab-v ${abaAtiva === "prProdutividade" ? "active" : ""}`} onClick={() => onNavigateTab("prProdutividade")}><Activity size={16} />Produtividade</button>
          <button className={`stx-tab-v ${abaAtiva === "prFuncionarios" ? "active" : ""}`} onClick={() => onNavigateTab("prFuncionarios")}><Users size={16} />Funcionários</button>
          <button className={`stx-tab-v ${abaAtiva === "prDesvios" ? "active" : ""}`} onClick={() => onNavigateTab("prDesvios")}><AlertTriangle size={16} />Desvios</button>
          <button className={`stx-tab-v ${abaAtiva === "prParadas" ? "active" : ""}`} onClick={() => onNavigateTab("prParadas")}><PauseCircle size={16} />Paradas</button>
          <button className={`stx-tab-v ${abaAtiva === "prValidacao" ? "active" : ""}`} onClick={() => onNavigateTab("prValidacao")}><ClipboardCheck size={16} />Validação da Previsão</button>
          <button className={`stx-tab-v ${abaAtiva === "prDadosImportados" ? "active" : ""}`} onClick={() => onNavigateTab("prDadosImportados")}><Database size={16} />Dados Importados</button>
        </>
      )}

      <button className="stx-sidebar-grupo-header" onClick={() => toggleGrupo("administracao")}>
        {gruposAbertos.administracao ? <ChevronDown size={13} /> : <ChevronRight size={13} />}Administração
      </button>
      {gruposAbertos.administracao && (
        <>
          {usuarioLogado?.papel === "admin" && (
            <button className={`stx-tab-v ${abaAtiva === "usuarios" ? "active" : ""}`} onClick={() => onNavigateTab("usuarios")}><UserCog size={16} />Usuários</button>
          )}
          <button className={`stx-tab-v ${abaAtiva === "importar" ? "active" : ""}`} onClick={() => onNavigateTab("importar")}><Upload size={16} />Importar dados</button>
        </>
      )}

      <div className="stx-sidebar-meta-card" onClick={onMetaClick}>
        <p className="stx-sidebar-meta-titulo"><Crown size={14} />Meta semanal</p>
        <p className="stx-sidebar-meta-valor">{metaSemanalUsaPrevisto || !metaInvalida ? formatBRL(metaSemanalFinal) : "—"}</p>
        <p className="stx-sidebar-meta-sub">da previsão já lançada</p>
      </div>
    </div>
  );
}
