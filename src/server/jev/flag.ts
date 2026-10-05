import { typesafeConfig } from "@/lib/typesafe";

/**
 * Jev es un conector opcional (Constitución II, patrón ADR-001): existe solo
 * con la bandera `JEV` encendida Y una clave de TypeSafe. Apagado, el agente
 * funciona exactamente como antes.
 */
const ON_VALUES = new Set(["on", "1", "true", "si", "sí", "yes"]);

export function jevEnabled(): boolean {
  return ON_VALUES.has((process.env.JEV ?? "").trim().toLowerCase()) && typesafeConfig() !== null;
}
