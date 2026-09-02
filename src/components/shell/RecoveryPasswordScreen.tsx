"use client";

import { LOGO_DARK, LOGO_LIGHT } from "@/lib/logos";

export interface RecoveryPasswordScreenProps {
  tema: "dark" | "light";
  novaSenha: string;
  setNovaSenha: (v: string) => void;
  confirmarSenha: string;
  setConfirmarSenha: (v: string) => void;
  mensagem: string;
  salvando: boolean;
  sucesso: boolean;
  onSubmit: () => void;
  onContinuar: () => void;
}

// Tela mostrada quando o Supabase dispara PASSWORD_RECOVERY (usuário abriu
// um link de "esqueci minha senha") — mesmo layout de LoginScreen, mas sem
// pedir senha atual (o token do link já prova a identidade). Só troca a
// senha via supabase.auth.updateUser; não mexe no fluxo de login normal
// nem no de "Minha conta" (useAuthSession.ts, alterarMinhaSenha).
export default function RecoveryPasswordScreen({
  tema, novaSenha, setNovaSenha, confirmarSenha, setConfirmarSenha, mensagem, salvando, sucesso, onSubmit, onContinuar,
}: RecoveryPasswordScreenProps) {
  return (
    <div className="stx-login-screen">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={tema === "dark" ? LOGO_DARK : LOGO_LIGHT} alt="Sittech" className="stx-logo" style={{ height: 76, marginBottom: 28 }} />
      <div className="stx-login-card">
        {sucesso ? (
          <>
            <p className="stx-panel-title" style={{ marginBottom: 4 }}>Senha definida com sucesso</p>
            <p className="stx-panel-sub">Sua nova senha já está ativa. Clique abaixo para entrar no sistema.</p>
            <button type="button" className="stx-btn-primary" style={{ marginTop: 14, width: "100%" }} onClick={onContinuar}>
              Continuar
            </button>
          </>
        ) : (
          <>
            <p className="stx-panel-title" style={{ marginBottom: 4 }}>Definir nova senha</p>
            <p className="stx-panel-sub">Escolhe uma nova senha pra sua conta. Não precisa da senha antiga.</p>
            <div style={{ marginTop: 10 }}>
              <label className="stx-label">Nova senha</label>
              <input
                type="password"
                className="stx-input"
                value={novaSenha}
                onChange={(e) => setNovaSenha(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && onSubmit()}
                placeholder="mínimo 6 caracteres"
                autoFocus
              />
            </div>
            <div style={{ marginTop: 10 }}>
              <label className="stx-label">Confirmar nova senha</label>
              <input
                type="password"
                className="stx-input"
                value={confirmarSenha}
                onChange={(e) => setConfirmarSenha(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && onSubmit()}
                placeholder="repete a senha"
              />
            </div>
            {mensagem && <p className="stx-import-resultado" style={{ color: "var(--danger)" }}>{mensagem}</p>}
            <button type="button" className="stx-btn-primary" style={{ marginTop: 14, width: "100%" }} onClick={onSubmit} disabled={salvando}>
              {salvando ? "Salvando…" : "Salvar nova senha"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
