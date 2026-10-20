"use client";

// Modo TV da Escala de Produção — SOMENTE leitura: mostra AGORA e PRÓXIMO
// período, sem sidebar, alto contraste, letras grandes, atualização
// automática. Nunca escreve, nunca recalcula, nunca dispara regra.

import { useEffect, useState } from "react";
import { useAuthSession } from "@/hooks/useAuthSession";
import { useEscalaTv } from "@/hooks/useEscalaTv";
import { useWakeLockTv } from "@/hooks/useWakeLockTv";
import LoginScreen from "@/components/shell/LoginScreen";
import { temPermissao } from "@/lib/permissoes";
import { dataHoraNoFuso, epochMsNoFuso } from "@/features/escala/tempo";
import { linhasDoPeriodo, situacaoTv, type LinhaTv } from "@/features/escala/tv";

const ESTILOS_TV = `
.stx-tv { position:fixed; inset:0; background:#000; color:#fff; font-family:system-ui,-apple-system,"Segoe UI",sans-serif; display:flex; flex-direction:column; overflow:hidden; }
.stx-tv-topo { display:flex; justify-content:space-between; align-items:baseline; padding:1.2vh 2vw; border-bottom:2px solid #333; font-size:clamp(16px,2.2vh,30px); color:#bbb; gap:12px; flex-wrap:wrap; }
.stx-tv-relogio { font-size:clamp(24px,4.4vh,64px); color:#fff; font-weight:700; letter-spacing:.04em; }
.stx-tv-corpo { flex:1; display:grid; grid-template-columns: 1fr 1fr; gap:1.6vw; padding:1.6vh 2vw; min-height:0; }
@media (max-width: 900px) { .stx-tv-corpo { grid-template-columns: 1fr; overflow:auto; } .stx-tv-lista { grid-template-columns: 1fr; grid-template-rows: none; grid-auto-rows: minmax(84px,auto); --h: 90px; } }
.stx-tv-col { display:flex; flex-direction:column; min-height:0; border:3px solid #2b2b2b; border-radius:18px; padding:1.2vh 1.2vw; }
.stx-tv-col.agora { border-color:#27d17f; }
.stx-tv-col.proximo { border-color:#555; }
.stx-tv-col.destaque { border-color:#ffd400; animation: stxtvpulso 1s ease-in-out infinite alternate; }
@keyframes stxtvpulso { from { box-shadow:0 0 0 0 rgba(255,212,0,.0); } to { box-shadow:0 0 28px 6px rgba(255,212,0,.55); } }
.stx-tv-titulo { font-size:clamp(22px,4vh,56px); font-weight:800; margin-bottom:1vh; display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; }
.stx-tv-col.agora .stx-tv-titulo { color:#27d17f; }
.stx-tv-col.proximo .stx-tv-titulo { color:#ddd; }
.stx-tv-col.destaque .stx-tv-titulo { color:#ffd400; }
.stx-tv-sub { font-size:clamp(14px,2.2vh,28px); color:#aaa; font-weight:500; }
.stx-tv-lista { flex:1; min-height:0; overflow:hidden; display:grid; grid-template-columns: repeat(2, minmax(0,1fr)); grid-template-rows: repeat(var(--linhas,4), minmax(0,1fr)); gap:1vh 1vw; --h: calc(68vh / var(--linhas,4)); }
.stx-tv-card { background:#111; border-radius:12px; padding:0 1vw; min-width:0; min-height:0; display:flex; flex-direction:column; justify-content:center; overflow:hidden; }
.stx-tv-nome { font-size:clamp(12px,min(calc(var(--h) * .34),1.45vw),46px); font-weight:800; line-height:1.1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.stx-tv-maq { font-size:clamp(11px,min(calc(var(--h) * .28),1.2vw),40px); color:#7fd6ff; font-weight:700; line-height:1.15; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.stx-tv-prod { font-size:clamp(10px,min(calc(var(--h) * .22),0.95vw),32px); color:#ddd; line-height:1.15; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.stx-tv-sem { font-size:clamp(11px,min(calc(var(--h) * .26),1.1vw),30px); color:#ffb347; font-style:italic; }
.stx-tv-vazio { font-size:clamp(20px,3.4vh,44px); color:#888; padding:3vh 1vw; }
.stx-tv-rodape { padding:1vh 2vw; border-top:2px solid #333; font-size:clamp(13px,1.9vh,24px); color:#999; display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; }
.stx-tv-alerta { color:#ff6b6b; font-weight:700; }
.stx-tv-diag { color:#666; font-size:.85em; }
`;

function Coluna({ classe, titulo, sub, linhas }: { classe: string; titulo: string; sub?: string; linhas: LinhaTv[] }) {
  return (
    <section className={`stx-tv-col ${classe}`}>
      <div className="stx-tv-titulo"><span>{titulo}</span>{sub && <span className="stx-tv-sub">{sub}</span>}</div>
      <div className="stx-tv-lista" style={{ ["--linhas" as string]: Math.max(4, Math.ceil(linhas.length / 2)) }}>
        {linhas.length === 0 && <div className="stx-tv-vazio">—</div>}
        {linhas.map((l) => (
          <div className="stx-tv-card" key={l.funcionario_id}>
            <div className="stx-tv-nome">{l.funcionario}</div>
            {l.maquina ? (
              <>
                <div className="stx-tv-maq">{l.maquina}</div>
                <div className="stx-tv-prod">{l.produto}</div>
              </>
            ) : (
              <div className="stx-tv-sem">Sem posto</div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export default function EscalaTvPage() {
  const auth = useAuthSession();
  const permitido = temPermissao(auth.usuarioLogado, "escala_producao_tv") || temPermissao(auth.usuarioLogado, "escala_producao");
  // Simulação de relógio (?simular=AAAA-MM-DDTHH:MM) — só para quem opera a
  // Escala (escala_producao); o usuário de quiosque nunca simula. Auxilia
  // conferir a TV fora do horário de produção. Continua somente leitura.
  const podeSimular = temPermissao(auth.usuarioLogado, "escala_producao");
  const [simulacao, setSimulacao] = useState<{ data: string; agoraMs: number } | null | undefined>(undefined);
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get("simular");
    const m = v?.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/);
    setSimulacao(m && podeSimular ? { data: m[1], agoraMs: epochMsNoFuso(m[1], m[2]) } : null);
  }, [podeSimular]);
  const tv = useEscalaTv(auth.autenticado && permitido && simulacao !== undefined, simulacao);
  const { snapshot, agoraMs } = tv;
  const wakeLock = useWakeLockTv(auth.autenticado && permitido);

  // refaz a leitura quando o dia vira (a TV fica ligada o dia todo)
  const diaLocal = dataHoraNoFuso(agoraMs).data;
  useEffect(() => {
    if (snapshot && !tv.simulando && snapshot.data !== diaLocal) tv.buscar();
  }, [diaLocal, snapshot, tv]);

  if (auth.restaurandoSessao || !auth.autenticado) {
    return (
      <LoginScreen
        loading={auth.restaurandoSessao}
        tema="dark"
        loginUsuario={auth.loginUsuario} setLoginUsuario={auth.setLoginUsuario}
        loginSenha={auth.loginSenha} setLoginSenha={auth.setLoginSenha}
        loginErro={auth.loginErro} loginCarregando={auth.loginCarregando}
        onSubmit={auth.handleLogin} campoLogin="email"
      />
    );
  }
  if (!permitido) {
    return <div style={{ padding: 32, color: "#fff", background: "#000", minHeight: "100vh" }}>Este usuário não tem acesso ao modo TV da Escala.</div>;
  }

  const hora = (() => {
    const { minutos } = dataHoraNoFuso(agoraMs);
    return `${String(Math.floor(minutos / 60)).padStart(2, "0")}:${String(minutos % 60).padStart(2, "0")}`;
  })();
  const situacao = snapshot?.existe && snapshot.periodos ? situacaoTv(snapshot.data, snapshot.periodos, agoraMs) : null;
  const alocacoes = snapshot?.alocacoes ?? [];
  const [, m, d] = diaLocal.split("-");

  return (
    <div className="stx-tv">
      <style>{ESTILOS_TV}</style>
      <div className="stx-tv-topo">
        <span>Escala de Produção · {d}/{m}{tv.simulando ? " · SIMULAÇÃO" : ""}</span>
        <span className="stx-tv-relogio">{hora}</span>
        <span>{tv.tempoReal === "ativo" ? "● ao vivo" : tv.tempoReal === "polling" ? "● atualização periódica" : "● conectando…"}</span>
      </div>

      {!snapshot ? (
        <div className="stx-tv-corpo"><div className="stx-tv-vazio">{tv.erro ? `Erro: ${tv.erro}` : "Carregando escala…"}</div></div>
      ) : !snapshot.existe || !situacao ? (
        <div className="stx-tv-corpo"><div className="stx-tv-vazio">Nenhuma escala gerada para hoje.</div></div>
      ) : situacao.encerrado ? (
        <div className="stx-tv-corpo"><div className="stx-tv-vazio">Produção encerrada por hoje.</div></div>
      ) : (
        <div className="stx-tv-corpo">
          <Coluna
            classe="agora"
            titulo={situacao.atual ? `AGORA — ${situacao.atual.nome}` : situacao.antesDoInicio ? "AGORA — produção ainda não iniciou" : "AGORA — intervalo"}
            sub={situacao.atual ? `${situacao.atual.inicio}–${situacao.atual.fim}${situacao.minutosParaTroca !== null ? ` · troca em ${situacao.minutosParaTroca} min` : ""}` : situacao.proximo ? `próximo período às ${situacao.proximo.inicio}` : undefined}
            linhas={linhasDoPeriodo(alocacoes, situacao.atual?.id)}
          />
          <Coluna
            classe={`proximo ${situacao.destacarProximo ? "destaque" : ""}`}
            titulo={situacao.proximo ? `PRÓXIMO — ${situacao.proximo.nome}` : "PRÓXIMO"}
            sub={situacao.proximo ? `${situacao.proximo.inicio}–${situacao.proximo.fim}${situacao.destacarProximo ? " · TROCA EM BREVE" : ""}` : "último período do dia"}
            linhas={linhasDoPeriodo(alocacoes, situacao.proximo?.id)}
          />
        </div>
      )}

      <div className="stx-tv-rodape">
        <span>
          {snapshot?.indisponiveis && snapshot.indisponiveis.length > 0
            ? `Indisponíveis: ${snapshot.indisponiveis.map((i) => i.maquina).join(", ")}`
            : "Todos os recursos disponíveis"}
        </span>
        <span className="stx-tv-diag" title="Diagnóstico da tela">
          {wakeLock === "ativo" ? "Tela ativa" : wakeLock === "nao_suportado" ? "Wake Lock não suportado" : ""}
        </span>
        <span className={tv.desatualizado ? "stx-tv-alerta" : undefined}>
          {tv.desatualizado ? "ATUALIZAÇÃO PENDENTE — verifique a conexão" : snapshot?.versao !== undefined ? `versão ${snapshot.versao}` : ""}
        </span>
      </div>
    </div>
  );
}
