import { Suspense } from "react";
import IndicadoresProducaoPage from "@/features/producao-real/indicadores/IndicadoresProducaoPage";

export default function Page() {
  return (
    <Suspense>
      <IndicadoresProducaoPage />
    </Suspense>
  );
}
