"use client";

import type { ThemeColors } from "@/lib/constants";

// CSS do app inteiro (não só do domínio de Previsão/Capacidade) — extraído
// do bloco <style> que antes vivia dentro do render de SittechApp.tsx.
// Cada rota que renderiza fora do shell legado (ex: /previsao, /capacidade)
// precisa montar este componente também, senão fica sem estilo nenhum —
// o CSS nunca existiu fora do JSX de SittechApp.
export default function GlobalStyles({ cores }: { cores: ThemeColors }) {
  return (
    <style>{`
        /* Fonte carregada via next/font em src/app/layout.tsx (Schibsted
           Grotesk, self-hosted) — nenhum @import de Google Fonts aqui. */

        .stx-root {
          --bg: ${cores.bg};
          --surface: ${cores.surface};
          --surface-hover: ${cores.surfaceHover};
          --surface-raised: ${cores.surfaceRaised};
          --plane: ${cores.plane};
          --line: ${cores.line};
          --text: ${cores.text};
          --text-2: ${cores.text2};
          --text-3: ${cores.text3};
          --label: ${cores.label};
          --faint: ${cores.faint};
          --accent: ${cores.accent};
          --accent-hover: ${cores.accentHover};
          --accent-deep: ${cores.accentDeep};
          --accent-soft: ${cores.accentSoft};
          --warning: ${cores.warning};
          --danger: ${cores.danger};
          --on-accent: ${cores.onAccent};
          --pill-bg: ${cores.pillBg};
          --pill-bg-hover: ${cores.pillBgHover};
          --shadow-sm: ${cores.shadowSm};
          --shadow-lg: ${cores.shadowLg};

          /* Pontes de compatibilidade — nomes antigos, lidos por ~2000 linhas
             de CSS de conteúdo de página (Produção Real, Previsão, Financeiro
             etc.) que esta etapa não redesenha. Herdam a paleta nova sozinhos,
             sem reescrever cada regra de página. */
          --border: var(--line);
          --text-muted: var(--text-3);
          --btn-text: var(--on-accent);
          --blueprint: var(--accent-deep);
          --laranja: var(--warning);

          --font-display: var(--font-schibsted-grotesk), 'Schibsted Grotesk', sans-serif;
          --font-body: var(--font-schibsted-grotesk), 'Schibsted Grotesk', sans-serif;
          --font-mono: var(--font-schibsted-grotesk), 'Schibsted Grotesk', sans-serif;

          background-color: var(--bg);
          color: var(--text);
          font-family: var(--font-body);
          padding: 0;
          border-radius: 0;
          min-height: 100vh;
          box-sizing: border-box;
          transition: background-color 0.2s ease, color 0.2s ease;
        }
        .stx-root * { box-sizing: border-box; }

        .stx-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          flex-wrap: wrap;
          gap: 20px;
          margin-bottom: 22px;
          padding-bottom: 24px;
          border-bottom: 2px solid var(--border);
        }
        .stx-eyebrow {
          font-family: var(--font-body);
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--blueprint);
          margin: 0 0 6px 0;
        }
        .stx-logo {
          height: 68px;
          width: auto;
          display: block;
        }
        .stx-brand-row {
          display: flex;
          align-items: center;
          gap: 18px;
          flex-wrap: wrap;
        }
        @media (max-width: 480px) {
          .stx-logo { height: 48px; }
          .stx-brand-divider { display: none; }
        }
        .stx-brand-divider {
          width: 1px;
          height: 40px;
          background: var(--border);
        }
        .stx-header-right {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 10px;
        }
        .stx-theme-toggle {
          font-family: var(--font-body);
          font-size: 12px;
          font-weight: 500;
          background: var(--surface);
          color: var(--text);
          border: 1px solid var(--border);
          border-radius: 20px;
          padding: 6px 14px;
          cursor: pointer;
        }
        .stx-theme-toggle:hover { background: var(--surface-hover); }
        .stx-title {
          font-family: var(--font-display);
          font-size: 40px;
          font-weight: 600;
          letter-spacing: -0.035em;
          margin: 0;
          color: var(--text);
        }
        .stx-title-grande { font-size: 38px; }
        .stx-saudacao {
          font-family: var(--font-body);
          font-size: 15px;
          color: var(--text-muted);
          margin: 6px 0 0 0;
        }
        .stx-saudacao span { color: var(--accent); font-weight: 600; }

        .stx-tabs {
          display: flex;
          gap: 6px;
          margin-bottom: 20px;
          flex-wrap: wrap;
        }
        .stx-tab {
          font-family: var(--font-body);
          font-size: 13px;
          background: var(--pill-bg);
          color: var(--text-2);
          border: none;
          border-radius: 999px;
          padding: 8px 14px;
          cursor: pointer;
        }
        .stx-tab.active {
          background: var(--accent);
          color: var(--on-accent);
          font-weight: 600;
        }
        .stx-tab:hover:not(.active) { background: var(--pill-bg-hover); color: var(--text); }

        /* ---- Shell "Estúdio": topbar (linha de contexto) ---- */
        .stx-topbar {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 18px 0 22px;
          border-bottom: 1px solid var(--line);
          margin-bottom: 22px;
        }
        .stx-topbar-menu-btn {
          display: none;
          width: 40px;
          height: 40px;
          border-radius: 10px;
          border: none;
          background: var(--surface);
          color: var(--text);
          align-items: center;
          justify-content: center;
          cursor: pointer;
          flex-shrink: 0;
        }
        .stx-topbar-trilha {
          display: flex;
          align-items: baseline;
          gap: 8px;
          font-size: 13px;
          min-width: 0;
        }
        .stx-topbar-trilha-grupo { color: var(--text-3); white-space: nowrap; }
        .stx-topbar-trilha-sep { color: var(--faint); }
        .stx-topbar-trilha-pagina { color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .stx-topbar-spacer { flex: 1; min-width: 8px; }
        .stx-topbar-link {
          font-family: var(--font-body);
          font-size: 13px;
          color: var(--text-3);
          background: none;
          border: none;
          cursor: pointer;
          white-space: nowrap;
          padding: 6px 2px;
          transition: color 0.12s ease-out;
        }
        .stx-topbar-link:hover { color: var(--text); }

        /* ---- Gatilho da Intelligence (pill com anel pulsante) ---- */
        @keyframes stx-sit-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(62,207,165,.32); }
          60% { box-shadow: 0 0 0 6px rgba(62,207,165,0); }
        }
        .stx-intel-trigger {
          display: inline-flex;
          align-items: center;
          gap: 11px;
          border-radius: 999px;
          background: var(--pill-bg);
          border: none;
          padding: 6px 8px 6px 13px;
          cursor: pointer;
          box-shadow: inset 0 1px 0 rgba(255,255,255,.05), 0 6px 18px -10px rgba(0,0,0,.9);
          font-family: var(--font-body);
          flex-shrink: 0;
        }
        .stx-intel-trigger:hover { background: var(--pill-bg-hover); }
        .stx-intel-trigger-ring {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          border: 1px solid rgba(62,207,165,.38);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .stx-intel-trigger-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--accent);
          animation: stx-sit-pulse 3.4s ease-in-out infinite;
        }
        .stx-intel-trigger-label { font-size: 13.5px; font-weight: 500; letter-spacing: -0.005em; color: var(--text); }
        .stx-intel-trigger-kbd {
          font-size: 11px;
          color: var(--text-3);
          background: var(--surface-raised);
          border-radius: 6px;
          padding: 4px 7px;
        }

        /* ---- Shell "Estúdio": sidebar ---- */
        .stx-layout {
          display: flex;
          gap: 0;
          align-items: stretch;
          min-height: 100vh;
        }
        .stx-sidebar {
          display: flex;
          flex-direction: column;
          width: 248px;
          flex-shrink: 0;
          position: sticky;
          top: 0;
          align-self: flex-start;
          height: 100vh;
          overflow-y: auto;
          background: var(--plane);
          border: none;
          padding: 26px 0 22px;
          box-shadow: none;
          transition: width 0.18s ease-out;
        }
        .stx-sidebar.recolhida { width: 72px; align-items: center; }
        .stx-sidebar-marca {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 0 26px 30px;
        }
        .stx-sidebar.recolhida .stx-sidebar-marca { padding: 0 0 30px; justify-content: center; width: 100%; }
        /* Logo oficial (src/lib/logos.ts) — expandida: imagem inteira na
           altura da marca. Recolhida: mesma imagem, só a janela de 26x26
           mostra o ícone (object-position: left corta exatamente no
           quadrado do símbolo, sem recriar/recortar o arquivo). */
        .stx-sidebar-logo { height: 26px; width: auto; display: block; }
        .stx-sidebar-logo-wrap { width: 26px; height: 26px; overflow: hidden; flex-shrink: 0; }
        .stx-sidebar-logo-crop { height: 100%; width: 100%; object-fit: cover; object-position: left center; display: block; }
        .stx-sidebar-recolher {
          background: none;
          border: none;
          color: var(--text-3);
          cursor: pointer;
          display: flex;
          align-items: center;
          padding: 4px;
        }
        .stx-sidebar-recolher:hover { color: var(--text); }
        .stx-sidebar-itens { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow-y: auto; }
        .stx-sidebar.recolhida .stx-sidebar-itens { align-items: center; width: 100%; }
        .stx-logo-sidebar { display: none; }
        .stx-content-wrapper {
          flex: 1;
          min-width: 0;
          padding: 22px 32px 48px;
        }
        .stx-content {
          min-width: 0;
        }
        .stx-tab-v {
          font-family: var(--font-body);
          font-size: 14px;
          font-weight: 400;
          background: transparent;
          color: var(--text-2);
          border: none;
          border-radius: 0;
          padding: 8px 26px;
          text-align: left;
          cursor: pointer;
          width: 100%;
          display: flex;
          align-items: center;
          gap: 12px;
          position: relative;
          text-decoration: none;
        }
        .stx-sidebar.recolhida .stx-tab-v {
          width: 44px;
          height: 44px;
          padding: 0;
          border-radius: 12px;
          justify-content: center;
          margin: 2px 0;
        }
        .stx-tab-v svg { flex-shrink: 0; opacity: 0.8; }
        .stx-tab-v:hover:not(.active) { color: var(--text); background: transparent; }
        .stx-sidebar.recolhida .stx-tab-v:hover:not(.active) { background: var(--surface); }
        .stx-tab-v.active {
          background: transparent;
          color: var(--text);
          font-weight: 600;
        }
        .stx-tab-v.active svg { opacity: 1; color: var(--accent); stroke: var(--accent); }
        .stx-tab-v.active::before {
          content: "";
          position: absolute;
          left: 0;
          top: 9px;
          bottom: 9px;
          width: 2px;
          border-radius: 2px;
          background: var(--accent);
        }
        .stx-sidebar.recolhida .stx-tab-v.active { background: var(--accent-soft); }
        .stx-sidebar.recolhida .stx-tab-v.active::before { left: -6px; }
        .stx-tab-v-muted { color: var(--text-muted); opacity: 0.8; }
        .stx-sidebar-group { display: none; }
        .stx-sidebar-grupo-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
          width: 100%;
          background: transparent;
          border: none;
          cursor: pointer;
          font-family: var(--font-body);
          font-size: 11.5px;
          font-weight: 400;
          letter-spacing: 0.05em;
          color: var(--label);
          padding: 22px 26px 8px;
          text-align: left;
        }
        .stx-sidebar-grupo-header:hover { color: var(--text-2); }
        .stx-sidebar-grupo-header svg { flex-shrink: 0; opacity: 0.7; }
        .stx-sidebar-divider { display: none; }

        .stx-sidebar-rodape { margin-top: auto; padding: 0 26px; display: flex; flex-direction: column; gap: 14px; }
        .stx-sidebar.recolhida .stx-sidebar-rodape { padding: 0; align-items: center; width: 100%; }
        .stx-sidebar-expandir {
          width: 44px;
          height: 44px;
          border-radius: 12px;
          border: none;
          background: transparent;
          color: var(--text-3);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .stx-sidebar-expandir:hover { background: var(--surface); color: var(--text); }
        .stx-sidebar-meta-card { cursor: pointer; padding-top: 6px; border-top: 1px solid var(--line); }
        .stx-sidebar-meta-titulo { font-size: 12.5px; color: var(--text-3); margin: 0; }
        .stx-sidebar-meta-linha { display: flex; align-items: baseline; gap: 8px; margin-top: 8px; }
        .stx-sidebar-meta-valor { font-family: var(--font-display); font-size: 22px; font-weight: 600; letter-spacing: -0.03em; color: var(--text); margin: 0; }
        .stx-sidebar-meta-sub { font-size: 12.5px; color: var(--text-3); margin: 4px 0 0 0; }
        .stx-sidebar-meta-barra { height: 4px; border-radius: 2px; background: var(--line); margin-top: 12px; position: relative; overflow: hidden; }
        .stx-sidebar-meta-barra span { position: absolute; top: 0; bottom: 0; left: 0; width: 76%; background: var(--accent); }

        .stx-conta-rodape { position: relative; }
        .stx-conta-rodape-btn {
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
          background: none;
          border: none;
          cursor: pointer;
          padding: 4px 0;
          font-family: var(--font-body);
        }
        .stx-conta-avatar {
          width: 26px;
          height: 26px;
          border-radius: 50%;
          background: var(--surface-raised);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: 600;
          color: var(--text-2);
          flex-shrink: 0;
        }
        .stx-conta-nome { font-size: 13px; color: var(--text-2); flex: 1; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .stx-conta-chevron { color: var(--label); flex-shrink: 0; }
        .stx-conta-menu {
          position: absolute;
          bottom: calc(100% + 8px);
          left: 0;
          min-width: 168px;
          background: var(--surface);
          border-radius: 10px;
          box-shadow: 0 18px 40px -20px rgba(0,0,0,.9);
          padding: 6px;
          display: flex;
          flex-direction: column;
          z-index: 40;
        }
        .stx-conta-menu button {
          font-family: var(--font-body);
          font-size: 13.5px;
          color: var(--text);
          background: none;
          border: none;
          text-align: left;
          padding: 9px 10px;
          border-radius: 7px;
          cursor: pointer;
        }
        .stx-conta-menu button:hover { background: var(--surface-hover); }

        .stx-sidebar-backdrop { display: none; }
        .stx-sidebar-fechar-gaveta { display: none; }

        .stx-placeholder-pr {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          padding: 48px 32px;
          max-width: 560px;
          margin: 0 auto;
        }
        .stx-placeholder-pr-icone {
          width: 56px;
          height: 56px;
          border-radius: 50%;
          background: var(--accent-soft);
          color: var(--accent);
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 18px;
        }
        .stx-placeholder-pr-titulo { font-family: var(--font-display); font-size: 19px; font-weight: 700; color: var(--text); margin: 0 0 10px 0; }
        .stx-placeholder-pr-pergunta { font-size: 14px; font-style: italic; color: var(--text-muted); margin: 0 0 12px 0; }
        .stx-placeholder-pr-descricao { font-size: 13px; color: var(--text-muted); line-height: 1.6; margin: 0 0 20px 0; }
        .stx-placeholder-pr-status {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 11.5px;
          color: var(--accent);
          background: var(--accent-soft);
          border-radius: 8px;
          padding: 10px 16px;
          margin: 0;
        }

        /* ---- Visão Geral — composição "Estúdio" (fidelidade de layout,
           só nesta tela — ver design_handoff_sittech_estudio, 4C). Plano
           contínuo, sem stx-panel/borda em volta de cada bloco; hierarquia
           por escala tipográfica e espaço. Nenhum dado novo — só como os
           6 domínios já existentes (resultado.factoryHealth/forecast/
           openOccurrences/attentionItems/downtime/pressuredResource) são
           apresentados. ---- */
        .stx-vg-grid { display: grid; grid-template-columns: 1fr 372px; gap: 0; align-items: start; max-width: 1180px; }
        .stx-vg-primary { min-width: 0; padding-right: 20px; }
        .stx-vg-context { border-left: 1px solid var(--line); padding: 2px 0 2px 36px; display: flex; flex-direction: column; gap: 46px; min-width: 0; }
        @media (max-width: 1023px) {
          .stx-vg-grid { grid-template-columns: 1fr; max-width: none; }
          .stx-vg-primary { padding-right: 0; }
          .stx-vg-context { border-left: none; border-top: 1px solid var(--line); padding: 34px 0 0; margin-top: 40px; }
        }

        .stx-vg-window-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
        .stx-vg-window-label { font-size: 13.5px; color: var(--text-3); max-width: 680px; line-height: 1.55; }
        .stx-vg-week-pill { font-size: 13.5px; color: var(--text-2); background: var(--pill-bg); border-radius: 999px; padding: 10px 17px; white-space: nowrap; flex-shrink: 0; }
        .stx-vg-h1 { margin: 12px 0 0; font-size: 46px; font-weight: 600; letter-spacing: -0.035em; line-height: 1; color: var(--text); }

        .stx-vg-hero-row { display: flex; align-items: flex-end; gap: 40px; margin-top: 40px; flex-wrap: wrap; }
        .stx-vg-hero-label { font-size: 13.5px; color: var(--text-2); }
        .stx-vg-hero-value { font-family: var(--font-display); font-size: 64px; font-weight: 600; letter-spacing: -0.045em; line-height: .95; margin-top: 8px; color: var(--text); }
        .stx-vg-hero-caption { font-size: 13px; color: var(--text-3); margin-top: 9px; }

        .stx-vg-kpi-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 32px; margin-top: 44px; }
        .stx-vg-kpi-grid-4 { grid-template-columns: repeat(4, 1fr); }
        .stx-vg-kpi-label { font-size: 13px; color: var(--text-2); }
        .stx-vg-kpi-value { font-family: var(--font-display); font-size: 32px; font-weight: 600; letter-spacing: -0.03em; margin-top: 10px; color: var(--text); }
        .stx-vg-kpi-caption { font-size: 13px; color: var(--text-3); margin-top: 9px; }

        .stx-vg-section { margin-top: 60px; }
        .stx-vg-section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
        .stx-vg-section-title { margin: 0; font-size: 20px; font-weight: 600; letter-spacing: -0.02em; color: var(--text); }
        .stx-vg-section-link { font-family: var(--font-body); font-size: 13.5px; color: var(--text-3); background: none; border: none; cursor: pointer; padding: 0; white-space: nowrap; }
        .stx-vg-section-link:hover { color: var(--text); }
        .stx-vg-empty { font-size: 14px; color: var(--text-2); margin-top: 16px; }

        .stx-vg-table-head, .stx-vg-table-row { display: grid; grid-template-columns: 1.6fr 110px 1fr 150px; gap: 20px; }
        .stx-vg-table-head { font-size: 12.5px; color: var(--text-3); padding-bottom: 12px; margin-top: 24px; }
        .stx-vg-table-head .num { text-align: right; }
        .stx-vg-table-row { align-items: center; padding: 17px 0; border-top: 1px solid var(--line); font-size: 15px; color: var(--text); background: transparent; border-left: none; border-right: none; border-bottom: none; width: 100%; text-align: left; font-family: var(--font-body); cursor: default; transition: background-color .12s ease-out; }
        button.stx-vg-table-row { cursor: pointer; }
        button.stx-vg-table-row:hover { background: var(--surface-hover); }
        .stx-vg-table-row .num { text-align: right; }
        .stx-vg-bar-cell { display: flex; align-items: center; gap: 12px; }
        .stx-vg-bar-track { flex: 1; height: 4px; border-radius: 2px; background: var(--line); position: relative; overflow: hidden; }
        .stx-vg-bar-fill { position: absolute; top: 0; bottom: 0; left: 0; }
        .stx-vg-bar-pct { font-size: 13.5px; color: var(--text-2); width: 58px; text-align: right; flex-shrink: 0; }
        .stx-vg-estado { text-align: right; font-size: 13.5px; white-space: nowrap; }

        .stx-vg-list { margin-top: 20px; display: flex; flex-direction: column; }
        .stx-vg-list-row { display: flex; gap: 16px; align-items: flex-start; padding: 18px 0; border-top: 1px solid var(--line); background: transparent; border-left: none; border-right: none; border-bottom: none; width: 100%; text-align: left; font-family: var(--font-body); cursor: default; }
        button.stx-vg-list-row { cursor: pointer; transition: background-color .12s ease-out; }
        button.stx-vg-list-row:hover { background: var(--surface-hover); }
        .stx-vg-dot { width: 7px; height: 7px; border-radius: 50%; margin-top: 7px; flex-shrink: 0; }
        .stx-vg-list-title { font-size: 15px; color: var(--text); }
        .stx-vg-list-sub { font-size: 13px; color: var(--text-3); margin-top: 5px; }

        .stx-vg-ctx-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
        .stx-vg-ctx-title { margin: 0; font-size: 16.5px; font-weight: 600; letter-spacing: -0.015em; color: var(--text); }
        .stx-vg-ctx-badge { font-size: 13px; color: var(--danger); white-space: nowrap; }
        .stx-vg-occ-list { margin-top: 18px; display: flex; flex-direction: column; gap: 18px; }
        .stx-vg-occ-top { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
        .stx-vg-occ-nome { font-size: 15px; font-weight: 500; color: var(--text); }
        .stx-vg-occ-tempo { font-size: 14px; white-space: nowrap; }
        .stx-vg-occ-sub { font-size: 13px; color: var(--text-3); margin-top: 4px; }

        .stx-vg-stat-list { display: flex; flex-direction: column; gap: 16px; margin-top: 18px; }
        .stx-vg-stat-row { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
        .stx-vg-stat-label { font-size: 14px; color: var(--text-2); }
        .stx-vg-stat-value { font-size: 18px; font-weight: 600; color: var(--text); }

        .stx-vg-stacked-bar { display: flex; gap: 3px; height: 6px; margin-top: 20px; border-radius: 3px; overflow: hidden; }
        .stx-vg-stacked-legend { font-size: 12.5px; color: var(--text-3); margin-top: 11px; line-height: 1.55; }

        .stx-vg-resource-row { display: flex; align-items: baseline; gap: 10px; margin-top: 14px; }
        .stx-vg-resource-nome { font-size: 16px; font-weight: 500; color: var(--text); }
        .stx-vg-resource-pct { font-family: var(--font-display); font-size: 30px; font-weight: 600; letter-spacing: -0.03em; }
        .stx-vg-resource-caption { font-size: 13px; color: var(--text-3); margin-top: 9px; line-height: 1.55; }

        .stx-vg-link { font-family: var(--font-body); font-size: 13.5px; color: var(--accent); background: none; border: none; cursor: pointer; padding: 0; margin-top: 8px; }
        .stx-vg-link:hover { color: var(--accent-hover); }

        @media (max-width: 600px) {
          .stx-vg-h1 { font-size: 30px; }
          .stx-vg-hero-value { font-size: 44px; }
          .stx-vg-kpi-grid { grid-template-columns: 1fr 1fr; gap: 20px; row-gap: 26px; }
          .stx-vg-kpi-value { font-size: 26px; }
          .stx-vg-table-head, .stx-vg-table-row { grid-template-columns: 1.5fr 76px 1fr; gap: 10px; }
          .stx-vg-table-head span:nth-child(4), .stx-vg-table-row .stx-vg-estado { display: none; }
          .stx-vg-bar-pct { width: 44px; }
        }

        /* ---- Apontamento — composição "Estúdio" (só /producao-real).
           Classes stx-ap-* são EXCLUSIVAS desta página e dos modais do seu
           próprio fluxo (EscolhaFluxoModal/ApontamentoModal/SemProducaoModal/
           AbrirOcorrenciaModal/EncerrarOcorrenciaModal/PeriodoSeletorModal)
           — nunca reaproveitam .stx-modal-card/.stx-input/.stx-select/
           .stx-btn-*/.stx-pr-* genéricos (usados em Apontamentos realizados
           e em todo o resto do app) pra não vazar estilo pra outra tela.
           ParadasManuaisEditor.tsx é compartilhado com ApontamentosRealizados
           e continua com suas classes .stx-pr-* originais, de propósito.
           Prioridade/tablet/toque — nenhum RPC, regra, elegibilidade ou
           cálculo tocado; só apresentação. ---- */
        .stx-ap-header-top { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; }
        .stx-ap-header-label { font-size: 13px; color: var(--text-3); }
        .stx-ap-outro-periodo-pill { font-family: var(--font-body); font-size: 13px; color: var(--text-2); background: var(--pill-bg); border: none; border-radius: 999px; padding: 8px 15px; cursor: pointer; min-height: 36px; }
        .stx-ap-outro-periodo-pill:hover { color: var(--text); background: var(--pill-bg-hover); }
        .stx-ap-retroativo-badge { display: inline-block; font-size: 12px; font-weight: 600; letter-spacing: .04em; color: var(--warning); background: rgba(224,163,64,.12); border-radius: 999px; padding: 6px 13px; margin-bottom: 14px; }

        .stx-ap-toprow { display: flex; align-items: flex-end; justify-content: space-between; gap: 32px; flex-wrap: wrap; margin-top: 14px; }
        .stx-ap-period-row { display: flex; align-items: baseline; gap: 16px; margin-top: 12px; flex-wrap: wrap; }
        .stx-ap-period-h1 { margin: 0; font-size: 44px; font-weight: 600; letter-spacing: -0.035em; line-height: 1; color: var(--text); }
        .stx-ap-period-datetime { font-size: 15px; color: var(--text-2); }

        .stx-ap-progress-row { display: flex; align-items: center; gap: 16px; margin-top: 20px; max-width: 560px; }
        .stx-ap-progress-track { flex: 1; height: 6px; border-radius: 3px; background: var(--line); position: relative; overflow: hidden; }
        .stx-ap-progress-fill { position: absolute; top: 0; bottom: 0; left: 0; background: var(--accent); transition: width .2s ease; }
        .stx-ap-progress-text { font-size: 14px; color: var(--text-2); white-space: nowrap; }
        .stx-ap-progress-text b { color: var(--text); font-weight: 600; }
        .stx-ap-completo-banner { display: flex; align-items: center; gap: 8px; background: var(--accent-soft); color: var(--accent); border-radius: 10px; padding: 12px 18px; font-size: 14px; font-weight: 600; margin-top: 18px; }

        .stx-ap-btn-ocorrencia { font-family: var(--font-body); font-size: 14.5px; font-weight: 600; color: var(--on-accent); background: var(--danger); border: none; border-radius: 12px; min-height: 56px; padding: 0 26px; cursor: pointer; flex: none; display: inline-flex; align-items: center; gap: 10px; transition: opacity .15s ease; }
        .stx-ap-btn-ocorrencia:hover { opacity: .9; }
        .stx-ap-btn-ocorrencia:disabled { opacity: .5; cursor: not-allowed; }

        .stx-ap-legend-row { display: flex; align-items: center; gap: 20px; margin: 32px 0 16px; flex-wrap: wrap; }
        .stx-ap-legend-label { font-size: 13px; color: var(--text-3); }
        .stx-ap-legend-counts { display: flex; gap: 18px; font-size: 12.5px; color: var(--text-3); flex-wrap: wrap; }
        .stx-ap-legend-item { display: flex; align-items: center; gap: 7px; }
        .stx-ap-legend-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }

        .stx-ap-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
        .stx-ap-tile { background: var(--surface); border-radius: 12px; padding: 18px; min-height: 108px; display: flex; flex-direction: column; justify-content: space-between; cursor: pointer; border: none; text-align: left; width: 100%; font-family: var(--font-body); transition: background-color .12s ease-out; }
        .stx-ap-tile:hover { background: var(--surface-hover); }
        .stx-ap-tile.stx-ap-tile-static { cursor: default; }
        .stx-ap-tile.parada { background: #2A1E1D; }
        .stx-ap-tile.parada:hover { background: #33221F; }
        .stx-ap-tile.fechada { background: #1D1C1B; }
        .stx-ap-tile.fechada:hover { background: #232120; }
        .stx-ap-tile-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
        .stx-ap-tile-nome { font-size: 19px; font-weight: 600; letter-spacing: -0.02em; color: var(--text); }
        .stx-ap-tile.fechada .stx-ap-tile-nome { font-weight: 500; color: var(--text-2); }
        .stx-ap-tile-pill { font-size: 12px; font-weight: 500; border-radius: 999px; padding: 5px 10px; flex-shrink: 0; white-space: nowrap; font-family: var(--font-body); border: none; }
        .stx-ap-tile-pill.pendente { color: var(--warning); background: rgba(224,163,64,.12); }
        .stx-ap-tile-pill.parada-agora { color: var(--danger); background: rgba(226,105,92,.16); cursor: pointer; min-height: 30px; }
        .stx-ap-tile-estado-inline { font-size: 12px; font-weight: 500; flex-shrink: 0; }
        .stx-ap-tile-estado-inline.apontado { color: var(--accent); }
        .stx-ap-tile-estado-inline.sem-producao { color: var(--text-3); }
        .stx-ap-tile-footer { font-size: 12.5px; color: var(--text-3); }
        .stx-ap-tile.parada .stx-ap-tile-footer { color: var(--danger); }

        @media (max-width: 1100px) { .stx-ap-grid { grid-template-columns: repeat(3, 1fr); } }
        @media (max-width: 700px) { .stx-ap-grid { grid-template-columns: repeat(2, 1fr); } .stx-ap-period-h1 { font-size: 32px; } }
        @media (max-width: 460px) { .stx-ap-grid { grid-template-columns: 1fr; } .stx-ap-toprow { flex-direction: column; align-items: stretch; } .stx-ap-btn-ocorrencia { width: 100%; justify-content: center; } }

        .stx-ap-modal-card { background: var(--surface); border-radius: 14px; padding: 26px; width: 100%; max-width: 480px; max-height: 88vh; overflow-y: auto; box-shadow: 0 30px 70px -30px rgba(0,0,0,.95); font-family: var(--font-body); }
        .stx-ap-modal-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
        .stx-ap-modal-eyebrow { font-size: 12.5px; color: var(--text-3); }
        .stx-ap-modal-title { font-size: 22px; font-weight: 600; letter-spacing: -0.025em; margin: 6px 0 0; color: var(--text); }
        .stx-ap-modal-close { background: none; border: none; color: var(--text-3); cursor: pointer; padding: 6px; font-size: 15px; flex-shrink: 0; }
        .stx-ap-modal-close:hover { color: var(--text); }
        .stx-ap-field { margin-bottom: 14px; }
        .stx-ap-field-label { display: block; font-size: 13px; color: var(--text-2); margin-bottom: 8px; }
        .stx-ap-select, .stx-ap-input { width: 100%; box-sizing: border-box; font-family: var(--font-body); font-size: 15px; color: var(--text); background: var(--bg); border: 1px solid var(--line); border-radius: 10px; padding: 13px 14px; min-height: 48px; }
        .stx-ap-select:focus, .stx-ap-input:focus { outline: 2px solid rgba(62,207,165,.35); outline-offset: 1px; border-color: var(--accent); }
        .stx-ap-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .stx-ap-error { font-size: 13px; color: var(--danger); margin: 8px 0 0; }

        .stx-ap-actions { display: flex; flex-direction: column; gap: 10px; margin-top: 18px; }
        .stx-ap-btn-primary { font-family: var(--font-body); font-size: 15px; font-weight: 600; color: var(--on-accent); background: var(--accent); border: none; border-radius: 12px; min-height: 56px; cursor: pointer; transition: background-color .15s ease; }
        .stx-ap-btn-primary:hover { background: var(--accent-hover); }
        .stx-ap-btn-primary:disabled { opacity: .5; cursor: not-allowed; }
        .stx-ap-btn-secondary { font-family: var(--font-body); font-size: 14.5px; font-weight: 500; color: var(--text); background: var(--surface-hover); border: none; border-radius: 12px; min-height: 56px; cursor: pointer; transition: background-color .15s ease; }
        .stx-ap-btn-secondary:hover { background: var(--surface-raised); }
        .stx-ap-btn-secondary:disabled { opacity: .5; cursor: not-allowed; }

        .stx-ap-choice-actions { display: flex; flex-direction: column; gap: 10px; margin-top: 20px; }
        .stx-ap-choice-btn { font-family: var(--font-body); min-height: 72px; font-size: 16px; border-radius: 12px; border: none; cursor: pointer; transition: background-color .15s ease; }
        .stx-ap-choice-btn.primario { font-weight: 600; color: var(--on-accent); background: var(--accent); }
        .stx-ap-choice-btn.primario:hover { background: var(--accent-hover); }
        .stx-ap-choice-btn.secundario { font-weight: 500; color: var(--text); background: var(--surface-hover); }
        .stx-ap-choice-btn.secundario:hover { background: var(--surface-raised); }

        .stx-ap-motivo-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px; }
        .stx-ap-motivo-btn { font-family: var(--font-body); background: var(--surface-hover); border: 1px solid transparent; color: var(--text); border-radius: 10px; padding: 16px 10px; min-height: 52px; font-size: 14px; font-weight: 500; cursor: pointer; text-align: center; transition: background-color .15s ease, border-color .15s ease; }
        .stx-ap-motivo-btn:hover { background: var(--surface-raised); }
        .stx-ap-motivo-btn.selecionado { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); }
        .stx-ap-motivo-btn:last-child:nth-child(odd) { grid-column: 1 / -1; }

        .stx-ap-confirm { text-align: center; padding: 10px 0; }
        .stx-ap-confirm-check { font-size: 14px; font-weight: 600; color: var(--accent); margin: 0; }
        .stx-ap-confirm-detail { font-size: 14.5px; color: var(--text-2); margin: 10px 0 0; }
        .stx-ap-confirm-label { font-size: 12px; letter-spacing: .06em; color: var(--text-3); margin: 26px 0 0; }
        .stx-ap-confirm-value { font-size: 48px; font-weight: 700; letter-spacing: -0.03em; color: var(--text); margin: 6px 0 0; }
        .stx-ap-confirm-sub { font-size: 12.5px; color: var(--text-3); margin: 8px 0 0; }
        .stx-ap-confirm-actions { display: flex; flex-direction: column; gap: 10px; margin-top: 24px; }

        .stx-ap-resumo-linhas { display: flex; flex-direction: column; gap: 10px; margin: 16px 0; }
        .stx-ap-resumo-linha { display: flex; justify-content: space-between; gap: 12px; font-size: 13.5px; border-bottom: 1px solid var(--line); padding-bottom: 8px; }
        .stx-ap-resumo-linha span { color: var(--text-3); }
        .stx-ap-resumo-linha b { color: var(--text); font-weight: 600; text-align: right; }

        @media (max-width: 600px) {
          .stx-ap-modal-card { padding: 20px; max-width: none; }
          .stx-ap-grid-2 { grid-template-columns: 1fr 1fr; }
        }

        /* ---- Previsão Semanal — composição "Estúdio" (só /previsao).
           Classes stx-prev-* exclusivas desta página. StatusProgramacao/
           ProdutosProgramados/ItensPrevistos/AjustarCapacidadeModal são
           usados SÓ aqui (confirmado), mas as classes .stx-analise-*/
           .stx-capacidade-reais-* que eles chamam por dentro são
           COMPARTILHADAS com Desvios/Funcionários/Indicadores/Paradas/
           Validação da Previsão — nunca alteradas; só o wrapper externo de
           StatusProgramacao troca de classe. Nenhum cálculo/hook tocado —
           só apresentação; Previsto/Possível/Realizado/Falta continuam
           vindo exatamente de calcularProdutosProgramados/
           calcularResumoProgramacaoPecas (peças) e resumoSemana (R$),
           nunca de Produção Real. ---- */
        .stx-prev-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; flex-wrap: wrap; }
        .stx-prev-week-nav { display: flex; align-items: center; gap: 10px; }
        .stx-prev-week-pill { font-family: var(--font-body); font-size: 13px; color: var(--text-2); background: var(--pill-bg); border: none; border-radius: 999px; padding: 8px 13px; cursor: pointer; min-height: 36px; }
        .stx-prev-week-pill:hover { background: var(--pill-bg-hover); color: var(--text); }
        .stx-prev-week-label { font-size: 13px; color: var(--text-2); white-space: nowrap; }
        .stx-prev-h1 { margin: 14px 0 0; font-size: 40px; font-weight: 600; letter-spacing: -0.035em; line-height: 1; color: var(--text); }
        .stx-prev-header-actions { display: flex; gap: 8px; align-items: flex-start; flex-wrap: wrap; flex: none; }
        .stx-prev-pill-btn { font-family: var(--font-body); font-size: 13px; color: var(--text-2); background: var(--pill-bg); border: none; border-radius: 999px; padding: 9px 15px; cursor: pointer; white-space: nowrap; min-height: 36px; }
        .stx-prev-pill-btn:hover { background: var(--pill-bg-hover); color: var(--text); }
        .stx-prev-pill-btn-primary { font-family: var(--font-body); font-size: 13.5px; font-weight: 600; color: var(--on-accent); background: var(--accent); border: none; border-radius: 9px; padding: 10px 16px; cursor: pointer; white-space: nowrap; min-height: 36px; }
        .stx-prev-pill-btn-primary:hover { background: var(--accent-hover); }
        .stx-prev-pdf-hint { font-size: 11px; color: var(--text-3); margin: 4px 0 0; text-align: right; }

        .stx-prev-hero-row { display: flex; align-items: flex-end; gap: 44px; margin-top: 36px; flex-wrap: wrap; }
        .stx-prev-hero-label { font-size: 13px; color: var(--text-2); }
        .stx-prev-hero-value { font-family: var(--font-display); font-size: 52px; font-weight: 600; letter-spacing: -0.04em; line-height: .95; margin-top: 9px; color: var(--text); }
        .stx-prev-sec-value { font-family: var(--font-display); font-size: 27px; font-weight: 500; letter-spacing: -0.03em; margin-top: 8px; color: var(--text); }
        .stx-prev-hero-caption { font-size: 12.5px; color: var(--text-3); margin-top: 16px; line-height: 1.6; max-width: 820px; }

        .stx-prev-grid { display: grid; grid-template-columns: 1fr 372px; gap: 0; align-items: start; margin-top: 12px; }
        .stx-prev-primary { min-width: 0; padding-right: 20px; }
        .stx-prev-context { border-left: 1px solid var(--line); padding: 2px 0 2px 32px; display: flex; flex-direction: column; gap: 40px; min-width: 0; }
        @media (max-width: 1180px) {
          .stx-prev-grid { grid-template-columns: 1fr; }
          .stx-prev-primary { padding-right: 0; }
          .stx-prev-context { border-left: none; border-top: 1px solid var(--line); padding: 32px 0 0; margin-top: 36px; }
        }

        .stx-prev-section { margin-top: 48px; }
        .stx-prev-section:first-child { margin-top: 0; }
        .stx-prev-section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
        .stx-prev-section-title { margin: 0; font-size: 18px; font-weight: 600; letter-spacing: -0.02em; color: var(--text); }

        .stx-prev-table-head, .stx-prev-table-row { display: grid; grid-template-columns: 1.7fr 90px 90px 90px 90px 70px; gap: 16px; }
        .stx-prev-table-head { font-size: 12px; color: var(--text-3); padding-bottom: 10px; }
        .stx-prev-table-head .num { text-align: right; }
        .stx-prev-table-row { align-items: center; padding: 14px 0; border-top: 1px solid var(--line); font-size: 14px; color: var(--text); transition: background-color .12s ease-out; }
        .stx-prev-table-row:hover { background: var(--surface-hover); }
        .stx-prev-table-row.total { color: var(--text-3); font-size: 13.5px; }
        .stx-prev-table-row.total .num { color: var(--text); }
        .stx-prev-table-row .num { text-align: right; }
        .stx-prev-ref { color: var(--label); font-size: 12px; margin-left: 6px; }
        .stx-prev-bar-cell { display: flex; flex-direction: column; gap: 5px; }
        .stx-prev-bar-track { height: 3px; border-radius: 2px; background: var(--line); position: relative; overflow: hidden; }
        .stx-prev-bar-fill { position: absolute; top: 0; bottom: 0; left: 0; }

        /* StatusProgramacao mantém 100% do conteúdo/classes internos
           (.stx-analise-*, .stx-status-*, .stx-capacidade-reais-* —
           compartilhadas) — só o wrapper externo troca de .stx-panel
           .stx-analise-capacidade pra isto, um pouco mais discreto
           (plano contínuo) mas ainda com sinal semântico de cor na borda. */
        .stx-prev-status { border-radius: 10px; padding: 18px 20px; background: var(--surface); border-left: 3px solid transparent; }
        .stx-prev-status.ok { border-left-color: var(--accent); }
        .stx-prev-status.alerta { border-left-color: var(--danger); }

        @media (max-width: 700px) {
          .stx-prev-h1 { font-size: 28px; }
          .stx-prev-hero-value { font-size: 36px; }
          .stx-prev-hero-row { gap: 28px; }
          .stx-prev-table-head, .stx-prev-table-row { grid-template-columns: 1.6fr 70px 70px 70px; gap: 8px; }
          .stx-prev-table-head span:nth-child(4), .stx-prev-table-head span:nth-child(5),
          .stx-prev-table-row span:nth-child(4), .stx-prev-table-row .stx-prev-bar-cell { display: none; }
        }

        /* ---- Apontamentos realizados — composição "Estúdio" (só
           /producao-real/apontamentos). Classes stx-apr-* exclusivas desta
           página — o toggle/painel/grid de filtros usa NOMES novos porque
           .stx-pr-filtros-* é compartilhado com Desvios/Paradas/Produtividade
           (não redesenhadas ainda), então não podia ser redefinido aqui.
           ResumoApontamentoModal e ParadasManuaisEditor (compartilhado
           também com o modal de novo apontamento em /producao-real) passam
           a usar as MESMAS classes .stx-ap-* já criadas no arco anterior —
           reaproveita o vocabulário de modal em vez de inventar um terceiro;
           como consequência, o editor de paradas dentro do modal "Novo
           apontamento" (já aprovado) herda o mesmo estilo, sem mudar
           comportamento algum. ---- */
        .stx-apr-filtros-toggle { font-family: var(--font-body); font-size: 13px; color: var(--text-2); background: none; border: none; cursor: pointer; padding: 0; display: flex; align-items: center; gap: 5px; margin-bottom: 18px; }
        .stx-apr-filtros-toggle:hover { color: var(--text); }
        .stx-apr-filtros-panel { border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); padding: 18px 0; margin-bottom: 20px; }
        .stx-apr-filtros-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px 16px; }
        @media (max-width: 900px) { .stx-apr-filtros-grid { grid-template-columns: repeat(2, 1fr); } }
        .stx-apr-filtros-actions { display: flex; gap: 8px; margin-top: 14px; }
        .stx-apr-pill-btn { font-family: var(--font-body); font-size: 13px; color: var(--text-2); background: var(--pill-bg); border: none; border-radius: 999px; padding: 9px 15px; cursor: pointer; min-height: 36px; }
        .stx-apr-pill-btn:hover { background: var(--pill-bg-hover); color: var(--text); }
        .stx-apr-pill-btn-primary { font-family: var(--font-body); font-size: 13.5px; font-weight: 600; color: var(--on-accent); background: var(--accent); border: none; border-radius: 9px; padding: 10px 16px; cursor: pointer; min-height: 36px; }
        .stx-apr-pill-btn-primary:hover { background: var(--accent-hover); }
        .stx-apr-ref { font-size: 12px; color: var(--text-3); margin: 0 0 12px; }

        .stx-apr-list { display: flex; flex-direction: column; }
        .stx-apr-row { display: flex; flex-direction: column; gap: 5px; padding: 14px 4px; border-top: 1px solid var(--line); cursor: pointer; transition: background-color .12s ease-out; }
        .stx-apr-row:hover { background: var(--surface-hover); }
        .stx-apr-row-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        .stx-apr-row-data { font-size: 13.5px; color: var(--text); }
        .stx-apr-row-right { display: flex; align-items: center; gap: 8px; }
        .stx-apr-row-detalhe { font-size: 13px; color: var(--text-2); margin: 0; }
        .stx-apr-pill { font-size: 11.5px; font-weight: 600; letter-spacing: .02em; padding: 3px 9px; border-radius: 999px; }
        .stx-apr-pill.estado-produzindo { color: var(--accent); background: var(--accent-soft); }
        .stx-apr-pill.estado-sem_producao { color: var(--warning); background: rgba(224,163,64,.15); }

        .stx-ap-btn-danger { font-family: var(--font-body); font-size: 14.5px; font-weight: 500; color: var(--danger); background: var(--surface-hover); border: none; border-radius: 12px; min-height: 56px; cursor: pointer; transition: background-color .15s ease; }
        .stx-ap-btn-danger:hover { background: rgba(226,105,92,.15); }
        .stx-ap-btn-danger:disabled { opacity: .5; cursor: not-allowed; }
        .stx-ap-btn-danger.solido { color: var(--on-accent); background: var(--danger); }
        .stx-ap-btn-danger.solido:hover { filter: brightness(1.08); }

        .stx-ap-paradas { margin-bottom: 16px; }
        .stx-ap-paradas-lista { display: flex; flex-direction: column; gap: 8px; margin: 10px 0; }
        .stx-ap-parada-linha { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 0; border-top: 1px solid var(--line); }
        .stx-ap-parada-linha.bloqueada { opacity: .7; }
        .stx-ap-parada-nome { display: block; font-size: 13.5px; color: var(--text); }
        .stx-ap-parada-legenda { display: block; font-size: 11.5px; color: var(--text-3); margin-top: 2px; }
        .stx-ap-parada-acoes { display: flex; gap: 4px; flex-shrink: 0; }
        .stx-ap-parada-form { display: flex; flex-direction: column; gap: 10px; margin-top: 10px; }
        .stx-ap-parada-form-acoes { display: flex; gap: 8px; }
        .stx-ap-parada-form-acoes .stx-ap-btn-primary, .stx-ap-parada-form-acoes .stx-ap-btn-secondary { min-height: 44px; font-size: 13.5px; flex: 1; }
        .stx-ap-add-parada-btn { font-family: var(--font-body); font-size: 13.5px; color: var(--accent); background: none; border: none; cursor: pointer; padding: 6px 0; text-align: left; }
        .stx-ap-add-parada-btn:hover { color: var(--accent-hover); }
        .stx-ap-parada-total { font-size: 12.5px; color: var(--text-3); margin: 10px 0 0; }

        /* ---- Produtividade / Funcionários / Desvios / Paradas / Validação
           da previsão — composição "Estúdio". .stx-section substitui
           .stx-panel como wrapper de seção estática (resumos, painéis
           únicos) — nunca redefine .stx-panel em si, que continua servindo
           Produtos/Máquinas/Custo-hora/Capacidade/Início (fora do escopo
           desta etapa). .stx-queue-item substitui .stx-panel usado em
           listas repetidas (1 card por incidente/sinal/produto/contexto —
           fila de desvios, sinais de funcionário, produtos programados da
           validação, contextos do detalhe de funcionário): mesma
           informação, sem caixa, com hairline entre itens. As tabelas
           densas (.stx-ind-tabela-*) já eram borderless e já herdam as
           cores do Estúdio via as variáveis-ponte (--border/--text-muted) —
           não precisaram mudar. */
        .stx-section { margin: 0 0 32px; }
        .stx-section > .stx-panel-title { padding-bottom: 12px; border-bottom: 1px solid var(--line); margin-bottom: 14px; }
        .stx-section > .stx-panel-title-row { padding-bottom: 12px; border-bottom: 1px solid var(--line); margin-bottom: 14px; }

        .stx-queue-item { padding: 16px 4px; border-top: 1px solid var(--line); }
        .stx-queue-item:first-child { border-top: none; padding-top: 0; }

        /* ---- Início (aba "inicio" no monólito) — composição "Estúdio".
           Lucro líquido como protagonista (herói), faturamento bruto como
           decomposição secundária — nunca cartões concorrentes. Classes
           stx-home-* exclusivas desta aba. */
        .stx-home-hero-row { display: flex; align-items: flex-end; gap: 56px; margin-top: 36px; flex-wrap: wrap; }
        .stx-home-hero-label { font-size: 13px; color: var(--text-2); }
        .stx-home-hero-value { font-family: var(--font-display); font-size: 60px; font-weight: 600; letter-spacing: -0.045em; line-height: .95; margin-top: 10px; color: var(--text); }
        .stx-home-hero-sub { font-size: 13.5px; color: var(--text-3); margin-top: 10px; }
        .stx-home-hero-secondary { padding-bottom: 6px; }
        .stx-home-sec-value { font-family: var(--font-display); font-size: 30px; font-weight: 500; letter-spacing: -0.03em; margin-top: 8px; color: var(--text); }
        .stx-home-hero-sub-small { font-size: 12.5px; color: var(--text-3); margin-top: 6px; }
        .stx-home-stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 26px; margin-top: 44px; }
        .stx-home-stat-label { font-size: 12.5px; color: var(--text-2); }
        .stx-home-stat-value { font-family: var(--font-display); font-size: 25px; font-weight: 600; letter-spacing: -0.03em; margin-top: 8px; color: var(--text); }
        .stx-home-stat-sub { font-size: 12.5px; color: var(--text-3); margin-top: 8px; }
        .stx-home-empty-nota { font-size: 13px; color: var(--text-3); margin-top: 20px; }
        .stx-home-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 0; }
        @media (max-width: 900px) {
          .stx-home-stats-grid { grid-template-columns: repeat(2, 1fr); }
          .stx-home-grid-2 { grid-template-columns: 1fr; }
        }

        /* ---- Capacidade semanal (/capacidade) — composição "Estúdio".
           Classes stx-cap-* exclusivas desta página; reaproveita
           .stx-prev-bar-track/.stx-prev-bar-fill (utilitário de barra já
           existente, não semântico de Previsão) pra barra de uso por
           operação. */
        .stx-cap-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }
        .stx-cap-week-nav { display: flex; align-items: center; gap: 10px; }
        .stx-cap-week-pill { font-family: var(--font-body); font-size: 13px; color: var(--text-2); background: var(--pill-bg); border: none; border-radius: 999px; padding: 8px 13px; cursor: pointer; min-height: 36px; }
        .stx-cap-week-pill:hover { background: var(--pill-bg-hover); color: var(--text); }
        .stx-cap-week-label { font-size: 13px; color: var(--text-2); white-space: nowrap; }
        .stx-cap-h1 { margin: 14px 0 0; font-size: 40px; font-weight: 600; letter-spacing: -0.035em; line-height: 1; color: var(--text); }

        .stx-cap-resumo { margin-top: 24px; max-width: 780px; }
        .stx-cap-resumo-linha { display: flex; align-items: flex-start; gap: 10px; font-size: 14px; color: var(--text); margin: 0 0 10px 0; line-height: 1.55; }
        .stx-cap-resumo-linha:last-child { margin-bottom: 0; }
        .stx-cap-resumo-icone { flex-shrink: 0; width: 18px; height: 18px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; background: var(--surface-hover); color: var(--text-2); margin-top: 1px; }
        .stx-cap-resumo-icone.on { background: var(--accent-soft); color: var(--accent); }
        .stx-cap-resumo-icone.danger { background: rgba(226,105,92,.15); color: var(--danger); }

        .stx-cap-hero-row { display: flex; align-items: flex-end; gap: 44px; margin-top: 32px; flex-wrap: wrap; }
        .stx-cap-hero-label { font-size: 13px; color: var(--text-2); }
        .stx-cap-hero-value { font-family: var(--font-display); font-size: 52px; font-weight: 600; letter-spacing: -0.04em; line-height: .95; margin-top: 9px; color: var(--accent); }
        .stx-cap-sec-value { font-family: var(--font-display); font-size: 27px; font-weight: 500; letter-spacing: -0.03em; margin-top: 8px; color: var(--text); }

        .stx-cap-grid { display: grid; grid-template-columns: 1fr 340px; gap: 0; align-items: start; margin-top: 40px; }
        .stx-cap-primary { min-width: 0; padding-right: 20px; }
        .stx-cap-context { border-left: 1px solid var(--line); padding: 2px 0 2px 32px; display: flex; flex-direction: column; gap: 40px; min-width: 0; }
        @media (max-width: 1180px) {
          .stx-cap-grid { grid-template-columns: 1fr; }
          .stx-cap-primary { padding-right: 0; }
          .stx-cap-context { border-left: none; border-top: 1px solid var(--line); padding: 32px 0 0; margin-top: 36px; }
        }

        .stx-cap-section { margin-top: 48px; }
        .stx-cap-section:first-child { margin-top: 0; }
        .stx-cap-section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
        .stx-cap-section-title { margin: 0; font-size: 17px; font-weight: 600; letter-spacing: -0.02em; color: var(--text); }
        .stx-cap-ref { font-size: 12.5px; color: var(--text-3); line-height: 1.5; }

        .stx-cap-table-head, .stx-cap-table-row { display: grid; grid-template-columns: 1.7fr 90px 90px 90px 120px; gap: 16px; }
        .stx-cap-table-head { font-size: 12px; color: var(--text-3); padding-bottom: 10px; }
        .stx-cap-table-head .num { text-align: right; }
        .stx-cap-table-row { align-items: center; padding: 14px 0; border-top: 1px solid var(--line); font-size: 14px; color: var(--text); transition: background-color .12s ease-out; }
        .stx-cap-table-row:hover { background: var(--surface-hover); }
        .stx-cap-table-row .num { text-align: right; }

        .stx-cap-toggle-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 0; border-top: 1px solid var(--line); font-size: 13.5px; cursor: pointer; }
        .stx-cap-toggle { width: 34px; height: 20px; border-radius: 999px; background: var(--surface-raised); position: relative; flex: none; cursor: pointer; transition: background-color .15s ease; }
        .stx-cap-toggle.on { background: var(--accent); }
        .stx-cap-toggle-dot { position: absolute; top: 3px; left: 3px; width: 14px; height: 14px; border-radius: 50%; background: var(--text-2); transition: left .15s ease, background-color .15s ease; }
        .stx-cap-toggle.on .stx-cap-toggle-dot { left: 17px; background: var(--on-accent); }

        @media (max-width: 700px) {
          .stx-cap-h1 { font-size: 28px; }
          .stx-cap-hero-value { font-size: 36px; }
          .stx-cap-hero-row { gap: 28px; }
          .stx-cap-table-head, .stx-cap-table-row { grid-template-columns: 1.6fr 70px 70px 100px; gap: 8px; }
          .stx-cap-table-head span:nth-child(3), .stx-cap-table-row span:nth-child(3) { display: none; }
        }

        /* ---- Produtos (/produtos) — composição "Estúdio". Classes
           stx-prod-* exclusivas desta página; o formulário (ProdutoForm)
           não foi tocado — continua com suas próprias classes
           compartilhadas (.stx-form/.stx-input/.stx-etapa-card etc.), só
           o wrapper de lista/cabeçalho mudou. */
        .stx-prod-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }
        .stx-prod-count { font-size: 13px; color: var(--text-2); margin: 0; }
        .stx-prod-h1 { margin: 10px 0 0; font-size: 40px; font-weight: 600; letter-spacing: -0.035em; line-height: 1; color: var(--text); }
        .stx-prod-btn-primary { font-family: var(--font-body); font-size: 13.5px; font-weight: 600; color: var(--on-accent); background: var(--accent); border: none; border-radius: 9px; padding: 11px 17px; cursor: pointer; flex: none; }
        .stx-prod-btn-primary:hover { background: var(--accent-hover); }

        .stx-prod-table-head, .stx-prod-table-row { display: grid; grid-template-columns: 1.8fr 110px 130px 90px 100px 90px; gap: 14px; }
        .stx-prod-table-head { font-size: 12px; color: var(--text-3); padding-bottom: 10px; }
        .stx-prod-table-head .num { text-align: right; }
        .stx-prod-table-row { align-items: center; padding: 14px 0; border-top: 1px solid var(--line); font-size: 14px; color: var(--text); transition: background-color .12s ease-out; }
        .stx-prod-table-row:hover { background: var(--surface-hover); }
        .stx-prod-table-row .num { text-align: right; }
        .stx-prod-nome { margin: 0; }
        .stx-prod-ref { color: var(--label); font-size: 12px; margin-left: 6px; }
        .stx-prod-fluxo { font-size: 12px; color: var(--text-3); margin: 4px 0 0; }
        .stx-prod-actions { display: flex; gap: 4px; justify-content: flex-end; }

        @media (max-width: 900px) {
          .stx-prod-table-head, .stx-prod-table-row { grid-template-columns: 1.6fr 90px 90px 90px; gap: 8px; }
          .stx-prod-table-head span:nth-child(3), .stx-prod-table-row span:nth-child(3) { display: none; }
        }
        @media (max-width: 640px) {
          .stx-prod-table-head { display: none; }
          .stx-prod-table-row { grid-template-columns: 1fr; gap: 6px; padding: 16px 0; }
          .stx-prod-table-row .num { text-align: left; }
          .stx-prod-actions { justify-content: flex-start; margin-top: 4px; }
        }

        /* ---- Sidebar recolhível — novos breakpoints (1024 / 768 / 430),
           substituindo o corte único de 760px que existia só pro shell
           (ver design_handoff_sittech_estudio/README.md, "Breakpoints" e
           "Sidebar recolhível"). Media queries de CONTEÚDO de página em
           760/600/480/720 continuam como estão — fora do escopo desta
           etapa, ver GlobalStyles.tsx mais abaixo. ---- */

        /* Tablet 768–1023: sidebar recolhida por padrão (72px); expandir
           sobrepõe o conteúdo (position:fixed + backdrop) em vez de
           empurrar, pra tabela atrás não refluir. */
        @media (max-width: 1023px) {
          .stx-sidebar:not(.recolhida) {
            position: fixed;
            top: 0;
            left: 0;
            bottom: 0;
            z-index: 220;
            box-shadow: 24px 0 60px -30px rgba(0,0,0,.95);
          }
          .stx-sidebar:not(.recolhida)::after {
            content: "";
            position: fixed;
            inset: 0 0 0 248px;
            background: rgba(12,11,10,.45);
            z-index: -1;
          }
        }

        /* Mobile <768: sidebar vira gaveta — escondida por padrão, some da
           árvore de layout (não ocupa coluna nenhuma) e só aparece como
           overlay quando "gaveta-aberta". */
        @media (max-width: 767px) {
          .stx-topbar-menu-btn { display: flex; }
          .stx-layout { position: relative; }
          .stx-sidebar { display: none; }
          .stx-sidebar.gaveta-aberta {
            display: flex;
            position: fixed;
            top: 0;
            left: 0;
            bottom: 0;
            width: 296px;
            height: 100vh;
            z-index: 320;
            box-shadow: 24px 0 60px -24px rgba(0,0,0,.95);
            padding-top: max(26px, env(safe-area-inset-top));
            padding-bottom: max(22px, env(safe-area-inset-bottom));
          }
          .stx-sidebar-backdrop {
            display: block;
            position: fixed;
            inset: 0;
            background: rgba(12,11,10,.66);
            z-index: 310;
          }
          .stx-sidebar-fechar-gaveta {
            display: flex;
            position: absolute;
            top: 18px;
            right: 18px;
            width: 40px;
            height: 40px;
            border-radius: 12px;
            border: none;
            background: var(--surface);
            color: var(--text-2);
            align-items: center;
            justify-content: center;
            cursor: pointer;
          }
          .stx-content-wrapper { padding: 18px 20px 40px; }
        }

        @media (max-width: 430px) {
          .stx-topbar { flex-wrap: wrap; row-gap: 10px; }
        }

        .stx-month-nav {
          display: flex;
          align-items: center;
          gap: 10px;
          font-family: var(--font-mono);
        }
        .stx-nav-btn {
          background: var(--surface);
          border: 1px solid var(--border);
          color: var(--text);
          width: 30px;
          height: 30px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .stx-nav-btn:hover { background: var(--surface-hover); }
        .stx-month-label {
          font-size: 13px;
          color: var(--text-muted);
          min-width: 130px;
          text-align: center;
        }

        .stx-total-box {
          position: relative;
          padding: 12px 26px;
          border: 1px solid var(--accent);
          border-radius: 6px;
          background: var(--surface);
          box-shadow: 0 2px 8px rgba(0,0,0,0.14);
        }
        .stx-total-icone-alvo {
          position: absolute;
          top: 50%;
          right: 14px;
          transform: translateY(-50%);
          width: 34px;
          height: 34px;
          border-radius: 50%;
          background: rgba(48,176,155,0.16);
          color: var(--accent);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .stx-total-box-com-icone { padding-right: 58px; }
        .stx-total-box::before, .stx-total-box::after {
          content: "";
          position: absolute;
          width: 8px;
          height: 8px;
          border: 1px solid var(--accent);
        }
        .stx-total-box::before { top: -1px; left: -1px; border-right: none; border-bottom: none; }
        .stx-total-box::after { bottom: -1px; right: -1px; border-left: none; border-top: none; }
        .stx-total-label {
          font-family: var(--font-body);
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: var(--text-muted);
          margin: 0;
        }
        .stx-total-value {
          font-family: var(--font-mono);
          font-size: 26px;
          font-weight: 600;
          color: var(--text);
          margin: 2px 0 0 0;
        }
        .stx-total-split {
          font-family: var(--font-body);
          font-size: 11.5px;
          color: var(--text-muted);
          margin: 4px 0 0 0;
        }

        .stx-grid {
          display: grid;
          grid-template-columns: 1.6fr 1fr;
          gap: 20px;
          align-items: start;
        }
        @media (max-width: 720px) {
          .stx-grid { grid-template-columns: 1fr; }
        }

        .stx-panel {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 22px;
          margin-bottom: 20px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08);
        }
        .stx-panel-title-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 4px;
        }
        .stx-panel-title {
          font-family: var(--font-display);
          font-size: 14px;
          font-weight: 600;
          margin: 0;
          color: var(--text);
        }
        .stx-panel-sub {
          font-size: 12px;
          color: var(--text-muted);
          margin: 0 0 14px 0;
        }

        .stx-add-btn {
          font-family: var(--font-body);
          font-weight: 500;
          font-size: 13px;
          background: var(--accent-soft);
          color: var(--accent);
          border: 1px solid var(--accent);
          border-radius: 6px;
          padding: 8px 14px;
          cursor: pointer;
          margin-bottom: 14px;
        }
        .stx-add-btn:hover { background: rgba(48,176,155,0.22); }
        .stx-add-btn.blueprint {
          background: rgba(29,122,104,0.16);
          color: var(--blueprint);
          border-color: var(--blueprint);
        }
        .stx-add-btn.blueprint:hover { background: rgba(29,122,104,0.26); }

        .stx-form {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          margin-bottom: 16px;
          padding: 14px;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 8px;
        }
        .stx-form-full { grid-column: 1 / -1; }
        .stx-label {
          font-size: 12px;
          color: var(--text-muted);
          display: block;
          margin-bottom: 4px;
        }
        .stx-input, .stx-select {
          width: 100%;
          background: var(--surface);
          border: 1px solid var(--border);
          color: var(--text);
          border-radius: 6px;
          padding: 8px 10px;
          font-family: var(--font-body);
          font-size: 13px;
        }
        .stx-input:focus, .stx-select:focus {
          outline: 2px solid var(--blueprint);
          outline-offset: 1px;
        }
        .stx-textarea {
          width: 100%;
          background: var(--bg);
          border: 1px solid var(--border);
          color: var(--text);
          border-radius: 6px;
          padding: 10px;
          font-family: var(--font-mono);
          font-size: 12.5px;
          line-height: 1.6;
          min-height: 140px;
          resize: vertical;
        }
        .stx-textarea:focus {
          outline: 2px solid var(--blueprint);
          outline-offset: 1px;
        }
        .stx-import-formato {
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 10px 12px;
          font-family: var(--font-mono);
          font-size: 11.5px;
          color: var(--text-muted);
          margin: 0 0 12px 0;
          white-space: pre-wrap;
          line-height: 1.6;
        }
        .stx-import-resultado {
          font-size: 12.5px;
          color: var(--blueprint);
          margin: 8px 0 0 0;
        }
        .stx-nova-cat-row {
          display: flex;
          align-items: center;
          gap: 4px;
          margin-top: 6px;
        }
        .stx-form-actions {
          grid-column: 1 / -1;
          display: flex;
          gap: 8px;
          margin-top: 4px;
        }
        .stx-btn-primary, .stx-btn-secondary, .stx-btn-danger {
          font-family: var(--font-body);
          font-size: 13px;
          font-weight: 600;
          border-radius: 6px;
          padding: 9px 18px;
          cursor: pointer;
          border: 1px solid transparent;
          transition: transform 0.08s ease, box-shadow 0.15s ease, background 0.15s ease;
        }
        .stx-btn-primary { background: var(--accent); color: var(--btn-text); box-shadow: 0 1px 3px rgba(0,0,0,0.15); }
        .stx-btn-primary:hover { box-shadow: 0 3px 10px rgba(0,0,0,0.22); transform: translateY(-1px); }
        .stx-btn-secondary { background: transparent; color: var(--text-muted); border-color: var(--border); }
        .stx-btn-danger { background: transparent; color: var(--danger); border-color: var(--danger); }
        .stx-btn-danger:hover { background: rgba(217,83,79,0.12); }
        .stx-btn-danger.solido { background: var(--danger); color: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.15); }
        .stx-btn-danger.solido:hover { box-shadow: 0 3px 10px rgba(0,0,0,0.22); transform: translateY(-1px); }

        .stx-entry {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 11px 0;
          border-bottom: 1px solid var(--border);
          gap: 10px;
        }
        .stx-entry:last-child { border-bottom: none; }
        .stx-entry.paused { opacity: 0.45; }
        .stx-entry-clicavel { cursor: pointer; }
        .stx-entry-clicavel:hover { background: var(--surface-hover); border-radius: 6px; }
        .stx-chevron { color: var(--text-muted); font-size: 10px; margin-left: 4px; }
        .stx-maquina-usos {
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 10px 12px;
          margin: -6px 0 11px 0;
        }
        .stx-entry-desc { font-size: 13px; color: var(--text); margin: 0; }
        .stx-entry-meta {
          font-family: var(--font-body);
          font-size: 12px;
          color: var(--text-muted);
          margin: 2px 0 0 0;
        }
        .stx-entry-aviso-compartilhada {
          font-size: 11.5px;
          color: var(--laranja);
          margin: 3px 0 0 0;
        }
        .stx-badge {
          display: inline-block;
          font-size: 11px;
          padding: 1px 6px;
          border-radius: 3px;
          background: rgba(48,176,155,0.15);
          color: var(--accent);
          margin-left: 6px;
        }
        .stx-badge.blueprint {
          background: rgba(29,122,104,0.16);
          color: var(--blueprint);
        }
        .stx-entry-right {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .stx-entry-value {
          font-family: var(--font-mono);
          font-size: 14px;
          font-weight: 600;
          color: var(--text);
          white-space: nowrap;
        }
        .stx-icon-btn {
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          font-size: 13px;
          padding: 3px 5px;
          white-space: nowrap;
        }
        .stx-icon-btn:hover { color: var(--text); }
        .stx-icon-btn.danger:hover { color: var(--danger); }
        .stx-icon-btn.on { color: var(--blueprint); }

        /* Produção Real — painel de chão de fábrica (tablet) */
        .stx-pr-periodo-banner {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 12px;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 18px 22px;
          margin-bottom: 16px;
        }
        .stx-pr-periodo-nome {
          font-family: var(--font-display);
          font-size: 22px;
          font-weight: 800;
          color: var(--text);
        }
        .stx-pr-periodo-horario {
          font-family: var(--font-mono);
          font-size: 14px;
          color: var(--text-muted);
          margin-left: 10px;
        }
        .stx-pr-progresso {
          font-family: var(--font-mono);
          font-size: 14px;
          font-weight: 600;
          color: var(--text-muted);
        }
        .stx-pr-progresso.completo { color: var(--accent); }
        .stx-pr-completo-banner {
          display: flex;
          align-items: center;
          gap: 8px;
          background: var(--accent-soft);
          color: var(--accent);
          border-radius: 10px;
          padding: 12px 18px;
          font-family: var(--font-body);
          font-size: 14px;
          font-weight: 600;
          margin-bottom: 16px;
        }
        .stx-pr-btn-ocorrencia {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          width: 100%;
          padding: 16px;
          margin-bottom: 20px;
          border-radius: 10px;
          border: none;
          background: var(--danger);
          color: var(--btn-text);
          font-family: var(--font-display);
          font-size: 15px;
          font-weight: 700;
          letter-spacing: 0.4px;
          cursor: pointer;
          transition: opacity 0.15s ease;
        }
        .stx-pr-btn-ocorrencia:hover { opacity: 0.9; }
        .stx-pr-btn-ocorrencia:disabled { cursor: not-allowed; opacity: 0.55; }
        .stx-pr-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
          gap: 14px;
        }
        @media (max-width: 760px) {
          .stx-pr-grid { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); }
        }
        .stx-pr-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 18px;
          min-height: 108px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .stx-pr-card.parada { border-color: var(--danger); box-shadow: 0 0 0 1px var(--danger); }
        .stx-pr-card-nome {
          font-family: var(--font-display);
          font-size: 16px;
          font-weight: 700;
          color: var(--text);
          margin: 0;
        }
        .stx-pr-pill-parada {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          width: fit-content;
          font-family: var(--font-body);
          font-size: 11.5px;
          font-weight: 700;
          letter-spacing: 0.3px;
          color: var(--danger);
          background: rgba(217,83,79,0.14);
          border: none;
          border-radius: 5px;
          padding: 3px 8px;
          margin: 0;
          cursor: pointer;
        }
        .stx-pr-pill-parada:hover { background: rgba(217,83,79,0.24); }
        .stx-pr-linha-estado {
          font-family: var(--font-mono);
          font-size: 13px;
          color: var(--text-muted);
          margin: 0;
        }
        .stx-pr-linha-estado .estado { font-weight: 700; }
        .stx-pr-linha-estado .estado-pendente { color: var(--text-muted); }
        .stx-pr-linha-estado .estado-apontado { color: var(--accent); }
        .stx-pr-linha-estado .estado-sem_producao { color: var(--warning); }
        .stx-pr-card-detalhe {
          font-family: var(--font-body);
          font-size: 12.5px;
          color: var(--text);
          margin: 0;
          opacity: 0.85;
        }
        .stx-pr-card-clicavel { cursor: pointer; transition: transform 0.08s ease, border-color 0.15s ease; }
        .stx-pr-card-clicavel:hover { border-color: var(--accent); transform: translateY(-1px); }
        .stx-pr-card-clicavel:active { transform: translateY(0); }

        .stx-pr-confirmacao-produto {
          font-family: var(--font-body);
          font-size: 14px;
          color: var(--text-muted);
          margin: 0 0 22px 0;
        }
        .stx-pr-performance-label {
          font-family: var(--font-body);
          font-size: 12px;
          letter-spacing: 1px;
          color: var(--text-muted);
          margin: 0;
        }
        .stx-pr-performance-valor {
          font-family: var(--font-display);
          font-size: 48px;
          font-weight: 800;
          color: var(--text);
          margin: 4px 0 26px 0;
        }
        .stx-pr-confirmacao-acoes { display: flex; flex-direction: column; gap: 10px; }
        .stx-pr-escolha-acoes { display: flex; flex-direction: column; gap: 12px; }
        .stx-pr-escolha-acoes .stx-btn-primary, .stx-pr-escolha-acoes .stx-btn-secondary { padding: 20px; }

        /* Outro período / retroativo */
        .stx-pr-retroativo-aviso {
          display: inline-block;
          font-family: var(--font-body);
          font-size: 11.5px;
          font-weight: 700;
          letter-spacing: 0.5px;
          color: var(--laranja);
          background: rgba(224,129,47,0.15);
          border-radius: 5px;
          padding: 4px 10px;
          margin-bottom: 8px;
        }
        .stx-pr-periodo-banner.retroativo { border-color: var(--laranja); }

        /* Produtividade / Paradas / Desvios — filtros "Estúdio" (plano
           contínuo). Únicas páginas que ainda usam .stx-pr-filtros-* depois
           desta etapa (Apontamentos realizados já migrou pra
           .stx-apr-filtros-* própria, arco anterior). */
        .stx-pr-filtros-toggle {
          display: flex;
          align-items: center;
          gap: 5px;
          background: none;
          border: none;
          color: var(--text-2);
          font-family: var(--font-body);
          font-size: 13px;
          cursor: pointer;
          padding: 0;
          margin-bottom: 18px;
        }
        .stx-pr-filtros-toggle:hover { color: var(--text); }
        .stx-pr-filtros-painel { border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); padding: 18px 0; margin-bottom: 20px; }
        .stx-pr-filtros-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 12px 16px;
        }
        @media (max-width: 900px) { .stx-pr-filtros-grid { grid-template-columns: repeat(2, 1fr); } }

        .stx-performance-badge {
          font-family: var(--font-mono);
          font-size: 11px;
          font-weight: 700;
          padding: 3px 9px;
          border-radius: 5px;
          white-space: nowrap;
        }
        .stx-performance-badge.critico { color: var(--danger); background: rgba(217,83,79,0.15); }
        .stx-performance-badge.atencao { color: var(--warning); background: rgba(240,180,41,0.15); }
        .stx-performance-badge.atingido { color: var(--accent); background: var(--accent-soft); }
        .stx-performance-badge.indisponivel { color: var(--text-muted); background: var(--surface-hover); }

        .stx-empty {
          text-align: center;
          padding: 24px 10px;
          color: var(--text-muted);
          font-size: 13px;
        }

        /* Permissões de acesso — form de usuário */
        .stx-permissoes-grupos {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 16px;
          margin-top: 4px;
        }
        .stx-permissoes-grupo-titulo {
          font-family: var(--font-display);
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.4px;
          text-transform: uppercase;
          color: var(--text-muted);
          margin: 0 0 8px 0;
        }
        .stx-permissoes-item {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          color: var(--text);
          padding: 4px 0;
          cursor: pointer;
        }
        .stx-permissoes-item input { cursor: pointer; }

        .stx-cat-row { margin-bottom: 12px; }
        .stx-cat-top {
          display: flex;
          justify-content: space-between;
          font-size: 12px;
          margin-bottom: 4px;
        }
        .stx-cat-name { color: var(--text); }
        .stx-cat-value { font-family: var(--font-mono); color: var(--text-muted); }
        .stx-cat-bar-bg {
          background: var(--bg);
          border-radius: 3px;
          height: 6px;
          overflow: hidden;
        }
        .stx-cat-bar-fill {
          background: var(--blueprint);
          height: 100%;
          border-radius: 3px;
        }

        .stx-analise-capacidade { border-width: 1.5px; }
        .stx-analise-capacidade.ok { border-color: var(--accent); }
        .stx-analise-capacidade.alerta { border-color: var(--danger); }
        .stx-analise-resumo { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 4px; }
        .stx-analise-icone { flex-shrink: 0; width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
        .stx-analise-icone.ok { background: rgba(48,176,155,0.16); color: var(--accent); }
        .stx-analise-icone.alerta { background: rgba(217,83,79,0.16); color: var(--danger); }
        .stx-analise-titulo { font-family: var(--font-display); font-size: 16px; font-weight: 700; margin: 0 0 4px 0; color: var(--text); }
        .stx-analise-sub { font-size: 12.5px; color: var(--text-muted); margin: 0; line-height: 1.5; }
        .stx-analise-secao-titulo { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); margin: 18px 0 10px 0; }
        .stx-analise-maquina-linha { margin-bottom: 14px; }
        .stx-analise-maquina-topo { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 5px; }
        .stx-analise-maquina-nome { font-size: 13px; font-weight: 600; color: var(--text); }
        .stx-analise-pct { font-family: var(--font-mono); font-size: 13px; font-weight: 700; }
        .stx-analise-barra-bg { height: 8px; background: var(--surface-hover); border-radius: 4px; overflow: hidden; }
        .stx-analise-barra-fill { height: 100%; border-radius: 4px; transition: width 0.2s ease; }
        .stx-analise-maquina-detalhe { font-size: 11.5px; color: var(--text-muted); margin: 5px 0 0 0; }
        .stx-status-normal { color: var(--accent); }
        .stx-status-atencao { color: var(--warning); }
        .stx-status-proximo { color: var(--laranja); }
        .stx-status-gargalo { color: var(--danger); }
        .stx-analise-barra-fill.stx-status-normal { background: var(--accent); }
        .stx-analise-barra-fill.stx-status-atencao { background: var(--warning); }
        .stx-analise-barra-fill.stx-status-proximo { background: var(--laranja); }
        .stx-analise-barra-fill.stx-status-gargalo { background: var(--danger); }
        .stx-analise-gargalos { margin-top: 6px; }
        .stx-analise-gargalo-card { background: rgba(217,83,79,0.08); border: 1px solid rgba(217,83,79,0.3); border-radius: 8px; padding: 12px 14px; margin-bottom: 10px; }
        .stx-analise-gargalo-nome { font-size: 13px; font-weight: 700; color: var(--text); margin: 0 0 4px 0; }
        .stx-analise-gargalo-detalhe { font-size: 12px; color: var(--text-muted); margin: 0 0 8px 0; }
        .stx-analise-gargalo-produtos-titulo { font-size: 11px; color: var(--text-muted); margin: 0 0 3px 0; text-transform: uppercase; letter-spacing: 0.03em; }
        .stx-analise-gargalo-produto { font-family: var(--font-mono); font-size: 12px; color: var(--text); margin: 0 0 2px 0; }

        .stx-status-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          width: 100%;
          background: none;
          border: none;
          padding: 0;
          cursor: pointer;
          text-align: left;
          font-family: var(--font-body);
        }
        .stx-status-compacto { font-size: 13px; font-weight: 500; color: var(--text-muted); }
        .stx-status-toggle {
          flex-shrink: 0;
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 12px;
          color: var(--text-muted);
          white-space: nowrap;
          margin-left: 12px;
        }
        .stx-status-detalhes { margin-top: 16px; }

        .stx-produto-programado {
          padding: 14px 0;
          border-bottom: 1px solid var(--border);
        }
        .stx-produto-programado:last-of-type { border-bottom: none; }
        .stx-produto-programado-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 12px;
        }
        @media (max-width: 700px) {
          .stx-produto-programado-grid { grid-template-columns: repeat(2, 1fr); }
        }
        .stx-produto-programado-valor { font-family: var(--font-mono); font-size: 15px; font-weight: 700; color: var(--text); margin: 0; }

        .stx-observacao-card {
          background: rgba(48,176,155,0.08);
          border: 1px solid rgba(48,176,155,0.3);
          border-radius: 8px;
          padding: 12px 14px;
          margin-bottom: 10px;
        }
        .stx-observacao-texto { font-size: 12.5px; color: var(--text); margin: 0; line-height: 1.6; }
        .stx-observacao-texto b { color: var(--accent); }

        .stx-capacidade-reais-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 14px;
          margin: 16px 0 4px 0;
        }
        @media (max-width: 700px) {
          .stx-capacidade-reais-grid { grid-template-columns: repeat(2, 1fr); }
        }
        .stx-capacidade-reais-label { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.03em; margin: 0 0 4px 0; }
        .stx-capacidade-reais-valor { font-family: var(--font-mono); font-size: 17px; font-weight: 700; color: var(--text); margin: 0; }
        .stx-tabela-producao-header, .stx-tabela-producao-linha {
          display: grid;
          grid-template-columns: 2fr 1fr 1fr 1fr;
          gap: 8px;
          font-size: 12.5px;
          padding: 7px 4px;
        }
        .stx-tabela-producao-header { color: var(--text-muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em; border-bottom: 1px solid var(--border); }
        .stx-tabela-producao-linha { border-bottom: 1px solid var(--border); font-family: var(--font-mono); }
        .stx-tabela-producao-linha:last-child { border-bottom: none; }

        .stx-ind-tabela-wrap { overflow-x: auto; }
        .stx-ind-tabela-header, .stx-ind-tabela-linha {
          display: grid;
          gap: 8px;
          font-size: 12.5px;
          padding: 8px 4px;
          white-space: nowrap;
          min-width: 720px;
        }
        .stx-ind-tabela-header { color: var(--text-muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em; border-bottom: 1px solid var(--border); }
        .stx-ind-tabela-linha { border-bottom: 1px solid var(--border); font-family: var(--font-mono); cursor: pointer; }
        .stx-ind-tabela-linha:hover { background: var(--surface-hover); }
        .stx-ind-tabela-linha:last-child { border-bottom: none; }
        .stx-ind-drilldown { padding: 10px 4px 18px 4px; border-bottom: 1px solid var(--border); background: var(--surface-hover); }
        .stx-ind-tabs { display: flex; gap: 6px; flex-wrap: wrap; margin: 20px 0; }
        .stx-ind-tab { font-family: var(--font-body); padding: 8px 14px; border-radius: 999px; border: none; background: var(--pill-bg); color: var(--text-2); font-size: 13px; cursor: pointer; }
        .stx-ind-tab:hover { background: var(--pill-bg-hover); color: var(--text); }
        .stx-ind-tab.active { background: var(--accent); color: var(--on-accent); font-weight: 600; }
        .stx-ind-tab.active:hover { background: var(--accent-hover); }

        .stx-ajustar-box {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          margin-top: 18px;
          padding-top: 16px;
          border-top: 1px solid var(--border);
          flex-wrap: wrap;
        }
        .stx-ajustar-titulo { font-size: 13px; font-weight: 600; color: var(--text); margin: 0 0 2px 0; }
        .stx-modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.6);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 200;
          padding: 20px;
        }
        .stx-modal-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 24px;
          width: 100%;
          max-width: 480px;
          max-height: 85vh;
          overflow-y: auto;
          box-shadow: 0 8px 30px rgba(0,0,0,0.3);
        }
        .stx-modal-titulo { font-family: var(--font-display); font-size: 17px; font-weight: 700; color: var(--text); margin: 0 0 16px 0; }
        .stx-modal-comparativo { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 18px; }
        .stx-reset-senha-box {
          display: flex;
          gap: 8px;
          align-items: center;
          padding: 8px 14px 14px 14px;
          margin-top: -6px;
          margin-bottom: 11px;
        }
        .stx-reset-senha-box .stx-input { flex: 1; }

        .stx-simulacao-faixa {
          background: rgba(127,119,221,0.12);
          border: 1.5px solid #7F77DD;
          border-radius: 10px;
          padding: 14px 18px;
          margin-bottom: 18px;
        }
        .stx-simulacao-titulo { font-size: 13px; font-weight: 700; color: #7F77DD; margin: 0 0 4px 0; }
        .stx-simulacao-sub { font-size: 12px; color: var(--text-muted); margin: 0; }
        .stx-simulacao-lista { margin-top: 14px; display: flex; flex-direction: column; gap: 8px; }
        .stx-simulacao-item { display: flex; align-items: center; gap: 12px; }
        .stx-simulacao-item-nome { flex: 1; font-size: 13px; color: var(--text); }
        .stx-simulacao-input { width: 110px; flex-shrink: 0; }
        .stx-simulacao-item-valor { width: 100px; text-align: right; font-family: var(--font-mono); font-size: 12.5px; color: var(--text-muted); flex-shrink: 0; }
        .stx-simulacao-tag {
          display: inline-block;
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          color: #7F77DD;
          background: rgba(127,119,221,0.15);
          border-radius: 4px;
          padding: 2px 7px;
          margin-left: 8px;
          vertical-align: middle;
        }
        .stx-resumo-ao-vivo {
          background: var(--surface);
          border: 1.5px solid var(--accent);
          border-radius: 8px;
          padding: 10px 12px;
          font-size: 12.5px;
          color: var(--text);
          line-height: 1.5;
        }
        .stx-resumo-ao-vivo b { color: var(--text); }

        .stx-save-error {
          font-size: 12px;
          color: var(--danger);
          margin-top: 10px;
        }

        /* funcionários */
        .stx-func-card {
          padding: 13px 0;
          border-bottom: 1px solid var(--border);
        }
        .stx-func-card:last-child { border-bottom: none; }
        .stx-func-card.paused { opacity: 0.45; }
        .stx-func-top {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 10px;
        }
        .stx-func-nome { font-size: 14px; font-weight: 600; color: var(--text); margin: 0; }
        .stx-func-itens {
          font-family: var(--font-body);
          font-size: 12px;
          color: var(--text-muted);
          margin: 5px 0 0 0;
        }
        .stx-func-rates {
          display: flex;
          gap: 16px;
          margin-top: 8px;
          flex-wrap: wrap;
        }
        .stx-func-rate {
          font-family: var(--font-mono);
        }
        .stx-func-rate-label {
          font-family: var(--font-body);
          font-size: 11.5px;
          font-weight: 600;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.03em;
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .stx-rate-icon { flex-shrink: 0; opacity: 0.8; }
        .stx-indicador-icon { flex-shrink: 0; color: var(--accent); }
        .stx-func-rate-value {
          font-size: 13px;
          color: var(--text);
        }
        .stx-func-rate-value.highlight {
          color: var(--text);
          font-weight: 600;
          font-size: 15px;
        }

        .stx-custos-builder {
          grid-column: 1 / -1;
          border-top: 1px solid var(--border);
          padding-top: 10px;
          margin-top: 4px;
        }
        .stx-custos-builder-title {
          font-size: 12px;
          color: var(--text-muted);
          margin: 0 0 8px 0;
          text-transform: uppercase;
          font-weight: 600;
          letter-spacing: 0.03em;
        }
        .stx-custo-item-row {
          display: grid;
          grid-template-columns: 1fr 120px 24px;
          gap: 6px;
          margin-bottom: 6px;
        }
        .stx-etapa-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 10px;
          margin-bottom: 8px;
        }
        .stx-etapa-row {
          display: grid;
          grid-template-columns: 1fr 24px;
          gap: 6px;
          align-items: center;
        }
        .stx-etapa-sublabel {
          font-size: 11px;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.03em;
          margin: 10px 0 6px 0;
        }
        .stx-etapa-metas {
          display: grid;
          grid-template-columns: repeat(6, 1fr);
          gap: 6px;
        }
        .stx-etapa-meta-campo label {
          display: block;
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--blueprint);
          text-align: center;
          margin-bottom: 2px;
        }
        .stx-etapa-meta-campo .stx-input { padding: 6px 4px; text-align: center; font-size: 12px; }
        .stx-etapa-maquinas {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .stx-maquina-chip {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 12px;
          color: var(--text);
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 20px;
          padding: 4px 10px 4px 8px;
          cursor: pointer;
        }
        .stx-maquina-chip input { cursor: pointer; }
        .stx-periodo-row {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 0;
          border-bottom: 1px solid var(--border);
        }
        .stx-periodo-row:last-child { border-bottom: none; }
        .stx-periodo-nome {
          font-family: var(--font-mono);
          font-weight: 600;
          color: var(--blueprint);
          width: 28px;
          flex-shrink: 0;
        }
        .stx-periodo-row .stx-input { width: 110px; flex-shrink: 0; }
        .stx-periodo-ate { color: var(--text-muted); font-size: 12px; flex-shrink: 0; }
        .stx-periodo-duracao {
          font-family: var(--font-mono);
          font-size: 12px;
          color: var(--text-muted);
          margin-left: auto;
          white-space: nowrap;
        }
        .stx-custos-total {
          font-family: var(--font-mono);
          font-size: 12px;
          color: var(--text-muted);
          margin-top: 6px;
        }
        .stx-custos-total b { color: var(--text); }

        .stx-destaque-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }
        @media (max-width: 480px) {
          .stx-destaque-grid { grid-template-columns: 1fr; }
        }
        .stx-destaque-box {
          position: relative;
          background: var(--bg);
          border: 1px solid var(--accent);
          border-radius: 8px;
          padding: 16px;
          box-shadow: 0 2px 6px rgba(0,0,0,0.1);
        }
        .stx-destaque-com-icone { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
        .stx-destaque-icone {
          flex-shrink: 0;
          width: 38px;
          height: 38px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .stx-destaque-icone.verde { background: rgba(48,176,155,0.16); color: var(--accent); }
        .stx-destaque-icone.vermelho { background: rgba(217,83,79,0.16); color: var(--danger); }
        .stx-destaque-icone.amarelo { background: rgba(240,180,41,0.16); color: var(--warning); }
        .stx-destaque-icone.azul { background: rgba(92,139,160,0.16); color: #5c8ba0; }
        .stx-destaque-icone.roxo { background: rgba(164,92,158,0.16); color: #a45c9e; }
        .stx-destaque-box::before, .stx-destaque-box::after {
          content: "";
          position: absolute;
          width: 8px;
          height: 8px;
          border: 1px solid var(--accent);
        }
        .stx-destaque-box::before { top: -1px; left: -1px; border-right: none; border-bottom: none; }
        .stx-destaque-box::after { bottom: -1px; right: -1px; border-left: none; border-top: none; }
        .stx-destaque-label {
          font-family: var(--font-body);
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: var(--text-muted);
          margin: 0;
        }
        .stx-destaque-value {
          font-family: var(--font-mono);
          font-size: 24px;
          font-weight: 600;
          color: var(--text);
          margin: 4px 0 0 0;
        }
        .stx-destaque-sub {
          font-size: 12px;
          color: var(--text-muted);
          margin: 4px 0 0 0;
        }

        .stx-rateio-line {
          display: flex;
          justify-content: space-between;
          font-size: 12px;
          padding: 7px 0;
          border-bottom: 1px solid var(--border);
        }
        .stx-rateio-line:last-child { border-bottom: none; }
        .stx-rateio-line .l { color: var(--text-muted); display: inline-flex; align-items: center; gap: 7px; }
        .stx-rateio-line .v { font-family: var(--font-mono); color: var(--text); }
        .stx-rateio-highlight .v { color: var(--text); font-weight: 600; }
        .stx-alerta-caixa {
          display: flex;
          align-items: center;
          gap: 8px;
          margin: 12px 0 0 0;
          padding: 10px 12px;
          border-radius: 8px;
          font-size: 12.5px;
          line-height: 1.4;
        }
        .stx-alerta-caixa.ok { background: rgba(48,176,155,0.12); color: var(--accent); }
        .stx-alerta-caixa.alerta { background: rgba(240,180,41,0.12); color: var(--warning); }
        .stx-alerta-caixa svg { flex-shrink: 0; }

        .stx-op-group {
          margin-bottom: 16px;
          padding-bottom: 14px;
          border-bottom: 1px solid var(--border);
        }
        .stx-op-group:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
        .stx-op-group-title {
          font-family: var(--font-body);
          font-size: 12px;
          font-weight: 600;
          color: var(--blueprint);
          text-transform: uppercase;
          letter-spacing: 0.03em;
          margin: 0 0 8px 0;
        }
        .stx-op-summary {
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 8px 10px;
          margin-bottom: 8px;
        }
        .stx-op-summary-item {
          display: flex;
          justify-content: space-between;
          font-size: 12px;
          padding: 3px 0;
        }
        .stx-op-summary-label { color: var(--text-muted); }
        .stx-op-summary-value {
          font-family: var(--font-mono);
          color: var(--text);
        }
        .stx-op-summary-value.highlight {
          color: var(--text);
          font-weight: 600;
        }
        .stx-op-func-line {
          display: flex;
          justify-content: space-between;
          font-size: 12px;
          padding: 3px 0;
        }
        .stx-op-func-line .n { color: var(--text); }
        .stx-op-func-line .v { font-family: var(--font-mono); color: var(--text); }
        .stx-op-func-line.paused { opacity: 0.45; }

        .stx-hist-table { display: flex; flex-direction: column; }
        .stx-hist-row {
          display: grid;
          grid-template-columns: 1.3fr 1fr 1fr 1fr 0.6fr;
          gap: 6px;
          font-size: 11.5px;
          padding: 8px 4px;
          border-bottom: 1px solid var(--border);
          cursor: pointer;
        }
        .stx-hist-row:hover { background: var(--surface-hover); }
        .stx-hist-row:last-child { border-bottom: none; }
        .stx-hist-row.stx-hist-head {
          font-family: var(--font-body);
          text-transform: uppercase;
          letter-spacing: 0.03em;
          font-weight: 600;
          font-size: 11.5px;
          color: var(--text-muted);
          cursor: default;
        }
        .stx-hist-row.stx-hist-head:hover { background: none; }
        .stx-hist-row span:not(:first-child) {
          font-family: var(--font-mono);
          text-align: right;
        }
        .stx-hist-row .positivo { color: var(--blueprint); }
        .stx-hist-row .negativo { color: var(--danger); }

        .stx-bi-stats {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
          gap: 12px;
          margin-bottom: 20px;
        }
        .stx-bi-filtro {
          display: flex;
          flex-wrap: wrap;
          align-items: flex-end;
          gap: 16px;
          margin-bottom: 16px;
        }
        .stx-bi-filtro-modos {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
        }
        .stx-bi-filtro-campos {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }
        .stx-bi-filtro-campos .stx-input { width: 160px; }
        .stx-chart-tooltip {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 8px 10px;
          font-family: var(--font-mono);
          font-size: 12px;
        }
        .stx-chart-tooltip-label {
          margin: 0 0 4px 0;
          color: var(--text-muted);
        }
        .stx-chart-tooltip-item { margin: 0; }

        .stx-legenda-cores {
          display: flex;
          flex-wrap: wrap;
          gap: 14px;
          margin: 10px 0 0 0;
          font-size: 11px;
          color: var(--text-muted);
        }
        .stx-legenda-cores span {
          display: inline-flex;
          align-items: center;
          gap: 5px;
        }
        .stx-legenda-cores i {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          display: inline-block;
        }

        .stx-chart-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 14px;
        }
        .stx-chart-type-toggle {
          display: flex;
          gap: 2px;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 2px;
        }
        .stx-chart-type-toggle button {
          font-family: var(--font-body);
          font-size: 11.5px;
          font-weight: 500;
          background: transparent;
          color: var(--text-muted);
          border: none;
          border-radius: 4px;
          padding: 5px 10px;
          cursor: pointer;
        }
        .stx-chart-type-toggle button.active {
          background: var(--accent-soft);
          color: var(--accent);
        }
        .stx-chart-type-toggle button:hover:not(.active) { color: var(--text); }

        .stx-login-screen {
          min-height: 70vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 40px 20px;
        }
        .stx-login-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 28px;
          width: 100%;
          max-width: 340px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.18);
        }

        /* ---- ajustes gerais pra celular ---- */
        @media (max-width: 600px) {
          .stx-root { padding: 14px; border-radius: 0; }
          .stx-header { gap: 14px; margin-bottom: 18px; padding-bottom: 18px; }
          .stx-header-right { width: 100%; align-items: stretch; }
          .stx-header-right > div { justify-content: flex-end; }
          .stx-total-box { width: 100%; box-sizing: border-box; }
          .stx-title { font-size: 21px; }
          .stx-panel { padding: 15px; border-radius: 10px; }
          .stx-form { grid-template-columns: 1fr; padding: 12px; }
          .stx-custo-item-row { grid-template-columns: 1fr 76px 22px; gap: 4px; }
          .stx-etapa-row { grid-template-columns: 1fr 22px; gap: 4px; }
          .stx-etapa-metas { grid-template-columns: repeat(3, 1fr); }
          .stx-periodo-row { flex-wrap: wrap; }
          .stx-periodo-row .stx-input { width: 100px; }
          .stx-periodo-duracao { margin-left: 0; width: 100%; }
          .stx-month-nav { width: 100%; }
          .stx-month-nav .stx-month-label,
          .stx-month-label { min-width: 0; flex: 1; }
          .stx-bi-filtro-campos { width: 100%; }
          .stx-bi-filtro-campos > div { flex: 1 1 130px; }
          .stx-bi-filtro-campos .stx-input { width: 100%; }
          .stx-entry { flex-wrap: wrap; gap: 6px; }
          .stx-entry-right { width: 100%; justify-content: space-between; }
          .stx-func-top { flex-wrap: wrap; }
          .stx-hist-table { overflow-x: auto; -webkit-overflow-scrolling: touch; }
          .stx-hist-row { font-size: 10.5px; gap: 4px; }
          .stx-destaque-value { font-size: 20px; }
          .stx-total-value { font-size: 22px; }
          .stx-chart-header { flex-direction: column; align-items: flex-start; }
          .stx-chart-type-toggle { align-self: stretch; justify-content: space-between; }
          .stx-op-summary-item { flex-wrap: wrap; }
        }

        /* ---- Sittech Intelligence — painel "Estúdio" (ver
           design_handoff_sittech_estudio §4F). Plano contínuo: sem bolha,
           sem avatar, sem card por mensagem — pergunta pequena, resposta em
           corpo de leitura como protagonista, evidências e trace discretos,
           separados só por espaço e uma hairline entre interações. ---- */
        .stx-intel-backdrop {
          position: fixed;
          inset: 0;
          background: transparent;
          z-index: 300;
        }
        .stx-intel-panel {
          position: fixed;
          top: 0;
          right: 0;
          height: 100vh;
          width: min(440px, 94vw);
          background: var(--plane);
          border-left: none;
          box-shadow: -24px 0 60px -30px rgba(0,0,0,.9);
          z-index: 301;
          display: flex;
          flex-direction: column;
          font-family: var(--font-body);
          color: var(--text);
        }
        .stx-intel-panel:focus { outline: none; }
        @media (max-width: 767px) {
          .stx-intel-panel { width: 100vw; border-left: none; }
        }
        .stx-intel-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 20px 18px 16px 22px;
          flex-shrink: 0;
        }
        .stx-intel-header-marca { display: flex; align-items: center; gap: 11px; }
        .stx-intel-header-ring {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          border: 1px solid rgba(62,207,165,.4);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .stx-intel-header-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: var(--accent);
          animation: stx-sit-pulse 3.4s ease-in-out infinite;
        }
        .stx-intel-header-titulo { font-size: 15px; font-weight: 600; letter-spacing: -0.015em; margin: 0; color: var(--text); }
        .stx-intel-close { background: none; border: none; padding: 6px; color: var(--text-3); cursor: pointer; display: flex; }
        .stx-intel-close:hover { color: var(--text); }
        .stx-intel-body {
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          padding: 6px 22px 0;
          display: flex;
          flex-direction: column;
          gap: 26px;
        }
        .stx-intel-footer { flex-shrink: 0; padding: 18px 22px 22px; }

        /* Estado vazio (§5/§21) — só título, descrição, sugestões, campo. */
        .stx-intel-empty { display: flex; flex-direction: column; justify-content: center; min-height: 100%; padding-bottom: 20px; }
        .stx-intel-empty-titulo { font-size: 20px; font-weight: 600; letter-spacing: -0.025em; color: var(--text); margin: 0 0 8px; }
        .stx-intel-empty-sub { font-size: 13px; color: var(--text-3); line-height: 1.55; margin: 0 0 20px; }
        .stx-intel-suggestions { display: flex; flex-direction: column; gap: 8px; margin-bottom: 24px; }
        .stx-intel-suggestion {
          display: block;
          width: 100%;
          text-align: left;
          font-family: var(--font-body);
          font-size: 13.5px;
          color: var(--text-2);
          background: var(--surface);
          border: none;
          border-radius: 10px;
          padding: 13px 14px;
          cursor: pointer;
          transition: background-color .12s ease-out, color .12s ease-out;
        }
        .stx-intel-suggestion:hover:not(:disabled) { background: var(--surface-hover); color: var(--text); }
        .stx-intel-suggestion:disabled { opacity: 0.5; cursor: not-allowed; }

        /* Follow-ups (§16) — chips inline, menores que as sugestões do
           estado vazio (mesma distinção do mock: pill sobre --pill-bg). */
        .stx-intel-followups { display: flex; flex-wrap: wrap; gap: 8px; }
        .stx-intel-chip {
          font-family: var(--font-body);
          font-size: 12.5px;
          color: var(--text-2);
          background: var(--pill-bg);
          border: none;
          border-radius: 999px;
          padding: 8px 13px;
          cursor: pointer;
          transition: background-color .12s ease-out, color .12s ease-out;
        }
        .stx-intel-chip:hover:not(:disabled) { background: var(--pill-bg-hover); color: var(--text); }
        .stx-intel-chip:disabled { opacity: 0.5; cursor: not-allowed; }

        /* Composer (§6) — pill elegante, botão quadrado-arredondado. */
        .stx-intel-composer {
          display: flex;
          align-items: center;
          gap: 10px;
          background: var(--surface);
          border: none;
          border-radius: 14px;
          padding: 10px 10px 10px 16px;
        }
        .stx-intel-composer-input {
          flex: 1;
          background: transparent;
          border: none;
          color: var(--text);
          font-family: var(--font-body);
          font-size: 14px;
          line-height: 1.5;
          resize: none;
          max-height: 140px;
          padding: 6px 0;
        }
        .stx-intel-composer-input::placeholder { color: var(--label); }
        .stx-intel-composer-input:focus { outline: none; }
        .stx-intel-composer-send {
          flex-shrink: 0;
          width: 34px;
          height: 34px;
          border-radius: 10px;
          border: none;
          background: var(--accent);
          color: var(--on-accent);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: background-color .12s ease-out;
        }
        .stx-intel-composer-send:hover:not(:disabled) { background: var(--accent-hover); }
        .stx-intel-composer-send:disabled { opacity: 0.4; cursor: not-allowed; }
        .stx-intel-composer-hint { font-size: 11.5px; color: var(--faint); margin: 10px 0 0; }

        /* Interação (§7/§20) — pergunta → resposta → evidências → trace,
           separadas da próxima só por espaço + uma hairline. */
        .stx-intel-interaction { display: flex; flex-direction: column; gap: 14px; padding-bottom: 28px; border-bottom: 1px solid var(--line); }
        .stx-intel-interaction:last-child { border-bottom: none; padding-bottom: 0; }
        .stx-intel-pergunta { font-size: 13px; font-weight: 400; color: var(--text-3); margin: 0; line-height: 1.5; }
        .stx-intel-resposta { display: flex; flex-direction: column; gap: 12px; }
        .stx-intel-resposta-paragrafo { font-size: 15.5px; line-height: 1.62; color: var(--text); margin: 0; }
        .stx-intel-resposta-paragrafo strong { color: var(--text); font-weight: 600; }

        /* Loading honesto (§10/§27/§28) — nunca finge progresso. */
        .stx-intel-loading { display: flex; align-items: center; gap: 10px; font-size: 13.5px; color: var(--text-2); padding: 2px 0; }
        .stx-intel-loading-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); flex-shrink: 0; animation: stx-sit-pulse 1.8s ease-in-out infinite; }
        .stx-intel-loading-tempo { color: var(--text-3); }

        /* Erros seguros (§18/§19) — linha de texto, sem caixa. */
        .stx-intel-erro { font-size: 14px; color: var(--danger); margin: 0; line-height: 1.5; }

        /* Evidências (§12/§13/§29) — recolhível via stx-status-header/toggle/
           detalhes já existentes (mesmo padrão do resto do app); aqui só a
           lista vertical sem cartão/borda. */
        .stx-intel-evidence-section { margin-top: 2px; }
        .stx-intel-evidence-grid { display: flex; flex-direction: column; gap: 16px; }
        .stx-intel-evidence-top { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
        .stx-intel-evidence-metric { font-size: 13.5px; color: var(--text-2); margin: 0; }
        .stx-intel-evidence-value { font-size: 14.5px; font-weight: 600; color: var(--text); margin: 0; flex-shrink: 0; }
        .stx-intel-evidence-meta { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 6px; }
        .stx-intel-evidence-meta-left { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; min-width: 0; }
        .stx-intel-confidence { font-size: 12.5px; color: var(--text-3); flex-shrink: 0; }
        .stx-intel-confidence.incerta { color: var(--warning); }
        .stx-intel-evidence-context { font-size: 12.5px; color: var(--text-3); }
        .stx-intel-drilldown-btn {
          flex-shrink: 0;
          background: none;
          border: none;
          color: var(--accent);
          font-family: var(--font-body);
          font-size: 12.5px;
          font-weight: 500;
          cursor: pointer;
          padding: 0;
        }
        .stx-intel-drilldown-btn:hover { text-decoration: underline; }

        /* Tool trace (§15/§30) — linha discreta no pé, mesmo padrão de
           collapse das evidências. */
        .stx-intel-tooltrace { margin-top: 2px; }
        .stx-intel-tooltrace-list { list-style: none; padding: 0; margin: 8px 0 0; display: flex; flex-direction: column; gap: 5px; }
        .stx-intel-tooltrace-item { font-size: 12.5px; color: var(--text-2); }
        .stx-intel-tooltrace-vazio { color: var(--text-3); }

        /* Debug DEV (§25) */
        .stx-intel-debugbar { font-size: 10.5px; color: var(--text-3); opacity: 0.75; margin: 10px 0 0; word-break: break-word; }
    `}</style>
  );
}
