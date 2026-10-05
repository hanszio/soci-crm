/**
 * Banco de respuestas: las claves y sus variantes por defecto.
 *
 * La variedad del bot sale de aquí, no de un modelo: varias formas de decir lo
 * mismo, elegidas al azar sin repetir dentro de una conversación. Cada negocio
 * las reemplaza por las suyas (escritas a mano o minadas de sus chats reales
 * con `scripts/wa-mine.mjs`); estas son el piso para que funcione desde el
 * primer día. Trato de usted: es el registro seguro para un negocio.
 *
 * Ranuras: {agente}, {negocio}.
 */

export const REPLY_KEYS = [
  "abrir",
  "ack",
  "despedida",
  "ofrecer_horarios",
  "pie_archivo",
  "fuera_de_tema",
] as const;
export type ReplyKey = (typeof REPLY_KEYS)[number];

export const REPLY_KEY_META: Record<ReplyKey, { label: string; hint: string }> = {
  abrir: {
    label: "Preguntar qué necesita",
    hint: "Después del saludo, cuando el cliente solo dijo hola.",
  },
  ack: {
    label: "Acuse corto",
    hint: "Cuando el cliente dice ok, gracias, perfecto.",
  },
  despedida: { label: "Despedida", hint: "Cuando el cliente se despide." },
  ofrecer_horarios: {
    label: "Introducir horarios",
    hint: "Frase antes de la lista de horarios disponibles.",
  },
  pie_archivo: {
    label: "Acompañar un archivo",
    hint: "Texto que va con el PDF o la imagen.",
  },
  fuera_de_tema: {
    label: "Fuera de tema",
    hint: "Cuando preguntan algo ajeno al negocio o intentan manipular al asistente.",
  },
};

export const DEFAULT_VARIANTS: Record<ReplyKey, string[]> = {
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
  ofrecer_horarios: [
    "Claro, tengo estos horarios disponibles:",
    "Con gusto. Le puedo ofrecer estos horarios:",
    "Perfecto, estos son los horarios que tengo libres:",
    "Sí, mire, tengo disponible:",
  ],
  pie_archivo: [
    "Aquí tiene la información.",
    "Le comparto el detalle.",
    "Le envío la información para que la revise.",
    "Aquí está. Cualquier duda me dice.",
  ],
  fuera_de_tema: [
    "Con eso no le puedo ayudar, pero con gusto le atiendo en lo que necesite de {negocio}.",
    "Eso no lo vemos aquí. ¿Le ayudo con algo de {negocio}?",
    "Solo puedo ayudarle con temas de {negocio}. ¿Qué necesita?",
  ],
};

export function isReplyKey(value: unknown): value is ReplyKey {
  return typeof value === "string" && (REPLY_KEYS as readonly string[]).includes(value);
}
