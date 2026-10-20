"use client";

// Mantém a tela da TV acordada via Screen Wake Lock (ver features/escala/tv/wakeLock.ts).
// Independente de Realtime/polling: se der qualquer problema aqui, só muda o
// texto de diagnóstico — a TV continua funcionando.

import { useEffect, useState } from "react";
import { criarControladorWakeLock, type EstadoWakeLock } from "@/features/escala/tv/wakeLock";

export function useWakeLockTv(ativo: boolean): EstadoWakeLock {
  const [estado, setEstado] = useState<EstadoWakeLock>("inativo");
  useEffect(() => {
    if (!ativo || typeof window === "undefined") return;
    const controlador = criarControladorWakeLock(navigator as never, document, setEstado, { janela: window });
    controlador.iniciar();
    return () => controlador.parar();
  }, [ativo]);
  return estado;
}
