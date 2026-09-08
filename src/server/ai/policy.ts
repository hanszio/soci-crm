import type { AgentActionType } from "@/server/ai/actions";

/**
 * Política de cierre del agente: qué pasa cuando alguien pide un humano o
 * cuando el modelo quiere escalar.
 *
 * `cita` (Soci): el dueño no vive en el dashboard. Escalar "en silencio" deja
 * al cliente sin respuesta hasta que alguien mire la bandeja — que puede ser
 * nunca. Así que pedir un humano se convierte en agendar una LLAMADA con un
 * asesor, y el agente solo se calla DESPUÉS de una cita (o cuando de verdad
 * no hay nada más que hacer: cancelar, hostilidad).
 *
 * `humano` (Vocero clásico): pedir un humano pausa la IA de inmediato.
 */
export type EscalationMode = "cita" | "humano";

export type EscalationDecision =
  /** Pausar la IA y avisar. */
  | { kind: "handoff" }
  /** Proponer una llamada agendada con un asesor. */
  | { kind: "offer_call" };

export const CALL_OFFER_INTRO =
  "Claro, te agendo una llamada con un asesor. ¿Qué horario te acomoda?";

/** Motivos que sí ameritan pausar aunque la política sea `cita`. */
const ALWAYS_HANDOFF = /cancel|hostil|insult|agresi|amenaz|reclam/i;

export function decideEscalation(input: {
  mode: EscalationMode;
  /** ¿Esta instancia tiene agenda? Sin agenda no hay llamada que ofrecer. */
  agenda: boolean;
  /** ¿El cliente ya tiene una cita activa? Entonces pedir humano es escalar. */
  hasActiveBooking: boolean;
  /** Lo que dijo el modelo (o null si vino de la regex de respaldo). */
  reason?: string | null;
}): EscalationDecision {
  if (input.mode !== "cita" || !input.agenda || input.hasActiveBooking) {
    return { kind: "handoff" };
  }
  if (input.reason && ALWAYS_HANDOFF.test(input.reason)) {
    return { kind: "handoff" };
  }
  return { kind: "offer_call" };
}

/** Intentos antes de rendirse cuando el proveedor de IA falla. */
export const PROVIDER_RETRY_DELAYS_MS = [30_000, 120_000, 300_000] as const;

export function nextProviderRetry(attempt: number): number | null {
  return PROVIDER_RETRY_DELAYS_MS[attempt] ?? null;
}

/** Lo que se le dice al cliente cuando ya no hay más reintentos. */
export const PROVIDER_DOWN_REPLY =
  "Dame unos minutos y te confirmo por aquí.";

/** Lo que se añade a la confirmación de una cita antes de que el agente se calle. */
export const AFTER_BOOKING_FAREWELL =
  "Cualquier cambio me escribes por aquí y el equipo te ayuda.";

export function isHandoffAction(
  action: AgentActionType
): action is Extract<AgentActionType, { action: "handoff" }> {
  return action.action === "handoff";
}
