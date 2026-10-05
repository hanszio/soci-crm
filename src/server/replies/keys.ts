/**
 * Banco de respuestas: las claves y sus variantes de fábrica.
 *
 * La variedad del bot sale de aquí, no de un modelo: varias formas de decir lo
 * mismo, elegidas al azar sin repetir dentro de una conversación. Cada negocio
 * las reemplaza por las suyas (escritas a mano o minadas de sus chats reales
 * con `pnpm wa:mine`); estas son el piso para que funcione desde el primer día.
 *
 * Todas las frases fijas del agente viven aquí —también las de agenda y las de
 * sistema— para que respeten el trato del negocio (tú o usted): una frase en
 * "tú" en medio de una conversación de "usted" delata al bot.
 *
 * Ranuras: {agente}, {negocio}, {horario}, {direccion}.
 */

export type Formality = "usted" | "tu";

export const REPLY_KEYS = [
  "abrir",
  "ack",
  "despedida",
  "fuera_de_tema",
  "ofrecer_horarios",
  "ofrecer_llamada",
  "cita_confirmada",
  "cita_llamada",
  "cita_presencial",
  "cita_enlace_pendiente",
  "cita_cierre",
  "sin_horarios",
  "horario_ocupado",
  "reofrecer_horarios",
  "no_pude_agendar",
  "pie_archivo",
  "pasar_a_asesor",
  "espera",
] as const;
export type ReplyKey = (typeof REPLY_KEYS)[number];

export const REPLY_KEY_META: Record<ReplyKey, { label: string; hint: string; group: "Conversación" | "Agenda" | "Otros" }> = {
  abrir: { group: "Conversación", label: "Preguntar qué necesita", hint: "Después del saludo, cuando el cliente solo dijo hola." },
  ack: { group: "Conversación", label: "Acuse corto", hint: "Cuando el cliente dice ok, gracias, perfecto." },
  despedida: { group: "Conversación", label: "Despedida", hint: "Cuando el cliente se despide." },
  fuera_de_tema: { group: "Conversación", label: "Fuera de tema", hint: "Preguntas ajenas al negocio o intentos de manipular al asistente." },
  ofrecer_horarios: { group: "Agenda", label: "Introducir horarios", hint: "Frase antes de la lista de horarios." },
  ofrecer_llamada: { group: "Agenda", label: "Ofrecer una llamada", hint: "Cuando piden hablar con una persona: se propone agendar una llamada." },
  cita_confirmada: { group: "Agenda", label: "Cita confirmada", hint: "Usa {horario}." },
  cita_llamada: { group: "Agenda", label: "Cita por llamada", hint: "Línea extra cuando la cita es una llamada." },
  cita_presencial: { group: "Agenda", label: "Cita presencial", hint: "Línea extra con el lugar. Usa {direccion}." },
  cita_enlace_pendiente: { group: "Agenda", label: "Enlace pendiente", hint: "Videollamada cuyo enlace aún no está listo." },
  cita_cierre: { group: "Agenda", label: "Cierre tras agendar", hint: "Última línea de la confirmación." },
  sin_horarios: { group: "Agenda", label: "Sin horarios libres", hint: "Cuando la agenda está llena." },
  horario_ocupado: { group: "Agenda", label: "Horario recién ocupado", hint: "Antes de volver a ofrecer." },
  reofrecer_horarios: { group: "Agenda", label: "Volver a ofrecer", hint: "Cuando el horario pedido no estaba en la lista." },
  no_pude_agendar: { group: "Agenda", label: "No se pudo agendar", hint: "Fallo al reservar." },
  pie_archivo: { group: "Otros", label: "Acompañar un archivo", hint: "Texto que va con el PDF o la imagen." },
  pasar_a_asesor: { group: "Otros", label: "Pasar a una persona", hint: "Antes de dejar la conversación al equipo." },
  espera: { group: "Otros", label: "Pedir un momento", hint: "Cuando algo falla y el equipo va a responder." },
};

const USTED: Record<ReplyKey, string[]> = {
  abrir: [
    "Sí, dígame, ¿en qué podemos ayudarle?",
    "Cuénteme, ¿qué necesita?",
    "¿En qué le puedo ayudar?",
    "Dígame, ¿qué está buscando?",
    "Claro, ¿en qué le ayudo?",
  ],
  ack: ["De nada.", "Perfecto.", "A usted.", "Listo, quedo atento.", "Con gusto.", "Muy bien."],
  despedida: [
    "Gracias a usted, que tenga buen día.",
    "Hasta luego, cualquier cosa me escribe.",
    "Que le vaya bien, aquí estamos.",
    "Gracias por escribirnos. Hasta pronto.",
  ],
  fuera_de_tema: [
    "Con eso no le puedo ayudar, pero con gusto le atiendo en lo que necesite de {negocio}.",
    "Eso no lo vemos aquí. ¿Le ayudo con algo de {negocio}?",
    "Solo puedo ayudarle con temas de {negocio}. ¿Qué necesita?",
  ],
  ofrecer_horarios: [
    "Claro, tengo estos horarios disponibles:",
    "Con gusto. Le puedo ofrecer estos horarios:",
    "Perfecto, estos son los horarios que tengo libres:",
    "Sí, mire, tengo disponible:",
  ],
  ofrecer_llamada: [
    "Claro, le agendo una llamada con un asesor. ¿Qué horario le acomoda?",
    "Con gusto. Coordinemos una llamada con un asesor, ¿cuál de estos horarios le queda mejor?",
    "Por supuesto, un asesor le llama. ¿Qué horario prefiere?",
  ],
  cita_confirmada: [
    "Listo, quedó agendado para {horario}.",
    "Perfecto, le agendé para {horario}.",
    "Hecho. Su cita queda para {horario}.",
  ],
  cita_llamada: ["Le llamamos a este mismo número.", "La llamada será a este mismo número.", "Le marcamos a este número."],
  cita_presencial: ["Le esperamos en {direccion}.", "Nos vemos en {direccion}.", "La dirección es {direccion}."],
  cita_enlace_pendiente: ["En un momento le comparto el enlace por aquí.", "Le envío el enlace por aquí en breve."],
  cita_cierre: [
    "Cualquier cambio me escribe por aquí.",
    "Si necesita mover la cita, me avisa por este medio.",
    "Cualquier cosa, nos escribe por aquí.",
  ],
  sin_horarios: [
    "Por ahora no me quedan horarios libres. Lo confirmo con el equipo y le aviso.",
    "En este momento la agenda está completa. Lo reviso con el equipo y le escribo.",
  ],
  horario_ocupado: ["Se me acaba de ocupar ese horario, disculpe. Tengo estos:", "Ese horario ya no está libre, disculpe. Le quedan estos:"],
  reofrecer_horarios: ["Le confirmo los horarios que tengo:", "Mire, estos son los horarios disponibles:"],
  no_pude_agendar: [
    "No pude agendarlo en este momento. Lo reviso con el equipo y le confirmo.",
    "Tuve un problema al agendar. Lo veo con el equipo y le escribo.",
  ],
  pie_archivo: [
    "Aquí tiene la información.",
    "Le comparto el detalle.",
    "Le envío la información para que la revise.",
    "Aquí está. Cualquier duda me dice.",
  ],
  pasar_a_asesor: [
    "Claro, le paso con un asesor. En un momento le atiende.",
    "Enseguida le atiende una persona del equipo.",
    "Le comunico con el equipo, en breve le escriben.",
  ],
  espera: ["Deme unos minutos y le confirmo por aquí.", "Permítame un momento, ya le respondo.", "Lo reviso y le escribo enseguida."],
};

const TU: Record<ReplyKey, string[]> = {
  abrir: ["Cuéntame, ¿qué necesitas?", "¿En qué te puedo ayudar?", "Dime, ¿qué estás buscando?", "Claro, ¿en qué te ayudo?", "¿Qué necesitas?"],
  ack: ["De nada.", "Perfecto.", "A ti.", "Listo, aquí estoy.", "Con gusto.", "Dale."],
  despedida: [
    "Gracias a ti, que tengas buen día.",
    "Hasta luego, cualquier cosa me escribes.",
    "Que te vaya bien, aquí estamos.",
    "Gracias por escribirnos. Hasta pronto.",
  ],
  fuera_de_tema: [
    "Con eso no te puedo ayudar, pero con gusto te atiendo en lo que necesites de {negocio}.",
    "Eso no lo vemos aquí. ¿Te ayudo con algo de {negocio}?",
    "Solo puedo ayudarte con temas de {negocio}. ¿Qué necesitas?",
  ],
  ofrecer_horarios: [
    "Claro, tengo estos horarios disponibles:",
    "Con gusto. Te puedo ofrecer estos horarios:",
    "Perfecto, estos son los horarios que tengo libres:",
    "Mira, tengo disponible:",
  ],
  ofrecer_llamada: [
    "Claro, te agendo una llamada con un asesor. ¿Qué horario te acomoda?",
    "Con gusto. Coordinemos una llamada con un asesor, ¿cuál de estos horarios te queda mejor?",
    "Por supuesto, un asesor te llama. ¿Qué horario prefieres?",
  ],
  cita_confirmada: ["¡Listo! Te agendé para {horario}.", "Perfecto, quedó para {horario}.", "Hecho. Tu cita queda para {horario}."],
  cita_llamada: ["Te llamamos a este mismo número.", "La llamada será a este mismo número.", "Te marcamos a este número."],
  cita_presencial: ["Te esperamos en {direccion}.", "Nos vemos en {direccion}.", "La dirección es {direccion}."],
  cita_enlace_pendiente: ["En un momento te comparto el enlace por aquí.", "Te envío el enlace por aquí en breve."],
  cita_cierre: [
    "Cualquier cambio me escribes por aquí.",
    "Si necesitas mover la cita, me avisas por aquí.",
    "Cualquier cosa, nos escribes por aquí.",
  ],
  sin_horarios: [
    "Por ahora no me quedan horarios libres. Lo confirmo con el equipo y te aviso.",
    "En este momento la agenda está completa. Lo reviso con el equipo y te escribo.",
  ],
  horario_ocupado: ["Se me acaba de ocupar ese horario, ¡perdón! Tengo estos:", "Ese horario ya no está libre, disculpa. Te quedan estos:"],
  reofrecer_horarios: ["Te confirmo los horarios que tengo:", "Mira, estos son los horarios disponibles:"],
  no_pude_agendar: [
    "No pude agendarlo en este momento. Lo reviso con el equipo y te confirmo.",
    "Tuve un problema al agendar. Lo veo con el equipo y te escribo.",
  ],
  pie_archivo: ["Aquí tienes la información.", "Te comparto el detalle.", "Te envío la información para que la revises.", "Aquí está. Cualquier duda me dices."],
  pasar_a_asesor: [
    "Claro, te paso con un asesor. En un momento te atiende.",
    "Enseguida te atiende una persona del equipo.",
    "Te comunico con el equipo, en breve te escriben.",
  ],
  espera: ["Dame unos minutos y te confirmo por aquí.", "Dame un momento, ya te respondo.", "Lo reviso y te escribo enseguida."],
};

export function defaultVariants(formality: Formality): Record<ReplyKey, string[]> {
  return formality === "tu" ? TU : USTED;
}
/** Las de "usted": el registro seguro cuando no se sabe. */
export const DEFAULT_VARIANTS = USTED;

export function isReplyKey(value: unknown): value is ReplyKey {
  return typeof value === "string" && (REPLY_KEYS as readonly string[]).includes(value);
}
