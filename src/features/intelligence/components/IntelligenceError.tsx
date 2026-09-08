// §18/§19 da instrução — estados de erro seguros. `mensagem` já vem
// pronta e segura de useIntelligencePanel.ts (mapeada por status HTTP);
// este componente só decide COMO mostrar, nunca decide O QUE mostrar —
// nunca recebe nem exibe stack trace, texto cru do provider ou código
// interno.
export default function IntelligenceError({ mensagem }: { mensagem: string }) {
  return (
    <p className="stx-intel-erro" role="alert">
      {mensagem}
    </p>
  );
}
