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
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@500;600;700;800&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap');

        .stx-root {
          --bg: ${cores.bg};
          --surface: ${cores.surface};
          --surface-hover: ${cores.surfaceHover};
          --border: ${cores.border};
          --text: ${cores.text};
          --text-muted: ${cores.textMuted};
          --accent: ${cores.accent};
          --accent-soft: ${cores.accentSoft};
          --blueprint: ${cores.blueprint};
          --danger: ${cores.danger};
          --warning: ${cores.warning};
          --laranja: ${cores.laranja};
          --btn-text: ${cores.btnText};
          --font-display: 'Sora', sans-serif;
          --font-body: 'Inter', sans-serif;
          --font-mono: 'JetBrains Mono', monospace;

          background-color: var(--bg);
          color: var(--text);
          font-family: var(--font-body);
          padding: 28px;
          border-radius: 12px;
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
          font-size: 27px;
          font-weight: 700;
          letter-spacing: -0.01em;
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
        .stx-bell-wrap {
          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 34px;
          height: 34px;
          border-radius: 50%;
          border: 1px solid var(--border);
          color: var(--text);
          cursor: default;
        }
        .stx-bell-dot {
          position: absolute;
          top: 6px;
          right: 7px;
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: var(--accent);
          border: 1.5px solid var(--surface);
        }

        .stx-tabs {
          display: flex;
          gap: 6px;
          margin-bottom: 20px;
          flex-wrap: wrap;
        }
        .stx-tab {
          font-family: var(--font-body);
          font-size: 13px;
          font-weight: 500;
          background: var(--surface);
          color: var(--text-muted);
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 8px 16px;
          cursor: pointer;
        }
        .stx-tab.active {
          background: var(--accent-soft);
          color: var(--accent);
          border-color: var(--accent);
        }
        .stx-tab:hover:not(.active) { background: var(--surface-hover); }

        .stx-layout {
          display: flex;
          gap: 0;
          align-items: stretch;
        }
        .stx-sidebar {
          display: flex;
          flex-direction: column;
          gap: 4px;
          width: 220px;
          flex-shrink: 0;
          position: sticky;
          top: 0;
          align-self: flex-start;
          background: transparent;
          border: none;
          border-right: 1px solid var(--border);
          padding: 0 16px 20px 0;
          box-shadow: none;
        }
        .stx-sidebar-logo {
          padding: 4px 0 20px 0;
          margin-bottom: 6px;
          border-bottom: 1px solid var(--border);
        }
        .stx-logo-sidebar { height: 40px; width: auto; display: block; }
        .stx-content-wrapper {
          flex: 1;
          min-width: 0;
          padding-left: 24px;
        }
        .stx-content {
          min-width: 0;
        }
        .stx-tab-v {
          font-family: var(--font-body);
          font-size: 13.5px;
          font-weight: 500;
          background: transparent;
          color: var(--text-muted);
          border: 1px solid transparent;
          border-left: 2px solid transparent;
          border-radius: 6px;
          padding: 10px 14px;
          text-align: left;
          cursor: pointer;
          width: 100%;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .stx-tab-v svg { flex-shrink: 0; opacity: 0.85; }
        .stx-tab-v:hover:not(.active) { background: var(--surface-hover); color: var(--text); }
        .stx-tab-v.active {
          background: var(--accent-soft);
          color: var(--accent);
          border-left: 2px solid var(--accent);
          font-weight: 600;
        }
        .stx-tab-v.active svg { opacity: 1; }
        .stx-tab-v-muted { color: var(--text-muted); opacity: 0.8; }
        .stx-sidebar-group {
          font-family: var(--font-mono);
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--text-muted);
          margin: 14px 0 4px 14px;
        }
        .stx-sidebar-group:first-child { margin-top: 4px; }
        .stx-sidebar-grupo-header {
          display: flex;
          align-items: center;
          gap: 6px;
          width: 100%;
          background: transparent;
          border: none;
          cursor: pointer;
          font-family: var(--font-mono);
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--text-muted);
          padding: 10px 8px 4px 8px;
          text-align: left;
        }
        .stx-sidebar-grupo-header:hover { color: var(--text); }
        .stx-sidebar-grupo-header svg { flex-shrink: 0; opacity: 0.7; }
        .stx-sidebar-divider {
          height: 1px;
          background: var(--border);
          margin: 12px 8px;
        }
        .stx-sidebar-meta-card {
          margin: 14px 8px 4px 8px;
          padding: 14px;
          border-radius: 8px;
          border: 1.5px solid var(--accent);
          background: var(--accent-soft);
          cursor: pointer;
        }
        .stx-sidebar-meta-titulo {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11.5px;
          font-weight: 600;
          color: var(--accent);
          text-transform: uppercase;
          letter-spacing: 0.03em;
          margin: 0 0 6px 0;
        }
        .stx-sidebar-meta-valor {
          font-family: var(--font-mono);
          font-size: 19px;
          font-weight: 700;
          color: var(--accent);
          margin: 0;
        }
        .stx-sidebar-meta-sub { font-size: 10.5px; color: var(--text-muted); margin: 4px 0 0 0; }

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
        @media (max-width: 760px) {
          .stx-layout { flex-direction: column; }
          .stx-sidebar {
            flex-direction: row;
            width: 100%;
            overflow-x: auto;
            position: static;
            gap: 6px;
            border-right: none;
            border-bottom: 1px solid var(--border);
            padding: 0 0 10px 0;
          }
          .stx-sidebar-logo { display: none; }
          .stx-sidebar-meta-card { display: none; }
          .stx-content-wrapper { padding-left: 0; }
          .stx-tab-v { width: auto; white-space: nowrap; border-left: none; border-bottom: 2px solid transparent; }
          .stx-tab-v.active { border-left: none; border-bottom: 2px solid var(--accent); }
          .stx-sidebar-group { display: none; }
          .stx-sidebar-grupo-header { display: none; }
          .stx-sidebar-divider { display: none; }
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
        .stx-btn-primary, .stx-btn-secondary {
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

        /* Formulário de apontamento — versão touch dos campos/botões padrão */
        .stx-pr-modal { max-width: 560px; }
        .stx-pr-modal .stx-select, .stx-pr-modal .stx-input { padding: 14px 12px; font-size: 16px; }
        .stx-pr-modal .stx-btn-primary, .stx-pr-modal .stx-btn-secondary { width: 100%; padding: 16px; font-size: 16px; }
        .stx-pr-modal .stx-form-actions { gap: 10px; }
        .stx-pr-confirmacao { text-align: center; padding: 12px 0; }
        .stx-pr-confirmacao-check {
          font-family: var(--font-display);
          font-size: 19px;
          font-weight: 700;
          color: var(--accent);
          margin: 0 0 6px 0;
        }
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
        .stx-pr-motivos-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          margin-top: 8px;
        }
        .stx-pr-motivo-btn {
          background: var(--surface);
          border: 1px solid var(--border);
          color: var(--text);
          border-radius: 8px;
          padding: 16px 10px;
          font-family: var(--font-body);
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          text-align: center;
          transition: border-color 0.15s ease, background 0.15s ease;
        }
        .stx-pr-motivo-btn:hover { border-color: var(--accent); }
        .stx-pr-motivo-btn.selecionado { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
        .stx-pr-motivo-btn:last-child:nth-child(odd) { grid-column: 1 / -1; }

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

        /* Apontamentos realizados — filtros */
        .stx-pr-filtros-toggle {
          display: flex;
          align-items: center;
          gap: 6px;
          background: none;
          border: none;
          color: var(--text-muted);
          font-family: var(--font-body);
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          padding: 8px 0;
          margin-bottom: 4px;
        }
        .stx-pr-filtros-toggle:hover { color: var(--text); }
        .stx-pr-filtros-painel { margin-bottom: 16px; }
        .stx-pr-filtros-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
          gap: 12px;
        }

        /* Apontamentos realizados — lista */
        .stx-pr-lista-realizados { display: flex; flex-direction: column; gap: 8px; }
        .stx-pr-linha-realizado {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 14px 16px;
          cursor: pointer;
          transition: border-color 0.15s ease;
        }
        .stx-pr-linha-realizado:hover { border-color: var(--accent); }
        .stx-pr-linha-realizado-topo {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }
        .stx-pr-linha-realizado-data {
          font-family: var(--font-mono);
          font-size: 13px;
          color: var(--text);
          font-weight: 600;
        }
        .stx-pr-linha-realizado-detalhe {
          font-family: var(--font-body);
          font-size: 12.5px;
          color: var(--text-muted);
          margin: 6px 0 0 0;
        }
        .stx-pr-pill-status {
          font-family: var(--font-body);
          font-size: 11px;
          font-weight: 700;
          padding: 3px 9px;
          border-radius: 5px;
          white-space: nowrap;
        }
        .stx-pr-pill-status.estado-produzindo { color: var(--accent); background: var(--accent-soft); }
        .stx-pr-pill-status.estado-sem_producao { color: var(--warning); background: rgba(240,180,41,0.15); }

        /* Resumo do apontamento */
        .stx-pr-resumo-linhas { display: flex; flex-direction: column; gap: 10px; margin-bottom: 4px; }
        .stx-pr-resumo-linha {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          font-family: var(--font-body);
          font-size: 13px;
          border-bottom: 1px solid var(--border);
          padding-bottom: 8px;
        }
        .stx-pr-resumo-linha span { color: var(--text-muted); }
        .stx-pr-resumo-linha b { color: var(--text); text-align: right; font-weight: 600; }

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
        .stx-uso-leitura {
          font-size: 11.5px;
          color: var(--text-muted);
          margin: 6px 0 0 0;
        }
        .stx-uso-leitura-dias {
          color: var(--blueprint);
          font-weight: 500;
          margin-bottom: 4px;
        }
        .stx-resumo-panel { border-color: var(--accent); }

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
        .stx-resumo-linha {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          font-size: 13px;
          color: var(--text);
          margin: 0 0 10px 0;
          line-height: 1.5;
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
        .stx-resumo-linha:last-child { margin-bottom: 0; }
        .stx-resumo-icone {
          flex-shrink: 0;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          background: var(--surface-hover);
          color: var(--text-muted);
        }
        .stx-resumo-icone.on { background: rgba(29,122,104,0.20); color: var(--blueprint); }
        .stx-resumo-icone.danger { background: rgba(217,83,79,0.15); color: var(--danger); }

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
    `}</style>
  );
}
