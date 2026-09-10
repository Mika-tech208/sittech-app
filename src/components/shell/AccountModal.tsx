"use client";

import { useEffect, useState } from "react";
import { ativarNotificacoes, desativarNotificacoes, permissaoAtual, subscriptionLocalExiste, suportaPush } from "@/lib/push/browserPush";

export interface AccountModalProps {
  // Formato do `UsuarioLogado` (useAuthSession.ts) — mesmo componente usado
  // pelo app legado e pelas rotas migradas, ambos já 100% Supabase Auth.
  // `id` é usado só pela seção de notificações abaixo (todo call-site já
  // passa o `usuarioLogado` inteiro, que sempre tem `id` — nenhum dos ~13
  // lugares que instanciam este modal precisou mudar).
  usuarioLogado: { id: string; nome: string; papel: string; email: string } | null;
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

// Modal "Minha conta" (trocar a própria senha + notificações) — mesmo
// componente pro app legado e pras novas rotas, disparado pelo botão
// "Minha conta" do TopBar.
export default function AccountModal({
  usuarioLogado, aberta, onFechar, minhaSenhaAtual, setMinhaSenhaAtual, minhaSenhaNova, setMinhaSenhaNova,
  minhaSenhaConfirma, setMinhaSenhaConfirma, minhaContaMsg, onSalvar,
}: AccountModalProps) {
  const [notifSuportado, setNotifSuportado] = useState(false);
  const [notifAtiva, setNotifAtiva] = useState(false);
  const [notifCarregando, setNotifCarregando] = useState(false);
  const [notifMsg, setNotifMsg] = useState("");

  useEffect(() => {
    if (!aberta) return;
    setNotifSuportado(suportaPush());
    setNotifMsg("");
    subscriptionLocalExiste().then(setNotifAtiva);
  }, [aberta]);

  async function alternarNotificacoes() {
    if (!usuarioLogado) return;
    setNotifCarregando(true);
    setNotifMsg("");
    try {
      if (notifAtiva) {
        await desativarNotificacoes();
        setNotifAtiva(false);
      } else {
        await ativarNotificacoes(usuarioLogado.id);
        setNotifAtiva(true);
      }
    } catch (err) {
      setNotifMsg(err instanceof Error ? err.message : "Não foi possível concluir a ação.");
    } finally {
      setNotifCarregando(false);
    }
  }

  if (!aberta || !usuarioLogado) return null;
  return (
    <div className="stx-modal-backdrop" onClick={onFechar}>
      <div className="stx-modal-card" onClick={(e) => e.stopPropagation()}>
        <p className="stx-modal-titulo">Minha conta</p>
        <p className="stx-panel-sub" style={{ marginBottom: 4 }}>Nome: <b style={{ color: "var(--text)" }}>{usuarioLogado.nome}</b></p>
        <p className="stx-panel-sub" style={{ marginBottom: 16 }}>E-mail: <b style={{ color: "var(--text)" }}>{usuarioLogado.email}</b> · {usuarioLogado.papel === "admin" ? "Administrador" : "Usuário"}</p>
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

        <p className="stx-analise-secao-titulo" style={{ marginTop: 20 }}>Notificações</p>
        {notifSuportado ? (
          <>
            <p className="stx-panel-sub" style={{ marginBottom: 10 }}>
              Receber um aviso neste dispositivo quando uma máquina entrar em ocorrência de parada.
            </p>
            <div className="stx-form-actions" style={{ justifyContent: "flex-start", marginBottom: 4 }}>
              <button type="button" className="stx-btn-secondary" onClick={alternarNotificacoes} disabled={notifCarregando}>
                {notifCarregando ? "Aguarde..." : notifAtiva ? "Desativar notificações" : "Ativar notificações"}
              </button>
            </div>
          </>
        ) : (
          <p className="stx-panel-sub" style={{ marginBottom: 10 }}>
            Notificações não são suportadas neste navegador/dispositivo. No iPhone, use o Sittech instalado na Tela de Início (Safari sozinho não suporta).
          </p>
        )}
        {notifMsg && (
          <p style={{ fontSize: 12.5, color: "var(--danger)", marginBottom: 10 }}>{notifMsg}</p>
        )}

        <div className="stx-form-actions" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="stx-btn-secondary" onClick={onFechar}>Fechar</button>
          <button type="button" className="stx-btn-primary" onClick={onSalvar}>Salvar nova senha</button>
        </div>
      </div>
    </div>
  );
}
