import type { Answer, ChoiceAnswer, NoulAnswer } from "@/lib/typesafe";
import type { ReplyKey } from "@/server/replies/keys";

/**
 * La política del turno: qué hacer con los juicios de Jev. Función PURA —
 * todo lo que decide se puede probar con respuestas simuladas.
 *
 * Patrón "confidence-gated routing" (https://docs.typesafe.ai/patterns/confidence-routing.md):
 * el umbral sube con el costo de equivocarse. Reservar una cita exige más que
 * decir "de nada". Lo que no alcanza su umbral sigue por el LLM, que es el
 * comportamiento de siempre.
 *
 * Umbrales medidos en J0 (scripts/jev-eval.mjs): ficha a ≥ 0.85 dio 100 % de
 * precisión; horario elegido, 100 %; intención a ≥ 0.75, 99–100 %.
 */
export const THRESHOLDS = {
  intent: 0.75,
  smallTalk: 0.6,
  ficha: 0.85,
  slot: 0.85,
  modality: 0.6,
  file: 0.85,
  human: 0.7,
  hostile: 0.75,
  injection: 0.6,
  compound: 0.5,
  offTopic: 0.85,
} as const;

export type Plan =
  | { type: "bank"; key: ReplyKey }
  | { type: "ficha"; fichaId: string }
  | { type: "book"; startUtc: string; modality: string | null }
  | { type: "offer" }
  | { type: "send"; itemId: string }
  | { type: "handoff"; reason: string }
  | { type: "llm"; reason: string };

export type RouteContext = {
  agenda: boolean;
  /** El último mensaje del asistente terminó en pregunta: un "ok" es una respuesta, no un acuse. */
  lastOutIsQuestion: boolean;
  modalities: string[];
  /** Archivos ya enviados en esta conversación (no se repiten). */
  sentItemIds: string[];
  maps: { offers: Record<string, string>; fichas: Record<string, string>; files: Record<string, string> };
};

const choice = (a: Answer | undefined): ChoiceAnswer | null => (a?.type === "choice" ? a : null);
const noul = (a: Answer | undefined): number => (a?.type === "noul" ? (a as NoulAnswer).noul : 0);

export function routeTurn(answers: Record<string, Answer>, ctx: RouteContext): Plan {
  const intent = choice(answers.intencion);
  if (!intent) return { type: "llm", reason: "sin_intencion" };

  // 1. Seguridad primero: gana aunque otra pregunta diga algo distinto.
  if (noul(answers.inyeccion) >= THRESHOLDS.injection) return { type: "bank", key: "fuera_de_tema" };
  if (noul(answers.hostil) >= THRESHOLDS.hostile) return { type: "handoff", reason: "cliente hostil" };

  const is = (name: string, min: number = THRESHOLDS.intent) =>
    intent.choice === name && intent.confidence >= min;

  if (is("cancelar_o_cambiar_cita")) return { type: "handoff", reason: "quiere cancelar o cambiar su cita" };
  if (is("pedir_humano", THRESHOLDS.smallTalk) && noul(answers.pide_humano) >= THRESHOLDS.human) {
    // La política de cierre decide después: llamada agendada o handoff.
    return { type: "handoff", reason: "pide hablar con una persona" };
  }

  // 2. Lo compuesto necesita redacción: al LLM.
  if (noul(answers.compuesta) >= THRESHOLDS.compound) return { type: "llm", reason: "compuesta" };

  // 3. Agenda.
  const slot = choice(answers.horario);
  if (ctx.agenda && slot && ctx.maps.offers[slot.choice] && slot.confidence >= THRESHOLDS.slot) {
    let modality: string | null = null;
    if (ctx.modalities.length === 1) modality = ctx.modalities[0]!;
    else {
      const m = choice(answers.modalidad);
      if (m && m.choice !== "no_dijo" && m.confidence >= THRESHOLDS.modality) modality = m.choice;
    }
    // Sin modalidad clara hay que preguntarla: eso lo redacta el LLM.
    if (!modality) return { type: "llm", reason: "falta_modalidad" };
    return { type: "book", startUtc: ctx.maps.offers[slot.choice]!, modality };
  }
  if (ctx.agenda && is("agendar")) return { type: "offer" };

  // 4. Archivos y fichas.
  const asksBusiness = is("pregunta_negocio") || is("pedir_precio_o_catalogo");
  if (asksBusiness) {
    const file = choice(answers.archivo);
    const itemId = file ? ctx.maps.files[file.choice] : undefined;
    if (
      is("pedir_precio_o_catalogo") &&
      file &&
      itemId &&
      file.confidence >= THRESHOLDS.file &&
      !ctx.sentItemIds.includes(itemId)
    ) {
      return { type: "send", itemId };
    }
    const ficha = choice(answers.ficha);
    const fichaId = ficha ? ctx.maps.fichas[ficha.choice] : undefined;
    if (ficha && fichaId && ficha.confidence >= THRESHOLDS.ficha) {
      return { type: "ficha", fichaId };
    }
    return { type: "llm", reason: "sin_ficha_segura" };
  }

  // 5. Conversación menuda: lo que más se repite y lo que menos necesita un LLM.
  if (is("saludo", THRESHOLDS.smallTalk)) return { type: "bank", key: "abrir" };
  if (is("despedida", THRESHOLDS.smallTalk)) return { type: "bank", key: "despedida" };
  if (is("confirmacion", THRESHOLDS.smallTalk)) {
    return ctx.lastOutIsQuestion
      ? { type: "llm", reason: "confirmacion_a_pregunta" }
      : { type: "bank", key: "ack" };
  }

  // Claramente ajeno al negocio: respuesta fija, sin gastar un turno de LLM.
  if (is("fuera_de_tema", THRESHOLDS.offTopic)) return { type: "bank", key: "fuera_de_tema" };

  return { type: "llm", reason: `intencion_${intent.choice}` };
}
