// Registra os matchers do jest-dom (toBeInTheDocument, toBeDisabled, etc.)
// em tempo de execução E os tipos deles no TypeScript — sem isto, `next
// build` falha o type-check dos testes de componente mesmo que o pacote já
// esteja instalado (ele nunca era importado em lugar nenhum antes desta
// etapa de UX da Intelligence, primeiro uso de testes de componente do
// projeto).
import "@testing-library/jest-dom/vitest";
