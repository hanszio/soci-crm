import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  anonymize,
  detectBusinessAuthor,
  normalizeForDedupe,
  parseWhatsAppExport,
  splitGreetingAndQuestion,
  toExchanges,
} from "@/server/replies/wa-export";

/**
 * Minar chats reales exportados de WhatsApp. Lo frágil es el formato: cambia
 * entre Android, iOS e idioma. Estos fixtures son los tres que se ven en Perú.
 */
const DIR = path.join(__dirname, "../fixtures/wa-export");
const chats = readdirSync(DIR)
  .filter((f) => f.endsWith(".txt"))
  .sort()
  .map((f) => parseWhatsAppExport(readFileSync(path.join(DIR, f), "utf8")));

describe("parseWhatsAppExport", () => {
  it("lee Android (12 h y 24 h) e iOS, sin avisos del sistema ni multimedia", () => {
    const all = chats.flat();
    // iOS trae el aviso de cifrado y los adjuntos CON autor: también se van.
    expect(all.some((m) => /cifrados|Multimedia omitido|audio omitido|adjunto:/i.test(m.text))).toBe(false);
    expect(all.filter((m) => m.author === "Estudio Contable Andes").length).toBe(17);
  });

  it("une las líneas de continuación al mensaje anterior", () => {
    const multi = chats.flat().find((m) => m.text.startsWith("Sí, vemos planillas"));
    expect(multi?.text).toContain("\nTrabajamos desde 1 trabajador.");
  });
});

describe("detectBusinessAuthor", () => {
  it("es el autor que aparece en todos los chats", () => {
    expect(detectBusinessAuthor(chats)).toBe("Estudio Contable Andes");
  });
  it("con un solo chat no adivina: necesita la pista", () => {
    expect(detectBusinessAuthor([chats[0]!])).toBeNull();
    expect(detectBusinessAuthor([chats[0]!], "andes")).toBe("Estudio Contable Andes");
  });
});

describe("toExchanges", () => {
  it("agrupa ráfaga del cliente → ráfaga del negocio", () => {
    const ex = toExchanges(chats.find((c) => c.some((m) => m.author === "Rosa Quispe"))!, "Estudio Contable Andes");
    expect(ex[0]!.customer).toBe("Buenos días\nquisiera saber cuanto cobran por llevar la contabilidad de mi bodega");
    expect(ex[0]!.replies).toHaveLength(2);
    expect(ex[0]!.customerName).toBe("Rosa Quispe");
  });
});

describe("anonymize", () => {
  it("descarta lo que lleva el nombre del cliente y tapa teléfonos y correos", () => {
    expect(anonymize("Listo Rosa, queda agendada su llamada", "Rosa Quispe")).toBeNull();
    expect(anonymize("Escríbanos a hola@andes.pe o al 987 654 321", "Luis")).toBe(
      "Escríbanos a [correo] o al [teléfono]"
    );
    expect(anonymize("A usted, que tenga buen día", "+51 912 345 678")).toBe("A usted, que tenga buen día");
  });
});

describe("utilidades", () => {
  it("separa saludo y pregunta", () => {
    expect(splitGreetingAndQuestion("Hola, buenas tardes. Carmen del Estudio, ¿en qué le puedo ayudar?")).toEqual({
      greeting: "Hola, buenas tardes. Carmen del Estudio",
      question: "¿en qué le puedo ayudar?",
    });
    expect(splitGreetingAndQuestion("Buenas. Digame en que le ayudo?")).toEqual({
      greeting: "Buenas.",
      question: "Digame en que le ayudo?",
    });
  });
  it("normaliza para deduplicar", () => {
    expect(normalizeForDedupe("¡De nada!  ")).toBe(normalizeForDedupe("de nada"));
  });
});
