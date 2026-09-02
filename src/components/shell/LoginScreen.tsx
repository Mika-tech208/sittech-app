"use client";

import { LOGO_DARK, LOGO_LIGHT } from "@/lib/logos";

export interface LoginScreenProps {
  loading: boolean;
  tema: "dark" | "light";
  loginUsuario: string;
  setLoginUsuario: (v: string) => void;
  loginSenha: string;
  setLoginSenha: (v: string) => void;
  loginErro: string;
  loginCarregando: boolean;
  onSubmit: () => void;
  // Rótulo/placeholder do campo — todas as rotas (incluindo o monólito
  // legado) já autenticam via Supabase Auth com e-mail; "usuario" é só o
  // texto padrão exibido quando a página não passa "email" explicitamente.
  campoLogin?: "email" | "usuario";
}

// Tela de carregamento + login — idêntica à do app legado (mesmas classes
// stx-login-screen/stx-login-card), usada também pelas novas rotas pra
// quem abrir /previsao ou /capacidade direto sem estar logado ainda.
export default function LoginScreen({
  loading, tema, loginUsuario, setLoginUsuario, loginSenha, setLoginSenha, loginErro, loginCarregando, onSubmit,
  campoLogin = "usuario",
}: LoginScreenProps) {
  const isEmail = campoLogin === "email";
  if (loading) {
    return (
      <div className="stx-login-screen">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={tema === "dark" ? LOGO_DARK : LOGO_LIGHT} alt="Sittech" className="stx-logo" style={{ height: 64, marginBottom: 20 }} />
        <p className="stx-panel-sub">Carregando…</p>
      </div>
    );
  }
  return (
    <div className="stx-login-screen">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={tema === "dark" ? LOGO_DARK : LOGO_LIGHT} alt="Sittech" className="stx-logo" style={{ height: 76, marginBottom: 28 }} />
      <div className="stx-login-card">
        <p className="stx-panel-title" style={{ marginBottom: 4 }}>Acesso restrito</p>
        <p className="stx-panel-sub">Entre com seu {isEmail ? "e-mail" : "usuário"} e senha para continuar.</p>
        <div style={{ marginTop: 10 }}>
          <label className="stx-label">{isEmail ? "E-mail" : "Usuário"}</label>
          <input
            type={isEmail ? "email" : "text"}
            className="stx-input"
            value={loginUsuario}
            onChange={(e) => setLoginUsuario(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onSubmit()}
            placeholder={isEmail ? "seu@email.com" : "usuário"}
            autoFocus
          />
        </div>
        <div style={{ marginTop: 10 }}>
          <label className="stx-label">Senha</label>
          <input
            type="password"
            className="stx-input"
            value={loginSenha}
            onChange={(e) => setLoginSenha(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onSubmit()}
            placeholder="senha"
          />
        </div>
        {loginErro && <p className="stx-import-resultado" style={{ color: "var(--danger)" }}>{loginErro}</p>}
        <button type="button" className="stx-btn-primary" style={{ marginTop: 14, width: "100%" }} onClick={onSubmit} disabled={loginCarregando}>
          {loginCarregando ? "Entrando…" : "Entrar"}
        </button>
      </div>
    </div>
  );
}
