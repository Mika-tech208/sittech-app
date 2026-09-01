"use client";

import type { Usuario } from "@/types/domain";

export interface AccountModalProps {
  usuarioLogado: Usuario | null;
  aberta: boolean;
  onFechar: () => void;
  minhaSenhaAtual: string;
  setMinhaSenhaAtual: (v: string) => void;
  minhaSenhaNova: string;
  setMinhaSenhaNova: (v: string) => void;
  minhaSenhaConfirma: string;
  setMinhaSenhaConfirma: (v: string) => void;
  minhaContaMsg: string;
  onSalvar: () => void;
}

// Modal "Minha conta" (trocar a própria senha) — mesmo componente pro app
// legado e pras novas rotas, disparado pelo botão "Minha conta" do TopBar.
export default function AccountModal({
  usuarioLogado, aberta, onFechar, minhaSenhaAtual, setMinhaSenhaAtual, minhaSenhaNova, setMinhaSenhaNova,
  minhaSenhaConfirma, setMinhaSenhaConfirma, minhaContaMsg, onSalvar,
}: AccountModalProps) {
  if (!aberta || !usuarioLogado) return null;
  return (
    <div className="stx-modal-backdrop" onClick={onFechar}>
      <div className="stx-modal-card" onClick={(e) => e.stopPropagation()}>
        <p className="stx-modal-titulo">Minha conta</p>
        <p className="stx-panel-sub" style={{ marginBottom: 4 }}>Nome: <b style={{ color: "var(--text)" }}>{usuarioLogado.nome}</b></p>
        <p className="stx-panel-sub" style={{ marginBottom: 16 }}>Login: <b style={{ color: "var(--text)" }}>{usuarioLogado.login}</b> · {usuarioLogado.papel === "admin" ? "Administrador" : "Usuário"}</p>
        <p className="stx-analise-secao-titulo">Trocar senha</p>
        <div style={{ marginBottom: 10 }}>
          <label className="stx-label">Senha atual</label>
          <input type="password" className="stx-input" value={minhaSenhaAtual} onChange={(e) => setMinhaSenhaAtual(e.target.value)} />
        </div>
        <div style={{ marginBottom: 10 }}>
          <label className="stx-label">Nova senha</label>
          <input type="password" className="stx-input" value={minhaSenhaNova} onChange={(e) => setMinhaSenhaNova(e.target.value)} placeholder="mínimo 4 caracteres" />
        </div>
        <div style={{ marginBottom: 10 }}>
          <label className="stx-label">Confirmar nova senha</label>
          <input type="password" className="stx-input" value={minhaSenhaConfirma} onChange={(e) => setMinhaSenhaConfirma(e.target.value)} />
        </div>
        {minhaContaMsg && (
          <p style={{ fontSize: 12.5, color: minhaContaMsg.includes("sucesso") ? "var(--accent)" : "var(--danger)", marginBottom: 10 }}>{minhaContaMsg}</p>
        )}
        <div className="stx-form-actions" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="stx-btn-secondary" onClick={onFechar}>Fechar</button>
          <button type="button" className="stx-btn-primary" onClick={onSalvar}>Salvar nova senha</button>
        </div>
      </div>
    </div>
  );
}
