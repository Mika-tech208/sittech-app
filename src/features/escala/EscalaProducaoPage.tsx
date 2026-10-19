"use client";

// Escala de Produção — tela da supervisão. Mostra a escala gerada no
// servidor (funcionário × período), alertas gerenciais, troca manual de
// funcionários em períodos futuros e indisponibilidade de recursos. A tela
// NÃO calcula escala: gerar/recalcular acontece em /api/escala/*.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthSession } from "@/hooks/useAuthSession";
import { useSidebarState } from "@/hooks/useSidebarState";
import { useMetaSemanalShell } from "@/hooks/useMetaSemanalShell";
import { useEscalaProducao } from "@/hooks/useEscalaProducao";
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
import { mondayOf, shiftWeek, toISODate, weekLabel, formatarDataHoraBR } from "@/lib/date";
import { AVISO_PRIMEIRA_GERACAO } from "@/features/escala/types";
import GradeEscala from "./components/GradeEscala";
import AlertasEscala from "./components/AlertasEscala";
import { BloquearModal, TrocaModal, MOTIVOS_INDISPONIBILIDADE } from "./components/ModaisEscala";
import { ESTILOS_ESCALA } from "./components/estilos";

function rotuloDia(data: string): string {
  return new Date(data + "T00:00:00").toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });
}

export default function EscalaProducaoPage() {
  const router = useRouter();
  const [tema, setTema] = useState<"dark" | "light">("dark");
  const cores = THEMES[tema];
  const [modoPrivado, setModoPrivado] = useState(false);
  function toggleModoPrivado() {
    const next = !modoPrivado;
    setModoPrivadoAtivo(next);
    setModoPrivado(next);
  }
  const shell = useSidebarState("escalaProducao");
  const auth = useAuthSession();
  const meta = useMetaSemanalShell(auth.autenticado);

  const [semana, setSemana] = useState(() => toISODate(mondayOf(new Date())));
  const podeOperar = temPermissao(auth.usuarioLogado, "escala_producao");
  const escala = useEscalaProducao(auth.autenticado && podeOperar, semana);
  const { estado } = escala;

  // Ao abrir a tela, retoma eventos pendentes/falhados (retry simples). O
  // recálculo NÃO depende desta tela: ela só ajuda a drenar a fila.
  const pendentes = estado.eventosPendentes + estado.eventosComErro;
  const [drenou, setDrenou] = useState(false);
  useEffect(() => {
    if (!drenou && !escala.loading && pendentes > 0) {
      setDrenou(true);
      escala.processarPendentes();
    }
  }, [drenou, escala, pendentes]);

  const [diaSel, setDiaSel] = useState<string | null>(null);
  const [agoraMs, setAgoraMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAgoraMs(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const [mensagem, setMensagem] = useState<{ tipo: "ok" | "erro" | "info"; texto: string } | null>(null);
  const [edicao, setEdicao] = useState<{ data: string; periodoId: string; funcionarioId: string } | null>(null);
  const [erroModal, setErroModal] = useState<string | null>(null);
  const [bloqueando, setBloqueando] = useState<string | null>(null);

  const diaAtual = useMemo(() => estado.dias.find((d) => d.data === diaSel) ?? estado.dias.find((d) => d.data >= toISODate(new Date())) ?? estado.dias[0] ?? null, [estado.dias, diaSel]);
  const funcionariosOrdenados = useMemo(() => {
    const ids = [...new Set(estado.alocacoes.map((a) => a.funcionarioId))];
    return ids.sort((a, b) => (estado.nomes.funcionarios.get(a) || "").localeCompare(estado.nomes.funcionarios.get(b) || "", "pt-BR"));
  }, [estado.alocacoes, estado.nomes.funcionarios]);
  const alocacoesDoDia = useMemo(() => estado.alocacoes.filter((a) => a.data === diaAtual?.data), [estado.alocacoes, diaAtual]);

  const maquinasPainel = useMemo(() => {
    const ids = new Set([...estado.postosDaPrevisao, ...estado.indisponibilidades.map((i) => i.maquinaId)]);
    return [...ids].sort((a, b) => (estado.nomes.maquinas.get(a) || "").localeCompare(estado.nomes.maquinas.get(b) || "", "pt-BR", { numeric: true }));
  }, [estado.postosDaPrevisao, estado.indisponibilidades, estado.nomes.maquinas]);

  async function onGerar() {
    setMensagem(null);
    const msg = await escala.gerar();
    if (msg) setMensagem({ tipo: "erro", texto: msg });
    else setMensagem({ tipo: "ok", texto: "Escala calculada no servidor." });
  }

  async function onTrocar(outroId: string) {
    if (!edicao) return;
    setErroModal(null);
    const msg = await escala.trocar(edicao.data, edicao.periodoId, edicao.funcionarioId, outroId);
    if (msg) setErroModal(msg);
    else { setEdicao(null); setMensagem({ tipo: "ok", texto: "Troca salva." }); }
  }

  async function onBloquear(motivo: string, obs: string) {
    if (!bloqueando) return;
    setErroModal(null);
    const msg = await escala.bloquear(bloqueando, motivo, obs);
    if (msg) setErroModal(msg);
    else { setBloqueando(null); setMensagem({ tipo: "ok", texto: "Recurso indisponível — períodos futuros recalculados." }); }
  }

  async function onLiberar(id: string) {
    const msg = await escala.liberar(id);
    setMensagem(msg ? { tipo: "erro", texto: msg } : { tipo: "ok", texto: "Recurso liberado — volta a participar do próximo período não iniciado." });
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
      abaAtiva="escalaProducao"
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

  if (!podeOperar) {
    return (
      <div className="stx-root">
        <GlobalStyles cores={cores} />
        <div className="stx-layout">{sidebar}<AcessoNegado /></div>
      </div>
    );
  }

  const opcoesTroca = edicao
    ? alocacoesDoDia.filter((a) => a.periodoId === edicao.periodoId && a.funcionarioId !== edicao.funcionarioId).map((a) => ({
        id: a.funcionarioId,
        rotulo: `${estado.nomes.funcionarios.get(a.funcionarioId) || "Funcionário"} — ${a.maquinaId ? estado.nomes.maquinas.get(a.maquinaId) || "posto" : "sem posto"}`,
      }))
    : [];
  const aEditar = edicao ? alocacoesDoDia.find((a) => a.periodoId === edicao.periodoId && a.funcionarioId === edicao.funcionarioId) : null;
  const ultimaAtualizacao = estado.dias.reduce((m, d) => (d.atualizadoEm > m ? d.atualizadoEm : m), "");

  return (
    <div className="stx-root">
      <GlobalStyles cores={cores} />
      <style>{ESTILOS_ESCALA}</style>
      <div className="stx-layout">
        {sidebar}
        <div className="stx-content-wrapper">
          <TopBarActions
            modoPrivado={modoPrivado} onToggleModoPrivado={toggleModoPrivado}
            tema={tema} onToggleTema={() => setTema((t) => (t === "dark" ? "light" : "dark"))}
            usuarioLogado={auth.usuarioLogado} abaAtiva="escalaProducao" onAbrirMenu={shell.abrirGaveta}
          />
          <div className="stx-header">
            <div>
              <div className="stx-esc-nav">
                <button type="button" className="stx-esc-pill" aria-label="Semana anterior" onClick={() => setSemana(shiftWeek(semana, -1))}>‹</button>
                <span style={{ fontSize: 14 }}>{weekLabel(semana)}</span>
                <button type="button" className="stx-esc-pill" aria-label="Próxima semana" onClick={() => setSemana(shiftWeek(semana, 1))}>›</button>
              </div>
              <h1 className="stx-title">Escala de Produção</h1>
            </div>
            <button type="button" className="stx-add-btn" onClick={onGerar} disabled={escala.acaoEmAndamento || !estado.previsaoId}>
              {escala.acaoEmAndamento ? "Processando…" : estado.dias.length === 0 ? "Gerar escala" : "Regerar a partir do próximo período"}
            </button>
          </div>

          {mensagem && <div className={`stx-esc-banner ${mensagem.tipo === "erro" ? "erro" : "info"}`}>{mensagem.texto}</div>}
          {escala.erro && <div className="stx-esc-banner erro">{escala.erro}</div>}
          {estado.primeiraGeracaoEmAndamento && <div className="stx-esc-banner">{AVISO_PRIMEIRA_GERACAO}</div>}
          {(estado.eventosPendentes > 0 || estado.eventosComErro > 0) && (
            <div className="stx-esc-banner">
              {estado.eventosPendentes > 0 && `${estado.eventosPendentes} alteração(ões) aguardando recálculo. `}
              {estado.eventosComErro > 0 && `${estado.eventosComErro} com erro (nova tentativa automática). `}
              <button type="button" className="stx-esc-btn" onClick={() => escala.processarPendentes()} disabled={escala.acaoEmAndamento}>Processar agora</button>
            </div>
          )}

          {escala.loading ? (
            <div className="stx-empty">Carregando…</div>
          ) : !estado.previsaoId ? (
            <div className="stx-empty">Não existe Previsão Semanal para esta semana. Crie a Previsão (itens, máquinas, dias e equipe produtiva) para poder gerar a escala.</div>
          ) : estado.dias.length === 0 ? (
            <div className="stx-empty">Nenhuma escala gerada para esta semana. Use “Gerar escala” — ela distribui a equipe produtiva entre os postos selecionados na Previsão.</div>
          ) : (
            <>
              <div className="stx-esc-status">
                Atualizada em {ultimaAtualizacao ? formatarDataHoraBR(ultimaAtualizacao) : "—"} · períodos em andamento e concluídos ficam congelados; só os futuros são recalculados.
              </div>
              <div className="stx-esc-nav">
                {estado.dias.map((d) => (
                  <button key={d.data} type="button" className={`stx-esc-pill ${d.data === diaAtual?.data ? "ativo" : ""}`} onClick={() => setDiaSel(d.data)}>
                    {rotuloDia(d.data)}
                  </button>
                ))}
              </div>
              {diaAtual && (
                <GradeEscala
                  dia={diaAtual}
                  alocacoes={alocacoesDoDia}
                  funcionarios={funcionariosOrdenados}
                  nomes={estado.nomes}
                  agoraMs={agoraMs}
                  onEditar={(periodoId, funcionarioId) => { setErroModal(null); setEdicao({ data: diaAtual.data, periodoId, funcionarioId }); }}
                />
              )}
              <AlertasEscala alocacoes={estado.alocacoes} alertas={estado.alertas} nomes={estado.nomes} />
            </>
          )}

          {estado.previsaoId && (
            <div className="stx-esc-painel">
              <h2>Recursos (postos da Previsão)</h2>
              <p className="stx-esc-muted">Indisponível = não recebe funcionário nos períodos futuros, até alguém liberar.</p>
              <div className="stx-esc-lista">
                {maquinasPainel.length === 0 && <p className="stx-esc-muted">Nenhuma máquina selecionada na Previsão desta semana.</p>}
                {maquinasPainel.map((mid) => {
                  const ind = estado.indisponibilidades.find((i) => i.maquinaId === mid);
                  return (
                    <div className="stx-esc-linha" key={mid}>
                      <span>
                        <b>{estado.nomes.maquinas.get(mid) || "Máquina"}</b>{" "}
                        {ind ? (
                          <span className="stx-esc-muted">indisponível desde {formatarDataHoraBR(ind.desde)} — {MOTIVOS_INDISPONIBILIDADE.find((m) => m.valor === ind.motivo)?.rotulo || ind.motivo}{ind.observacao ? ` (${ind.observacao})` : ""}</span>
                        ) : <span className="stx-esc-muted">disponível</span>}
                      </span>
                      {ind ? (
                        <button type="button" className="stx-esc-btn" disabled={escala.acaoEmAndamento} onClick={() => onLiberar(ind.id)}>Liberar</button>
                      ) : (
                        <button type="button" className="stx-esc-btn" disabled={escala.acaoEmAndamento} onClick={() => { setErroModal(null); setBloqueando(mid); }}>Tornar indisponível</button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
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

      {edicao && aEditar && (
        <TrocaModal
          titulo={`${estado.nomes.funcionarios.get(edicao.funcionarioId) || "Funcionário"} — ${aEditar.maquinaId ? estado.nomes.maquinas.get(aEditar.maquinaId) || "posto" : "sem posto"} (${edicao.periodoId.toUpperCase()} de ${rotuloDia(edicao.data)})`}
          opcoes={opcoesTroca}
          onConfirmar={onTrocar}
          onFechar={() => setEdicao(null)}
          salvando={escala.acaoEmAndamento}
          erro={erroModal}
        />
      )}
      {bloqueando && (
        <BloquearModal
          maquinaNome={estado.nomes.maquinas.get(bloqueando) || "Máquina"}
          onConfirmar={onBloquear}
          onFechar={() => setBloqueando(null)}
          salvando={escala.acaoEmAndamento}
          erro={erroModal}
        />
      )}
    </div>
  );
}
