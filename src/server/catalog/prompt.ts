/**
 * Cómo ve el modelo el catálogo: una tabla compacta para elegir qué enviar y,
 * aparte, el contenido de los PDF (con presupuesto) como conocimiento.
 */

export type CatalogForPrompt = {
  id: string;
  title: string;
  description: string | null;
  price: string | null;
  kind: "pdf" | "image";
  extractedText: string | null;
};

/** Caracteres de contenido de archivos que entran al prompt, en total. */
export const CATALOG_CONTENT_BUDGET = 12_000;
/** …y por archivo, para que uno gordo no se coma a los demás. */
export const CATALOG_PER_FILE_BUDGET = 5_000;

export function renderCatalog(items: CatalogForPrompt[]): string | null {
  if (items.length === 0) return null;
  const rows = items.map((it) => {
    const desc = (it.description ?? "").replace(/\s+/g, " ").slice(0, 80);
    return `- id="${it.id}" · ${it.kind === "pdf" ? "PDF" : "imagen"} · ${it.title}${it.price ? ` · ${it.price}` : ""}${desc ? ` — ${desc}` : ""}`;
  });
  return [
    "CATÁLOGO (archivos que puedes ENVIAR al cliente con send_product, usando el id exacto):",
    ...rows,
    "Envía un archivo cuando el cliente pida precios, muestras, fotos, la lista o el catálogo, o cuando ayude a cerrar la venta. No lo mandes sin que venga al caso ni lo repitas si ya lo enviaste en esta conversación.",
  ].join("\n");
}

export function renderCatalogContent(items: CatalogForPrompt[]): string | null {
  const withText = items.filter((it) => (it.extractedText ?? "").trim().length > 0);
  if (withText.length === 0) return null;
  let remaining = CATALOG_CONTENT_BUDGET;
  const parts: string[] = [];
  for (const it of withText) {
    if (remaining <= 0) break;
    const text = (it.extractedText ?? "").slice(0, Math.min(CATALOG_PER_FILE_BUDGET, remaining));
    remaining -= text.length;
    parts.push(`[${it.title}]\n${text}`);
  }
  return [
    "CONTENIDO DE LOS ARCHIVOS DEL CATÁLOGO (fuente de verdad para precios y detalles; cita lo que diga aquí):",
    ...parts,
  ].join("\n\n");
}
