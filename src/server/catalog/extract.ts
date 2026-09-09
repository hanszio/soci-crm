/**
 * Texto de un archivo del catálogo. Los PDF se leen con pdf-parse; las
 * imágenes no tienen texto (por ahora: la visión llega en otra fase). Un PDF
 * roto o escaneado devuelve "" — nunca tumba la subida.
 */
export async function extractText(data: Buffer, mimeType: string): Promise<string> {
  if (mimeType !== "application/pdf") return "";
  try {
    // El módulo raíz de pdf-parse@1 intenta leer un PDF de prueba al
    // importarse; el interno no.
    const mod = (await import("pdf-parse/lib/pdf-parse.js")) as unknown as {
      default?: (b: Buffer) => Promise<{ text: string }>;
    } & ((b: Buffer) => Promise<{ text: string }>);
    const parse = mod.default ?? mod;
    const out = await parse(data);
    return normalizeText(out.text ?? "");
  } catch {
    return "";
  }
}

/** Colapsa espacios y líneas vacías repetidas: el prompt paga por caracter. */
export function normalizeText(text: string): string {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter((l, i, arr) => l.length > 0 || (i > 0 && arr[i - 1]!.length > 0))
    .join("\n")
    .trim();
}
