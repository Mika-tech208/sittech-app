// Estilos da Escala de Produção (prefixo stx-esc-) — locais ao módulo para
// não tocar no GlobalStyles compartilhado. Usam as variáveis de tema já
// definidas em :root (--bg, --text, --border, ...).
export const ESTILOS_ESCALA = `
.stx-esc-nav { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:14px; }
.stx-esc-pill { border:1px solid var(--border); background:var(--panel, transparent); color:var(--text); border-radius:999px; padding:6px 12px; font-size:13px; cursor:pointer; }
.stx-esc-pill.ativo { background:var(--accent); color:#0b0b0b; border-color:var(--accent); font-weight:600; }
.stx-esc-pill:disabled { opacity:.5; cursor:not-allowed; }
.stx-esc-banner { border:1px solid var(--warning); background:rgba(224,163,46,.10); color:var(--text); border-radius:12px; padding:10px 14px; margin:10px 0; font-size:13px; }
.stx-esc-banner.erro { border-color:var(--danger); background:rgba(217,83,79,.10); }
.stx-esc-banner.info { border-color:var(--border); background:transparent; color:var(--text-muted); }
.stx-esc-status { color:var(--text-muted); font-size:12px; margin:4px 0 12px; }
.stx-esc-scroll { overflow-x:auto; border:1px solid var(--border); border-radius:12px; }
.stx-esc-tabela { border-collapse:separate; border-spacing:0; width:100%; min-width:760px; }
.stx-esc-tabela th, .stx-esc-tabela td { border-bottom:1px solid var(--border); border-right:1px solid var(--border); padding:6px 8px; vertical-align:top; font-size:12px; }
.stx-esc-tabela th { position:sticky; top:0; background:var(--panel, var(--bg)); text-align:left; font-weight:600; }
.stx-esc-tabela th.colf, .stx-esc-tabela td.colf { position:sticky; left:0; background:var(--panel, var(--bg)); min-width:130px; z-index:1; font-weight:600; }
.stx-esc-cell { min-height:46px; border-radius:8px; padding:4px 6px; }
.stx-esc-cell.futuro { cursor:pointer; }
.stx-esc-cell.futuro:hover { outline:1px solid var(--accent); }
.stx-esc-cell.atual { background:rgba(80,200,150,.10); outline:1px solid var(--accent); }
.stx-esc-cell.passado { opacity:.55; }
.stx-esc-cell .maq { font-weight:600; font-size:12px; }
.stx-esc-cell .det { color:var(--text-muted); font-size:11px; }
.stx-esc-cell .sem { color:var(--text-muted); font-style:italic; font-size:11px; }
.stx-esc-badge { display:inline-block; border-radius:6px; padding:0 5px; font-size:10px; margin-right:4px; border:1px solid var(--border); }
.stx-esc-badge.exc { border-color:var(--warning); color:var(--warning); }
.stx-esc-badge.man { border-color:var(--accent); color:var(--accent); }
.stx-esc-painel { border:1px solid var(--border); border-radius:12px; padding:14px; margin-top:16px; }
.stx-esc-painel h2 { font-size:15px; margin:0 0 8px; }
.stx-esc-lista { display:flex; flex-direction:column; gap:6px; }
.stx-esc-linha { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; font-size:13px; border-bottom:1px dashed var(--border); padding:6px 0; }
.stx-esc-linha:last-child { border-bottom:none; }
.stx-esc-muted { color:var(--text-muted); font-size:12px; }
.stx-esc-modal-bg { position:fixed; inset:0; background:rgba(0,0,0,.55); display:flex; align-items:center; justify-content:center; z-index:50; padding:16px; }
.stx-esc-modal { background:var(--panel, var(--bg)); border:1px solid var(--border); border-radius:14px; padding:18px; width:min(420px,100%); max-height:90vh; overflow:auto; }
.stx-esc-modal h3 { margin:0 0 10px; font-size:16px; }
.stx-esc-campo { display:flex; flex-direction:column; gap:4px; margin:10px 0; font-size:12px; }
.stx-esc-campo select, .stx-esc-campo input { background:var(--bg); color:var(--text); border:1px solid var(--border); border-radius:8px; padding:8px; font-size:14px; }
.stx-esc-acoes { display:flex; gap:8px; justify-content:flex-end; margin-top:14px; flex-wrap:wrap; }
.stx-esc-btn { border:1px solid var(--border); background:transparent; color:var(--text); border-radius:10px; padding:8px 14px; cursor:pointer; font-size:13px; }
.stx-esc-btn.primario { background:var(--accent); color:#0b0b0b; border-color:var(--accent); font-weight:600; }
.stx-esc-btn:disabled { opacity:.5; cursor:not-allowed; }
.stx-esc-resumo-periodo { color:var(--text-muted); font-size:11px; }
`;
