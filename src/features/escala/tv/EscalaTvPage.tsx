"use client";

// TV da fábrica — PAINEL DE ACOMPANHAMENTO DAS METAS DE PRODUÇÃO (14/11/2026). PASSIVO: só lê (RPC tv_metas_producao, sem dado financeiro).
// Não gera escala, não troca operador, não libera período, não bloqueia apontamento, não dispara processamento nem recálculo. Funciona igual com a
// escala automática desligada e o apontamento manual ativo: a barra anda conforme os apontamentos entram.
// Acesso: o usuário de quiosque (permissão escala_producao_tv) ou quem opera a Escala (escala_producao) — mesma regra de antes.
import { useAuthSession } from "@/hooks/useAuthSession";
import { useMetasTv } from "@/hooks/useMetasTv";
import { useWakeLockTv } from "@/hooks/useWakeLockTv";
import LoginScreen from "@/components/shell/LoginScreen";
import { temPermissao } from "@/lib/permissoes";
import PainelMetasTv from "@/features/escala/tv-metas/PainelMetasTv";

export default function EscalaTvPage() {
  const auth = useAuthSession();
  const permitido = temPermissao(auth.usuarioLogado, "escala_producao_tv") || temPermissao(auth.usuarioLogado, "escala_producao");
  const tv = useMetasTv(auth.autenticado && permitido);
  const wakeLock = useWakeLockTv(auth.autenticado && permitido);

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
    return <div style={{ padding: 32, color: "#fff", background: "#1D1D1B", minHeight: "100vh" }}>Este usuário não tem acesso à TV da fábrica.</div>;
  }
  return <PainelMetasTv modelo={tv.modelo} atualizadoEm={tv.atualizadoEm} conexao={tv.conexao} erro={tv.erro} diagnostico={wakeLock === "nao_suportado" ? "Wake Lock não suportado" : undefined} />;
}
