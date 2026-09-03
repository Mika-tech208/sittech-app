import { Suspense } from "react";
import FuncionariosPage from "@/features/producao-real/funcionarios/FuncionariosPage";

export default function Page() {
  return (
    <Suspense>
      <FuncionariosPage />
    </Suspense>
  );
}
