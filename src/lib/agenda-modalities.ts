/**
 * Modalidades de cita: cómo se atiende al cliente. Vive en `lib/` porque la
 * interfaz (Ajustes → Agenda, Citas) y el servidor necesitan la misma lista.
 *
 * Solo `videollamada` necesita un enlace por cita; las otras dos necesitan que
 * el dueño se entere (evento en su calendario) y nada más.
 */

export type Modality = "presencial" | "llamada" | "videollamada";

export const MODALITY_ORDER: readonly Modality[] = [
  "presencial",
  "llamada",
  "videollamada",
];

export type ModalityMeta = {
  label: string;
  /** Para la pantalla de Ajustes. */
  description: string;
  /** ¿La cita promete un enlace (Meet/Zoom/sala fija)? */
  needsLink: boolean;
  /** ¿La confirmación al cliente lleva la dirección del negocio? */
  needsAddress: boolean;
};

export const MODALITY_META: Record<Modality, ModalityMeta> = {
  presencial: {
    label: "Presencial",
    description: "El cliente va al local. La confirmación lleva la dirección.",
    needsLink: false,
    needsAddress: true,
  },
  llamada: {
    label: "Llamada",
    description: "El negocio llama al cliente a su número de WhatsApp.",
    needsLink: false,
    needsAddress: false,
  },
  videollamada: {
    label: "Videollamada",
    description: "Cada cita genera su enlace (Meet, Zoom o tu sala fija).",
    needsLink: true,
    needsAddress: false,
  },
};

/** Lo que ofrece una instancia recién encendida: sin depender de un enlace. */
export const DEFAULT_MODALITIES: readonly Modality[] = ["presencial", "llamada"];

export function isModality(value: unknown): value is Modality {
  return (
    typeof value === "string" &&
    (MODALITY_ORDER as readonly string[]).includes(value)
  );
}

/** Deduplica, descarta lo desconocido y ordena como el catálogo. */
export function normalizeModalities(input: unknown): Modality[] {
  if (!Array.isArray(input)) return [];
  const set = new Set(input.filter(isModality));
  return MODALITY_ORDER.filter((m) => set.has(m));
}

/**
 * Qué modalidad lleva una cita. La pedida gana si está permitida; si no, y
 * solo hay una permitida, esa; si hay varias y no se pidió ninguna, la primera
 * del catálogo que el negocio permita. Nunca null: toda cita tiene modalidad.
 */
export function resolveModality(
  requested: string | null | undefined,
  allowed: readonly Modality[]
): Modality {
  const pool = allowed.length > 0 ? allowed : DEFAULT_MODALITIES;
  if (isModality(requested) && pool.includes(requested)) return requested;
  return pool[0]!;
}
