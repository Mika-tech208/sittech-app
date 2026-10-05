"use client";

// Mesma ideia do DatePicker, só que por mês — substitui <input type="month">
// nativo nos filtros da Análise de faturamento. Valor continua "YYYY-MM".

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, X } from "lucide-react";
import { brParaMonthKey, monthKeyParaBR } from "@/lib/date";

const MESES_CURTO = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

export interface MonthPickerProps {
  value: string; // "" ou "YYYY-MM"
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  id?: string;
}

export default function MonthPicker({ value, onChange, className, placeholder, id }: MonthPickerProps) {
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState(() => monthKeyParaBR(value));
  const [anoVisivel, setAnoVisivel] = useState(() => Number((value || "").slice(0, 4)) || new Date().getFullYear());
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const campoRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTexto(monthKeyParaBR(value));
    if (value) setAnoVisivel(Number(value.slice(0, 4)));
  }, [value]);

  function posicionarPopover() {
    const rect = campoRef.current?.getBoundingClientRect();
    if (!rect) return;
    const larguraPopover = 232;
    let left = rect.left;
    if (left + larguraPopover > window.innerWidth - 8) left = window.innerWidth - larguraPopover - 8;
    if (left < 8) left = 8;
    const alturaEstimada = 200;
    const cabeAbaixo = rect.bottom + alturaEstimada <= window.innerHeight - 8;
    const top = cabeAbaixo ? rect.bottom + 6 : Math.max(8, rect.top - alturaEstimada - 6);
    setPopoverPos({ top, left });
  }

  function abrirCalendario() {
    posicionarPopover();
    setAberto(true);
  }

  useEffect(() => {
    if (!aberto) return;
    function aoClicarFora(e: MouseEvent) {
      const alvo = e.target as Node;
      if (campoRef.current?.contains(alvo) || popoverRef.current?.contains(alvo)) return;
      setAberto(false);
    }
    function aoRolar() { setAberto(false); }
    function aoTeclar(e: KeyboardEvent) { if (e.key === "Escape") setAberto(false); }
    document.addEventListener("mousedown", aoClicarFora);
    window.addEventListener("scroll", aoRolar, true);
    window.addEventListener("resize", aoRolar);
    document.addEventListener("keydown", aoTeclar);
    return () => {
      document.removeEventListener("mousedown", aoClicarFora);
      window.removeEventListener("scroll", aoRolar, true);
      window.removeEventListener("resize", aoRolar);
      document.removeEventListener("keydown", aoTeclar);
    };
  }, [aberto]);

  function selecionarMes(mes: number) {
    const key = `${anoVisivel}-${String(mes).padStart(2, "0")}`;
    onChange(key);
    setTexto(monthKeyParaBR(key));
    setAberto(false);
  }

  function aoDigitar(raw: string) {
    const digitos = raw.replace(/\D/g, "").slice(0, 6);
    let formatado = digitos;
    if (digitos.length > 2) formatado = `${digitos.slice(0, 2)}/${digitos.slice(2)}`;
    setTexto(formatado);
    if (digitos.length === 0) {
      onChange("");
      return;
    }
    if (formatado.length === 7) {
      const key = brParaMonthKey(formatado);
      if (key) {
        onChange(key);
        setAnoVisivel(Number(key.slice(0, 4)));
      }
    }
  }

  function aoSairDoCampo() {
    if (texto === "") return;
    const key = brParaMonthKey(texto);
    if (!key) setTexto(monthKeyParaBR(value));
  }

  const mesSelecionadoNum = value && value.slice(0, 4) === String(anoVisivel) ? Number(value.slice(5, 7)) : null;
  const hojeKey = new Date().toISOString().slice(0, 7);

  return (
    <div className="stx-datepicker">
      <div className="stx-datepicker-campo">
        <input
          ref={campoRef}
          id={id}
          type="text"
          inputMode="numeric"
          className={className}
          value={texto}
          placeholder={placeholder || "mm/aaaa"}
          onFocus={abrirCalendario}
          onChange={(e) => aoDigitar(e.target.value)}
          onBlur={aoSairDoCampo}
        />
        {value && (
          <button
            type="button"
            className="stx-datepicker-limpar"
            aria-label="Limpar mês"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { onChange(""); setTexto(""); }}
          >
            <X size={14} />
          </button>
        )}
        <button
          type="button"
          className="stx-datepicker-icone"
          aria-label="Abrir calendário"
          onClick={() => (aberto ? setAberto(false) : abrirCalendario())}
        >
          <CalendarIcon size={16} />
        </button>
      </div>

      {aberto && popoverPos && typeof document !== "undefined" &&
        createPortal(
          <div ref={popoverRef} className="stx-datepicker-popover stx-monthpicker-popover" style={{ top: popoverPos.top, left: popoverPos.left }}>
            <div className="stx-datepicker-cabecalho">
              <button type="button" onClick={() => setAnoVisivel((a) => a - 1)} aria-label="Ano anterior"><ChevronLeft size={16} /></button>
              <span>{anoVisivel}</span>
              <button type="button" onClick={() => setAnoVisivel((a) => a + 1)} aria-label="Próximo ano"><ChevronRight size={16} /></button>
            </div>
            <div className="stx-monthpicker-grid">
              {MESES_CURTO.map((nome, i) => {
                const mes = i + 1;
                const key = `${anoVisivel}-${String(mes).padStart(2, "0")}`;
                return (
                  <button
                    type="button"
                    key={nome}
                    className={`stx-datepicker-dia ${mesSelecionadoNum === mes ? "selecionado" : ""} ${key === hojeKey ? "hoje" : ""}`}
                    onClick={() => selecionarMes(mes)}
                  >
                    {nome}
                  </button>
                );
              })}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
