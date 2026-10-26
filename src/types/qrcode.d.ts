// Declaração mínima do pacote `qrcode` (sem @types): só o que o relatório usa — a matriz de módulos do QR, desenhada como vetor no PDF.
declare module "qrcode" {
  export interface QRCodeModel { modules: { size: number; get(row: number, col: number): number } }
  export function create(text: string, options?: { errorCorrectionLevel?: "L" | "M" | "Q" | "H" }): QRCodeModel;
  const QRCode: { create: typeof create };
  export default QRCode;
}
