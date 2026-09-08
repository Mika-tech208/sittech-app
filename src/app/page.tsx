import { Suspense } from "react";
import SittechApp from "@/features/legacy/SittechApp";

export default function Home() {
  return (
    <Suspense>
      <SittechApp />
    </Suspense>
  );
}
