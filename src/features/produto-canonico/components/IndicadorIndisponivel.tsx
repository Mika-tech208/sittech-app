// Mensagem ÚNICA (texto exato decidido pelo dono do produto) no lugar de um indicador consultivo de produto com rotas alternativas.
import { MENSAGEM_INDICADOR_INDISPONIVEL } from "../indicadores";

export default function IndicadorIndisponivel({ inline = false, titulo }: { inline?: boolean; titulo?: string }) {
  if (inline) return <span role="status" data-indicador-indisponivel title={titulo}>{MENSAGEM_INDICADOR_INDISPONIVEL}</span>;
  return (
    <p className="stx-panel-sub" role="status" data-indicador-indisponivel style={{ margin: "6px 0", color: "var(--text-muted)", fontWeight: 600 }}>
      {titulo ? <><span style={{ fontWeight: 400 }}>{titulo}: </span></> : null}{MENSAGEM_INDICADOR_INDISPONIVEL}
    </p>
  );
}
