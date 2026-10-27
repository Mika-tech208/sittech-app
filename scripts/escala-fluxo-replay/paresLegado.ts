// Par legado do Conector semeado como em PROD (spec §5): convencional 27c229d7…, automática a027ac97…; Etiquetar e Embalar comuns.
import type { ParLegado } from "@/features/escala/fluxo";
export const PARES_LEGADO_PROD: ParLegado[] = [{
  id: "conector-3-4",
  produtoConvencionalId: "27c229d7-f192-41eb-aad1-0c69ece53eba",
  produtoAutomaticaId: "a027ac97-ffd1-4834-8ed0-d3a94aac4aee",
  etapasComuns: [
    { rotulo: "Etiquetar", etapaConvencionalId: "34371af3-2608-42cc-9ded-1f7815a635a8", etapaAutomaticaId: "1863b452-77f3-4d5c-9c49-a6d28ae77131" },
    { rotulo: "Embalar", etapaConvencionalId: "b3db9629-c3f8-46d8-b4dd-64c9a61a5bc4", etapaAutomaticaId: "fb96d08d-bd64-43d3-8694-40230c695c39" },
  ],
}];
