import { Suspense } from "react";
import ParadasPage from "@/features/producao-real/paradas/ParadasPage";

export default function Page() {
  return (
    <Suspense>
      <ParadasPage />
    </Suspense>
  );
}
