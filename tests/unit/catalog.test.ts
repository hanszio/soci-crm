import { describe, expect, it } from "vitest";
import {
  CATALOG_CONTENT_BUDGET,
  CATALOG_PER_FILE_BUDGET,
  renderCatalog,
  renderCatalogContent,
} from "@/server/catalog/prompt";
import { normalizeText } from "@/server/catalog/extract";
import { AgentAction, degradeAction } from "@/server/ai/actions";
import { aiMockCompletion } from "@/server/dev/ai-mock";

/**
 * T5.1 — Catálogo del agente. Lo que se fija: el modelo ve ids exactos y
 * contenido acotado; un id inválido se degrada a texto; y el mock lo ejercita
 * en E2E sin inventar ids.
 */

const items = [
  { id: "cat_1", title: "Lista de precios", description: "cuando pidan precios", price: "desde S/ 80", kind: "pdf" as const, extractedText: "Tarjetas millar S/ 80\nLaminado S/ 110" },
  { id: "cat_2", title: "Muestras", description: null, price: null, kind: "image" as const, extractedText: null },
];

describe("renderCatalog", () => {
  it("lista id, tipo, título y precio; vacío ⇒ null", () => {
    const out = renderCatalog(items)!;
    expect(out).toContain('id="cat_1" · PDF · Lista de precios · desde S/ 80 — cuando pidan precios');
    expect(out).toContain('id="cat_2" · imagen · Muestras');
    expect(renderCatalog([])).toBeNull();
  });
});

describe("renderCatalogContent", () => {
  it("solo entran los archivos con texto, y con presupuesto", () => {
    const out = renderCatalogContent(items)!;
    expect(out).toContain("[Lista de precios]");
    expect(out).toContain("Tarjetas millar S/ 80");
    expect(out).not.toContain("[Muestras]");
    const big = Array.from({ length: 5 }, (_, i) => ({
      ...items[0]!,
      id: `cat_big_${i}`,
      title: `Doc ${i}`,
      extractedText: "x".repeat(CATALOG_PER_FILE_BUDGET * 2),
    }));
    const text = renderCatalogContent(big)!;
    expect(text.length).toBeLessThan(CATALOG_CONTENT_BUDGET + 600);
    expect(text).toContain("[Doc 0]");
    expect(text).not.toContain("[Doc 4]");
  });
});

describe("normalizeText", () => {
  it("colapsa espacios y líneas vacías repetidas", () => {
    expect(normalizeText("  a   b \r\n\n\n\n c\t d  \n")).toBe("a b\n\nc d");
  });
});

describe("send_product", () => {
  it("es una acción válida y se degrada a reply/none", () => {
    const parsed = AgentAction.parse({ action: "send_product", itemId: "cat_1", caption: "Aquí va" });
    expect(parsed.action).toBe("send_product");
    expect(degradeAction(parsed)).toEqual({ action: "reply", text: "Aquí va" });
    expect(degradeAction({ action: "send_product", itemId: "cat_1" })).toEqual({ action: "none" });
  });

  it("el mock manda el primer archivo del catálogo cuando piden precios", () => {
    const system = 'CATÁLOGO (archivos…):\n- id="cat_9" · PDF · Lista';
    const out = JSON.parse(
      aiMockCompletion([
        { role: "system", content: system },
        { role: "user", content: "me pasas la lista de precios?" },
      ])
    );
    expect(out).toMatchObject({ action: "send_product", itemId: "cat_9" });
    const none = JSON.parse(
      aiMockCompletion([{ role: "system", content: "sin catálogo" }, { role: "user", content: "precios?" }])
    );
    expect(none.action).toBe("reply");
  });
});
