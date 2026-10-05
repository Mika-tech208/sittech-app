"use client";

// Campo de data padrão do Sittech — substitui <input type="date"> nativo
// (cujo formato visual depende do locale do SO/navegador) por um campo
// dd/mm/aaaa consistente + calendário em popover. Valor que entra/sai
// continua sempre ISO (YYYY-MM-DD), igual ao input nativo que substitui —
// nenhum filtro/form precisa mudar o que guarda no state.
//
// Digitar continua funcionando (com máscara dd/mm/aaaa automática);
// clicar no campo OU no ícone abre o calendário. Só o clique no ícone
// nunca foca o campo de texto — evita abrir teclado no mobile quando a
// pessoa só queria escolher visualmente.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, X } from "lucide-react";
import { brParaISO, isoParaBR } from "@/lib/date";

const DIAS_SEMANA = ["D", "S", "T", "Q", "Q", "S", "S"];
const MESES_CURTO = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

export interface DatePickerProps {
  value: string; // "" ou "YYYY-MM-DD"
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  max?: string; // "YYYY-MM-DD"
  min?: string;
  autoFocus?: boolean;
  id?: string;
}

function diasDoGrid(mesRef: string): { data: string; noMes: boolean }[] {
  const [ano, mes] = mesRef.split("-").map(Number);
  const primeiroDoMes = new Date(ano, mes - 1, 1);
  const inicioGrid = new Date(primeiroDoMes);
  inicioGrid.setDate(inicioGrid.getDate() - primeiroDoMes.getDay());
  const dias: { data: string; noMes: boolean }[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(inicioGrid);
    d.setDate(inicioGrid.getDate() + i);
    dias.push({
      data: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
      noMes: d.getMonth() === mes - 1,
    });
  }
  return dias;
}

export default function DatePicker({ value, onChange, className, placeholder, max, min, autoFocus, id }: DatePickerProps) {
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState(() => isoParaBR(value));
  const [mesVisivel, setMesVisivel] = useState(() => (value || "").slice(0, 7) || new Date().toISOString().slice(0, 7));
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const campoRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTexto(isoParaBR(value));
    if (value) setMesVisivel(value.slice(0, 7));
  }, [value]);

  function posicionarPopover() {
    const rect = campoRef.current?.getBoundingClientRect();
    if (!rect) return;
    const larguraPopover = 272;
    let left = rect.left;
    if (left + larguraPopover > window.innerWidth - 8) left = window.innerWidth - larguraPopover - 8;
    if (left < 8) left = 8;
    const alturaEstimada = 320;
    const cabeAbaixo = rect.bottom + alturaEstimada <= window.innerHeight - 8;
    const top = cabeAbaixo ? rect.bottom + 6 : Math.max(8, rect.top - alturaEstimada - 6);
    setPopoverPos({ top, left });
  }

  function textoParaISOOuHoje(t: string): string {
    return brParaISO(t) || new Date().toISOString().slice(0, 10);
  }

  function abrirCalendario() {
    setMesVisivel((value || textoParaISOOuHoje(texto)).slice(0, 7));
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
    function aoRolar() {
      setAberto(false);
    }
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape") setAberto(false);
    }
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

  function selecionarDia(iso: string) {
    if (max && iso > max) return;
    if (min && iso < min) return;
    onChange(iso);
    setTexto(isoParaBR(iso));
    setAberto(false);
  }

  function aoDigitar(raw: string) {
    const digitos = raw.replace(/\D/g, "").slice(0, 8);
    let formatado = digitos;
    if (digitos.length > 4) formatado = `${digitos.slice(0, 2)}/${digitos.slice(2, 4)}/${digitos.slice(4)}`;
    else if (digitos.length > 2) formatado = `${digitos.slice(0, 2)}/${digitos.slice(2)}`;
    setTexto(formatado);
    if (digitos.length === 0) {
      onChange("");
      return;
    }
    if (formatado.length === 10) {
      const iso = brParaISO(formatado);
      if (iso && !(max && iso > max) && !(min && iso < min)) {
        onChange(iso);
        setMesVisivel(iso.slice(0, 7));
      }
    }
  }

  function aoSairDoCampo() {
    if (texto === "") return;
    const iso = brParaISO(texto);
    if (!iso || (max && iso > max) || (min && iso < min)) {
      setTexto(isoParaBR(value));
    }
  }

  const dias = useMemo(() => diasDoGrid(mesVisivel), [mesVisivel]);
  const [anoVisivel, mesNumVisivel] = mesVisivel.split("-").map(Number);
  const hojeISO = new Date().toISOString().slice(0, 10);

  function mudarMes(delta: number) {
    const d = new Date(anoVisivel, mesNumVisivel - 1 + delta, 1);
    setMesVisivel(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

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
          placeholder={placeholder || "dd/mm/aaaa"}
          autoFocus={autoFocus}
          onFocus={abrirCalendario}
          onChange={(e) => aoDigitar(e.target.value)}
          onBlur={aoSairDoCampo}
        />
        {value && (
          <button
            type="button"
            className="stx-datepicker-limpar"
            aria-label="Limpar data"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onChange("");
              setTexto("");
            }}
          >
            <X size={14} />
          </button>
        )}
        <button
          type="button"
          className="stx-datepicker-icone"
          aria-label="Abrir calendário"
          onClick={() => {
            if (aberto) {
              setAberto(false);
            } else {
              abrirCalendario();
            }
          }}
        >
          <CalendarIcon size={16} />
        </button>
      </div>

      {aberto && popoverPos && typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popoverRef}
            className="stx-datepicker-popover"
            style={{ top: popoverPos.top, left: popoverPos.left }}
          >
            <div className="stx-datepicker-cabecalho">
              <button type="button" onClick={() => mudarMes(-1)} aria-label="Mês anterior"><ChevronLeft size={16} /></button>
              <span>{MESES_CURTO[mesNumVisivel - 1]} de {anoVisivel}</span>
              <button type="button" onClick={() => mudarMes(1)} aria-label="Próximo mês"><ChevronRight size={16} /></button>
            </div>
            <div className="stx-datepicker-semana">
              {DIAS_SEMANA.map((d, i) => <span key={i}>{d}</span>)}
            </div>
            <div className="stx-datepicker-grid">
              {dias.map(({ data, noMes }) => {
                const desabilitado = (!!max && data > max) || (!!min && data < min);
                const selecionado = data === value;
                const hoje = data === hojeISO;
                return (
                  <button
                    type="button"
                    key={data}
                    disabled={desabilitado}
                    className={`stx-datepicker-dia ${noMes ? "" : "fora-do-mes"} ${selecionado ? "selecionado" : ""} ${hoje ? "hoje" : ""}`}
                    onClick={() => selecionarDia(data)}
                  >
                    {Number(data.slice(8, 10))}
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
