"use client";

// Leitura de public.auditoria. Só leitura — o registro de novas entradas
// continua centralizado em registrarAuditoria (useAuthSession.ts), único
// ponto de escrita hoje. RLS (auditoria_select_admin_only) já restringe
// SELECT a admins; para um usuário comum a consulta simplesmente retorna
// lista vazia (RLS filtra as linhas, não gera erro), então não é preciso
// tratamento especial aqui além do que a RLS já garante.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/services/supabase-client";

export interface AuditoriaRegistro {
  id: string;
  quando: string;
  quem: string;
  acao: string;
  usuarioAfetado: string | null;
}

interface AuditoriaRow {
  id: string;
  quando: string;
  quem: string;
  acao: string;
  usuario_afetado: string | null;
}

const LIMITE_EXIBICAO = 30;

export function useAuditoria(pronto: boolean) {
  const [registros, setRegistros] = useState<AuditoriaRegistro[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const { data, error } = await supabase
      .from("auditoria")
      .select("id, quando, quem, acao, usuario_afetado")
      .order("quando", { ascending: false })
      .limit(LIMITE_EXIBICAO);
    if (error) {
      setErro("Não foi possível carregar a auditoria.");
      return;
    }
    setRegistros(
      ((data || []) as unknown as AuditoriaRow[]).map((r) => ({
        id: r.id, quando: r.quando, quem: r.quem, acao: r.acao, usuarioAfetado: r.usuario_afetado,
      }))
    );
  }, []);

  useEffect(() => {
    if (!pronto) return;
    let montado = true;
    (async () => {
      await carregar();
      if (montado) setLoading(false);
    })();
    return () => { montado = false; };
  }, [pronto, carregar]);

  return { registros, loading, erro, recarregar: carregar };
}

export type AuditoriaHook = ReturnType<typeof useAuditoria>;
