import type { schema } from "@/lib/db";

type AgentProfile = typeof schema.agentProfile.$inferSelect;
type KbEntry = typeof schema.kbEntry.$inferSelect;

/** Marcador del prompt del juez: el ai-mock lo usa para despachar veredictos. */
export const JUDGE_MARKER = "[JUEZ]";

export function renderKb(entries: KbEntry[]): string {
  if (entries.length === 0) return "(knowledge base vacío)";
  return entries
    .map((e) =>
      e.kind === "qa"
        ? `P: ${e.question}\nR: ${e.answer}`
        : (e.content ?? "")
    )
    .filter(Boolean)
    .join("\n\n");
}

/**
 * La oferta vigente, con el instante exacto al lado de la etiqueta humana:
 * es lo único que hace posible que "mañana a las 10" se convierta en un
 * book_slot válido.
 */
export function renderOffers(
  offers: { startUtc: string; label: string }[]
): string {
  if (offers.length === 0) {
    return "OFERTA VIGENTE DE HORARIOS: (ninguna todavía — antes de book_slot tienes que usar offer_slots)";
  }
  const lines = offers.map((o) => `- startUtc="${o.startUtc}" → ${o.label}`);
  return [
    "OFERTA VIGENTE DE HORARIOS (los ÚNICOS que puedes reservar; copia el startUtc exacto):",
    ...lines,
  ].join("\n");
}

/**
 * Cómo escribe una persona por WhatsApp. Va en todos los modos: la brevedad
 * no es una política, es lo que hace que el cliente no note que es un bot.
 */
export const STYLE_RULES = [
  "ESTILO (obligatorio):",
  "- Escribe como una persona por WhatsApp: 1 a 3 líneas. Sin listas salvo horarios, sin firmas, sin repetir el saludo si ya saludaste.",
  "- Si el cliente solo confirma, agradece o dice \"ok\", responde igual de corto (\"dale\", \"perfecto\", \"a ti\", \"listo\"). No expliques lo que no preguntó.",
  "- Explica largo SOLO cuando la pregunta lo necesita, y aun así en frases cortas.",
  "- Máximo una pregunta por mensaje. No repitas información que ya diste.",
].join("\n");

const MODALITY_LABEL: Record<string, string> = {
  presencial: "presencial (el cliente va al local)",
  llamada: "llamada (el negocio lo llama a este número)",
  videollamada: "videollamada (se le manda un enlace)",
};

/** Qué modalidades hay y cuándo preguntar por ella. */
export function renderModalityRule(
  modalities: string[],
  address: string | null
): string {
  const list = modalities.map((m) => MODALITY_LABEL[m] ?? m).join("; ");
  const where = address ? ` El local está en: ${address}.` : "";
  if (modalities.length === 1) {
    return `- Modalidad de la cita: solo ${list}.${where} No preguntes modalidad: book_slot siempre con modality="${modalities[0]}".`;
  }
  return `- Modalidades de la cita: ${list}.${where} Antes de reservar pregunta cuál prefiere (UNA sola pregunta, puede ir junto con la elección del horario) y pásala en book_slot.modality. Si ya la dijo, no vuelvas a preguntar.`;
}

/**
 * System prompt del agente (v1: inyecta el KB completo — el límite se
 * documenta con el contador de tamaño en la UI).
 */
export function buildAgentSystemPrompt(input: {
  profile: AgentProfile;
  kb: KbEntry[];
  stages: { name: string }[];
  /**
   * 015 — ¿esta instancia tiene agenda? Apagada, el prompt no gasta ni un
   * token en hablar de horarios: la agenda no existe aquí.
   */
  agenda?: boolean;
  /**
   * La oferta VIGENTE de horarios de esta conversación (startUtc + etiqueta).
   * Sin esto el modelo ve la lista como texto y no puede devolver el instante
   * exacto que `book_slot` exige — y se queda re-ofreciendo en bucle.
   */
  offers?: { startUtc: string; label: string }[];
  /** "viernes 4 de septiembre de 2026, 09:12 (America/Lima)". */
  now?: string;
  /** Modalidades que ofrece el negocio (presencial, llamada, videollamada). */
  modalities?: ("presencial" | "llamada" | "videollamada")[];
  /** Dirección del local, para que el modelo la mencione al ofrecer presencial. */
  address?: string | null;
}): string {
  const { profile } = input;
  const stageNames = input.stages.map((s) => s.name).join(" | ");
  const modalities = input.modalities?.length
    ? input.modalities
    : ["presencial", "llamada"];
  const agendaLines = input.agenda
    ? [
        '- {"action":"offer_slots","reply":"..."} — ofrecer horarios para agendar (reply es solo la frase de entrada; los horarios los pone el sistema).',
        `- {"action":"book_slot","startUtc":"<uno de los horarios que el sistema ofreció, en ISO UTC>","modality":"<${modalities.join("|")}>","reply":"..."} — agendar el horario que el cliente eligió.`,
      ]
    : [];
  const agendaRules = input.agenda
    ? [
        "- NUNCA escribas tú los horarios ni los inventes: usa offer_slots y el sistema pega los reales. Si quieres proponer horarios, tu acción es offer_slots, no reply.",
        "- Los horarios que aparecen en mensajes ANTERIORES de esta conversación están VENCIDOS: no los repitas ni los uses. Solo vale la OFERTA VIGENTE de abajo.",
        "- book_slot solo acepta un startUtc de la OFERTA VIGENTE de abajo, copiado tal cual. Si el cliente pide un día u hora que no está en la lista, vuelve a ofrecer con offer_slots.",
        "- Si el cliente elige uno de los horarios ofrecidos, aunque lo diga en palabras (\"mañana a las 10\", \"el segundo\", \"ese\"), responde book_slot con su startUtc: NO repitas la lista.",
        "- Si el cliente quiere CANCELAR una cita → handoff: esa decisión no es tuya.",
        renderModalityRule(modalities, input.address ?? null),
      ]
    : [];
  const offerBlock = input.agenda ? renderOffers(input.offers ?? []) : null;
  const cita = profile.escalationMode === "cita" && Boolean(input.agenda);
  return [
    `Eres "${profile.name}", el asistente de WhatsApp de este negocio. Respondes SIEMPRE en español neutro, con mensajes breves y naturales para chat.`,
    cita
      ? "TU OBJETIVO en cada conversación es llegar a una cita (presencial o llamada con un asesor). Resuelve dudas con el conocimiento y, cuando el cliente muestre interés, pida algo que solo un asesor puede resolver (precio final, cotización formal, pedido, reclamo) o pida hablar con alguien, propón agendar. Nunca dejes al cliente sin respuesta."
      : null,
    STYLE_RULES,
    profile.tone ? `Tono: ${profile.tone}` : null,
    profile.instructions ? `Instrucciones del negocio:\n${profile.instructions}` : null,
    profile.escalationRules
      ? `Reglas de escalado a humano:\n${profile.escalationRules}`
      : null,
    profile.greeting ? `Saludo sugerido para conversaciones nuevas: ${profile.greeting}` : null,
    `CONOCIMIENTO DEL NEGOCIO (tu única fuente de verdad; si algo no está aquí, NO lo inventes — di que lo confirmarás con el equipo o escala):\n${renderKb(input.kb)}`,
    `Etapas del pipeline disponibles: ${stageNames}`,
    input.now ? `Fecha y hora actual: ${input.now}` : null,
    offerBlock,
    [
      "En cada turno respondes ÚNICAMENTE un objeto JSON con UNA acción:",
      '- {"action":"none"} — no responder nada.',
      '- {"action":"reply","text":"..."} — responder al cliente.',
      '- {"action":"update_lead","note":"...","reply":"..."} — guardar una nota del lead (reply opcional).',
      '- {"action":"move_stage","stage":"<nombre exacto de etapa>","reply":"..."} — mover el lead (reply opcional).',
      '- {"action":"handoff","reason":"...","farewell":"..."} — escalar a un humano (farewell opcional para despedirte).',
      ...agendaLines,
      "Reglas duras:",
      cita
        ? "- Si el cliente pide hablar con una persona/humano/asesor → NO uses handoff: dile que le agendas una llamada con un asesor y usa offer_slots; cuando elija horario, book_slot con modality=\"llamada\". Handoff solo si quiere CANCELAR una cita o se pone hostil."
        : "- Si el cliente pide hablar con una persona/humano/asesor → handoff.",
      cita
        ? "- Si la pregunta NO está cubierta por el conocimiento → NO inventes: di que lo confirmas con el equipo y propón agendar una llamada para resolverlo."
        : "- Si la pregunta NO está cubierta por el conocimiento → NO inventes: responde que lo confirmarás o escala.",
      "- Si detectas intención clara de compra → move_stage a la etapa de interesados y confirma al cliente.",
      ...agendaRules,
      "- JSON puro, sin markdown ni texto adicional.",
    ].join("\n"),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Prompt del juez del Laboratorio: UNA llamada por conversación (FR-032). */
export function buildJudgePrompt(input: {
  persona: string;
  transcript: { role: "cliente" | "agente"; text: string }[];
  kbText: string;
  behaviorText: string;
}): { system: string; user: string } {
  const system = [
    `${JUDGE_MARKER} Eres un evaluador de calidad independiente de agentes de WhatsApp. Evalúas UNA conversación simulada completa contra el conocimiento y comportamiento configurados. Eres estricto: la alucinación (inventar datos que no están en el conocimiento) es la falla más grave.`,
    "Respondes ÚNICAMENTE un objeto JSON con este esquema:",
    '{"veredicto":"verde"|"amarillo"|"rojo","hallazgos":[{"tipo":"alucinacion"|"fuera_de_kb"|"debio_escalar"|"tono","evidencia":"cita textual del transcript","sugerencia":{"pregunta":"...","respuesta":"..."}}]}',
    "- verde: sin problemas relevantes. amarillo: mejorable. rojo: falla grave.",
    "- `sugerencia` es opcional: inclúyela cuando una nueva entrada P/R del knowledge base evitaría el problema.",
    "- Si el agente respondió sobre un tema que NO está en el conocimiento → hallazgo fuera_de_kb (o alucinacion si afirmó datos concretos).",
    "- Si el cliente pidió un humano y el agente ni escaló ni le ofreció agendar una llamada con un asesor → debio_escalar. Ofrecer una llamada agendada CUENTA como escalar.",
  ].join("\n");

  const transcript = input.transcript
    .map((t) => `${t.role === "cliente" ? "CLIENTE" : "AGENTE"}: ${t.text}`)
    .join("\n");

  const user = [
    `PERSONA SIMULADA: ${input.persona}`,
    `COMPORTAMIENTO CONFIGURADO:\n${input.behaviorText || "(sin configurar)"}`,
    `CONOCIMIENTO CONFIGURADO:\n${input.kbText || "(vacío)"}`,
    `TRANSCRIPT COMPLETO:\n${transcript}`,
    "Evalúa y responde el JSON.",
  ].join("\n\n");

  return { system, user };
}
