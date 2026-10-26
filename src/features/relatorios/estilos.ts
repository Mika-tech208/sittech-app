// Estilos da aba Relatórios (prefixo stx-rel-) — locais ao módulo; usam as variáveis de tema já definidas em :root.
export const ESTILOS_RELATORIOS = `
.stx-rel-secao { margin-top:14px; }
.stx-rel-secao h2 { font-size:13px; letter-spacing:.06em; margin:0 0 10px; color:var(--text-muted); }
.stx-rel-filtros { display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end; margin-bottom:12px; }
.stx-rel-filtros label { display:flex; flex-direction:column; gap:4px; font-size:11px; color:var(--text-muted); }
.stx-rel-filtros select, .stx-rel-filtros input { background:var(--bg); color:var(--text); border:1px solid var(--border); border-radius:8px; padding:8px 10px; font-size:13px; min-width:120px; }
.stx-rel-filtros input { min-width:200px; }
.stx-rel-scroll { overflow-x:auto; border:1px solid var(--border); border-radius:12px; }
.stx-rel-tabela { width:100%; border-collapse:collapse; min-width:980px; }
.stx-rel-tabela th, .stx-rel-tabela td { text-align:left; padding:10px 12px; border-bottom:1px solid var(--border); font-size:13px; vertical-align:top; }
.stx-rel-tabela th { font-size:11px; color:var(--text-muted); font-weight:600; letter-spacing:.04em; white-space:nowrap; }
.stx-rel-tabela tr:last-child td { border-bottom:none; }
.stx-rel-badge { display:inline-block; border:1px solid var(--border); border-radius:6px; padding:1px 7px; font-size:11px; letter-spacing:.03em; }
.stx-rel-badge.principal { border-color:var(--accent); color:var(--accent); font-weight:600; }
.stx-rel-badge.final { border-color:var(--accent); color:var(--accent); }
.stx-rel-discreto { display:block; color:var(--text-muted); font-size:11px; margin-top:2px; }
.stx-rel-alerta { color:var(--warning); font-size:12px; }
.stx-rel-acoes { display:flex; gap:6px; flex-wrap:wrap; }
.stx-rel-acoes button, .stx-rel-acoes a { font-size:12px; padding:5px 10px; border-radius:8px; border:1px solid var(--border); background:transparent; color:var(--text); text-decoration:none; cursor:pointer; display:inline-flex; align-items:center; }
.stx-rel-acoes .primaria { background:var(--accent); color:#0b0b0b; border-color:var(--accent); font-weight:600; }
.stx-rel-acoes button:disabled { opacity:.5; cursor:not-allowed; }
.stx-rel-versoes { background:rgba(128,128,128,.06); }
.stx-rel-versoes-lista { display:flex; flex-direction:column; gap:6px; padding:4px 0; }
.stx-rel-versao { display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; align-items:center; font-size:12px; border-bottom:1px dashed var(--border); padding:6px 0; }
.stx-rel-versao:last-child { border-bottom:none; }
.stx-rel-cards { display:none; }
.stx-rel-card { border:1px solid var(--border); border-radius:12px; padding:12px; display:flex; flex-direction:column; gap:6px; font-size:13px; }
.stx-rel-card .linha { display:flex; justify-content:space-between; gap:8px; }
.stx-rel-card .rot { color:var(--text-muted); font-size:11px; }
.stx-rel-paginacao { display:flex; gap:10px; align-items:center; justify-content:flex-end; margin-top:12px; font-size:12px; color:var(--text-muted); }
@media (max-width: 760px) {
  .stx-rel-scroll { display:none; }
  .stx-rel-cards { display:flex; flex-direction:column; gap:10px; }
  .stx-rel-filtros select, .stx-rel-filtros input { min-width:0; width:100%; }
  .stx-rel-filtros label { flex:1 1 45%; }
  .stx-rel-filtros label.busca { flex:1 1 100%; }
}
`;
