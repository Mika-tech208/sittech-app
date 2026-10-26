"use client";

// Aba RELATÓRIOS: arquivo histórico dos relatórios semanais. Só lê `escala_relatorios` (nunca gera PDF para listar); o download entrega o PDF ARMAZENADO (a rota confere o SHA-256).
// Primeira seção: RELATÓRIOS DE REVEZAMENTO (a tela é estruturada em seções para receber outras categorias no futuro). Permissão: escala_relatorios (admin sempre).
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthSession } from "@/hooks/useAuthSession";
import { useSidebarState } from "@/hooks/useSidebarState";
import { useMetaSemanalShell } from "@/hooks/useMetaSemanalShell";
import { useTema } from "@/hooks/useTema";
import LoginScreen from "@/components/shell/LoginScreen";
import RecoveryPasswordScreen from "@/components/shell/RecoveryPasswordScreen";
import Sidebar from "@/components/shell/Sidebar";
import TopBarActions from "@/components/shell/TopBarActions";
import AccountModal from "@/components/shell/AccountModal";
import AcessoNegado from "@/components/shell/AcessoNegado";
import GlobalStyles from "@/components/shell/GlobalStyles";
import { THEMES } from "@/lib/constants";
import { temPermissao } from "@/lib/permissoes";
import { formatBRL, setModoPrivadoAtivo } from "@/lib/format";
import { baixarPdfArquivado, buscarArquivo, buscarVersoes, gerarNovaVersao } from "@/features/escala/relatoriosApi";
import { modeloLinha, SECOES, TAMANHO_PAGINA, type Arquivo, type FiltrosArquivo, type ItemArquivo, type LinhaModelo, type StatusRelatorio, type TipoRelatorio } from "./arquivo";
import { ESTILOS_RELATORIOS } from "./estilos";
import ListaArquivo, { chaveFamilia, type VersoesAbertas } from "./ListaArquivo";

const TIPOS: { v: TipoRelatorio | ""; r: string }[] = [{ v: "", r: "Todos" }, { v: "executada", r: "Executado" }, { v: "planejada", r: "Planejado" }];
const STATUS: { v: StatusRelatorio | ""; r: string }[] = [{ v: "", r: "Todos" }, { v: "final", r: "FINAL" }, { v: "parcial", r: "PARCIAL" }];

export default function RelatoriosPage() {
  const router = useRouter();
  const [tema, setTema] = useTema();
  const cores = THEMES[tema];
  const [modoPrivado, setModoPrivado] = useState(false);
  const shell = useSidebarState("relatorios");
  const auth = useAuthSession();
  const meta = useMetaSemanalShell(auth.autenticado);
  const permitido = temPermissao(auth.usuarioLogado, "escala_relatorios");

  const [filtros, setFiltros] = useState<FiltrosArquivo>({ ano: null, tipo: "", status: "", busca: "", pagina: 1 });
  const [buscaDigitada, setBuscaDigitada] = useState("");
  const [arquivo, setArquivo] = useState<Arquivo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [abertas, setAbertas] = useState<VersoesAbertas>({});

  // a busca só aplica depois de uma pausa na digitação
  useEffect(() => {
    const t = setTimeout(() => setFiltros((f) => (f.busca === buscaDigitada ? f : { ...f, busca: buscaDigitada, pagina: 1 })), 300);
    return () => clearTimeout(t);
  }, [buscaDigitada]);

  const consultar = auth.autenticado && permitido;
  useEffect(() => {
    if (!consultar) return;
    let vivo = true;
    void (async () => {
      const r = await buscarArquivo(filtros);
      if (!vivo) return;
      if (r.ok) { setErro(null); setArquivo(r.dados); } else setErro(r.erro);
    })();
    return () => { vivo = false; };
  }, [consultar, filtros, recarga]);

  async function alternarVersoes(l: LinhaModelo) {
    const k = chaveFamilia(l);
    if (abertas[k]) { setAbertas((a) => { const n = { ...a }; delete n[k]; return n; }); return; }
    setAbertas((a) => ({ ...a, [k]: "carregando" }));
    const r = await buscarVersoes(l.semanaInicio, l.tipoChave);
    setAbertas((a) => ({ ...a, [k]: r.ok ? r.versoes : [] }));
    if (!r.ok) setErro(r.erro);
  }
  async function baixar(id: string, nome: string) {
    setErro(null);
    const e = await baixarPdfArquivado(id, nome);
    if (e) setErro(e);
  }
  async function gerarNova(l: LinhaModelo) {
    if (!window.confirm(`Gerar uma NOVA versão do relatório ${l.tipo.toLowerCase()} de ${l.semana}? A ${l.versao} atual não é alterada.`)) return;
    setOcupado(l.id); setErro(null); setAviso(null);
    const r = await gerarNovaVersao(l.semanaInicio, l.tipoChave);
    setOcupado(null);
    if (!r.ok) { setErro(r.erro); return; }
    setAviso(`Nova versão v${r.versao} gerada.`);
    setAbertas({});
    setRecarga((n) => n + 1);
    const e = await baixarPdfArquivado(r.id, r.nomeArquivo);
    if (e) setErro(e);
  }

  if (auth.emModoRecovery) {
    return (
      <div className="stx-root">
        <GlobalStyles cores={cores} />
        <RecoveryPasswordScreen
          tema={tema}
          novaSenha={auth.novaSenhaRecovery} setNovaSenha={auth.setNovaSenhaRecovery}
          confirmarSenha={auth.confirmarSenhaRecovery} setConfirmarSenha={auth.setConfirmarSenhaRecovery}
          mensagem={auth.recoveryMsg} salvando={auth.recoverySalvando} sucesso={auth.recoverySucesso}
          onSubmit={auth.definirNovaSenhaRecovery} onContinuar={auth.concluirRecovery}
        />
      </div>
    );
  }
  if (meta.loading || auth.restaurandoSessao || !auth.autenticado) {
    return (
      <div className="stx-root">
        <GlobalStyles cores={cores} />
        <LoginScreen
          loading={auth.restaurandoSessao || (auth.autenticado && meta.loading)}
          tema={tema}
          loginUsuario={auth.loginUsuario} setLoginUsuario={auth.setLoginUsuario}
          loginSenha={auth.loginSenha} setLoginSenha={auth.setLoginSenha}
          loginErro={auth.loginErro} loginCarregando={auth.loginCarregando}
          onSubmit={auth.handleLogin} campoLogin="email"
        />
      </div>
    );
  }

  const sidebar = (
    <Sidebar
      tema={tema}
      abaAtiva="relatorios"
      onNavigateTab={(key) => { router.push(`/?aba=${key}`); }}
      gruposAbertos={shell.gruposAbertos}
      toggleGrupo={shell.toggleGrupo}
      usuarioLogado={auth.usuarioLogado}
      metaSemanalUsaPrevisto={meta.metaSemanalUsaPrevisto}
      metaInvalida={meta.metaInvalida}
      metaSemanalFinal={meta.metaSemanalFinal}
      formatBRL={formatBRL}
      onMetaClick={() => { router.push("/"); }}
      onAbrirMinhaConta={auth.abrirMinhaConta}
      onSair={() => auth.handleLogout()}
      recolhida={shell.recolhida}
      onToggleRecolhida={shell.toggleRecolhida}
      gavetaAberta={shell.gavetaAberta}
      onFecharGaveta={shell.fecharGaveta}
    />
  );
  if (!permitido) {
    return (
      <div className="stx-root">
        <GlobalStyles cores={cores} />
        <div className="stx-layout">{sidebar}<AcessoNegado /></div>
      </div>
    );
  }

  const linhas = (arquivo?.itens ?? []).map((i: ItemArquivo) => modeloLinha(i, permitido));
  const total = arquivo?.total ?? 0;
  const pagina = filtros.pagina ?? 1;
  const ultimaPagina = Math.max(1, Math.ceil(total / TAMANHO_PAGINA));

  return (
    <div className="stx-root">
      <GlobalStyles cores={cores} />
      <style>{ESTILOS_RELATORIOS}</style>
      <div className="stx-layout">
        {sidebar}
        <div className="stx-content-wrapper">
          <TopBarActions
            modoPrivado={modoPrivado} onToggleModoPrivado={() => { const n = !modoPrivado; setModoPrivadoAtivo(n); setModoPrivado(n); }}
            tema={tema} onToggleTema={() => setTema((t) => (t === "dark" ? "light" : "dark"))}
            usuarioLogado={auth.usuarioLogado} abaAtiva="relatorios" onAbrirMenu={shell.abrirGaveta}
          />
          <div className="stx-header"><div><h1 className="stx-title">Relatórios</h1></div></div>

          {SECOES.map((sec) => (
            <section className="stx-rel-secao" key={sec.chave} aria-label={sec.titulo}>
              <h2>{sec.titulo}</h2>
              <div className="stx-rel-filtros">
                <label>Ano
                  <select value={filtros.ano ?? ""} onChange={(e) => setFiltros({ ...filtros, ano: e.target.value ? Number(e.target.value) : null, pagina: 1 })}>
                    <option value="">Todos</option>
                    {(arquivo?.anos ?? []).map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </label>
                <label>Tipo
                  <select value={filtros.tipo ?? ""} onChange={(e) => setFiltros({ ...filtros, tipo: e.target.value as TipoRelatorio | "", pagina: 1 })}>
                    {TIPOS.map((t) => <option key={t.v} value={t.v}>{t.r}</option>)}
                  </select>
                </label>
                <label>Status
                  <select value={filtros.status ?? ""} onChange={(e) => setFiltros({ ...filtros, status: e.target.value as StatusRelatorio | "", pagina: 1 })}>
                    {STATUS.map((s) => <option key={s.v} value={s.v}>{s.r}</option>)}
                  </select>
                </label>
                <label className="busca">Buscar (código ou semana)
                  <input type="search" value={buscaDigitada} placeholder="ESC-EXEC-2026-44 ou 26/10/2026" onChange={(e) => setBuscaDigitada(e.target.value)} />
                </label>
              </div>

              {aviso && <div className="stx-esc-banner info">{aviso}</div>}
              {erro && <div className="stx-esc-banner erro">{erro}</div>}
              {!arquivo && !erro && <div className="stx-empty">Carregando…</div>}
              {arquivo && linhas.length === 0 && <div className="stx-empty">Nenhum relatório encontrado.</div>}

              {linhas.length > 0 && (
                <>
                  <ListaArquivo linhas={linhas} abertas={abertas} ocupado={ocupado} onBaixar={(id, nome) => void baixar(id, nome)} onVersoes={(l) => void alternarVersoes(l)} onGerarNova={(l) => void gerarNova(l)} />

                  <div className="stx-rel-paginacao">
                    <span>{total} relatório(s) · página {pagina} de {ultimaPagina}</span>
                    <button type="button" className="stx-esc-btn" disabled={pagina <= 1} onClick={() => setFiltros({ ...filtros, pagina: pagina - 1 })}>‹ Anterior</button>
                    <button type="button" className="stx-esc-btn" disabled={pagina >= ultimaPagina} onClick={() => setFiltros({ ...filtros, pagina: pagina + 1 })}>Próxima ›</button>
                  </div>
                </>
              )}
            </section>
          ))}
        </div>
      </div>
      <AccountModal
        usuarioLogado={auth.usuarioLogado}
        aberta={auth.minhaContaAberta}
        onFechar={() => auth.setMinhaContaAberta(false)}
        minhaSenhaAtual={auth.minhaSenhaAtual} setMinhaSenhaAtual={auth.setMinhaSenhaAtual}
        minhaSenhaNova={auth.minhaSenhaNova} setMinhaSenhaNova={auth.setMinhaSenhaNova}
        minhaSenhaConfirma={auth.minhaSenhaConfirma} setMinhaSenhaConfirma={auth.setMinhaSenhaConfirma}
        minhaContaMsg={auth.minhaContaMsg} onSalvar={auth.alterarMinhaSenha}
      />
    </div>
  );
}
