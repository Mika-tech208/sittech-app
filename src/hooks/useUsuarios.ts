"use client";

// Camada de acesso a public.usuarios (perfis de usuário reais, distintos
// do array legado do blob). Criação de conta e redefinição de senha de
// OUTRO usuário exigem privilégio de service_role (Supabase Auth Admin
// API), impossível de fazer com segurança no navegador — por isso essas
// duas ações chamam rotas server-side (src/app/api/admin/usuarios/**),
// nunca o client Supabase direto. Edição de nome/papel/ativo é UPDATE
// comum, permitido pela RLS (usuarios_update_admin_only) com o client
// normal (anon key + JWT do admin logado).
//
// Sem senhaHash/senhaSalt aqui: a tabela public.usuarios não tem essas
// colunas (senha vive só em auth.users, via Supabase Auth). Sem função de
// exclusão: não existe policy de DELETE — o comportamento atual é
// ativar/desativar, preservado por alternarUsuarioAtivo.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/services/supabase-client";

export interface UsuarioPerfil {
  id: string;
  nome: string;
  email: string;
  papel: "admin" | "usuario";
  ativo: boolean;
  ultimoAcesso: string | null;
  criadoEm: string;
}

interface UsuarioPerfilRow {
  id: string;
  nome: string;
  email: string;
  papel: "admin" | "usuario";
  ativo: boolean;
  ultimo_acesso: string | null;
  created_at: string;
}

interface CriarUsuarioPayload {
  nome: string;
  email: string;
  senha: string;
  papel: "admin" | "usuario";
}

function converterRow(r: UsuarioPerfilRow): UsuarioPerfil {
  return { id: r.id, nome: r.nome, email: r.email, papel: r.papel, ativo: r.ativo, ultimoAcesso: r.ultimo_acesso, criadoEm: r.created_at };
}

const SELECT_COLUNAS = "id, nome, email, papel, ativo, ultimo_acesso, created_at";

async function chamarRotaAdmin(caminho: string, corpo: unknown): Promise<{ ok: boolean; erro?: string; dados?: unknown }> {
  const { data: sessao } = await supabase.auth.getSession();
  const token = sessao.session?.access_token;
  if (!token) return { ok: false, erro: "Sessão expirada. Faça login novamente." };

  const resposta = await fetch(caminho, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(corpo),
  });
  const json = await resposta.json().catch(() => ({}));
  if (!resposta.ok) return { ok: false, erro: json?.erro || "Não foi possível completar a ação." };
  return { ok: true, dados: json };
}

export function useUsuarios(pronto: boolean) {
  const [usuarios, setUsuarios] = useState<UsuarioPerfil[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!pronto) return;
    let montado = true;
    (async () => {
      const { data, error } = await supabase.from("usuarios").select(SELECT_COLUNAS).order("nome");
      if (!montado) return;
      if (error) {
        setErro("Não foi possível carregar os usuários.");
        setLoading(false);
        return;
      }
      setUsuarios(((data || []) as unknown as UsuarioPerfilRow[]).map(converterRow));
      setLoading(false);
    })();
    return () => { montado = false; };
  }, [pronto]);

  const criarUsuario = useCallback(async (payload: CriarUsuarioPayload): Promise<UsuarioPerfil | null> => {
    setErro(null);
    const resultado = await chamarRotaAdmin("/api/admin/usuarios", payload);
    if (!resultado.ok) {
      setErro(resultado.erro || "Não foi possível criar o usuário.");
      return null;
    }
    const novo = converterRow((resultado.dados as { usuario: UsuarioPerfilRow }).usuario);
    setUsuarios((prev) => [...prev, novo].sort((a, b) => a.nome.localeCompare(b.nome)));
    return novo;
  }, []);

  const atualizarUsuario = useCallback(async (id: string, payload: { nome: string; papel: "admin" | "usuario" }): Promise<boolean> => {
    setErro(null);
    const { error } = await supabase.from("usuarios").update({ nome: payload.nome, papel: payload.papel }).eq("id", id);
    if (error) {
      setErro("Não foi possível salvar o usuário.");
      return false;
    }
    setUsuarios((prev) => prev.map((u) => (u.id === id ? { ...u, nome: payload.nome, papel: payload.papel } : u)));
    return true;
  }, []);

  const alternarUsuarioAtivo = useCallback(async (id: string): Promise<boolean> => {
    setErro(null);
    const atual = usuarios.find((u) => u.id === id);
    if (!atual) return false;
    const novoAtivo = !atual.ativo;
    const { error } = await supabase.from("usuarios").update({ ativo: novoAtivo }).eq("id", id);
    if (error) {
      setErro("Não foi possível atualizar o usuário.");
      return false;
    }
    setUsuarios((prev) => prev.map((u) => (u.id === id ? { ...u, ativo: novoAtivo } : u)));
    return true;
  }, [usuarios]);

  const resetarSenhaUsuario = useCallback(async (id: string, novaSenha: string): Promise<boolean> => {
    setErro(null);
    const resultado = await chamarRotaAdmin(`/api/admin/usuarios/${id}/reset-senha`, { novaSenha });
    if (!resultado.ok) {
      setErro(resultado.erro || "Não foi possível redefinir a senha.");
      return false;
    }
    return true;
  }, []);

  return { usuarios, loading, erro, criarUsuario, atualizarUsuario, alternarUsuarioAtivo, resetarSenhaUsuario };
}

export type UsuariosHook = ReturnType<typeof useUsuarios>;
