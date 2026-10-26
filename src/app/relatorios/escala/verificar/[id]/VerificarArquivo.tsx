"use client";

// Conferência OPCIONAL de um PDF recebido: o navegador calcula o SHA-256 do arquivo (nada é enviado) e compara com o hash registrado.
import { useState } from "react";

export default function VerificarArquivo({ hashPdf }: { hashPdf: string }) {
  const [resultado, setResultado] = useState<string | null>(null);
  async function conferir(file: File | undefined) {
    if (!file) return;
    const buf = await file.arrayBuffer();
    const dig = await crypto.subtle.digest("SHA-256", buf);
    const hex = Array.from(new Uint8Array(dig)).map((b) => b.toString(16).padStart(2, "0")).join("");
    setResultado(hex === hashPdf ? "OK — este arquivo é idêntico ao PDF registrado." : "DIFERENTE — este arquivo NÃO é o PDF registrado.");
  }
  return (
    <section style={{ marginTop: 22, fontSize: 14 }}>
      <h2 style={{ fontSize: 15, margin: "0 0 6px" }}>Conferir um PDF recebido</h2>
      <p style={{ margin: "0 0 8px", color: "#555", fontSize: 12.5 }}>Escolha o arquivo: o cálculo é feito no seu navegador e o arquivo não é enviado.</p>
      <input type="file" accept="application/pdf" onChange={(e) => void conferir(e.target.files?.[0])} />
      {resultado && <p style={{ marginTop: 10, fontWeight: 600 }}>{resultado}</p>}
    </section>
  );
}
