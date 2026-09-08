/**
 * Retraso "humano" antes de que el agente conteste (T1.2).
 *
 * Nadie contesta un WhatsApp en 200 ms. El retraso se calcula por lo que el
 * cliente escribió (un "ok" se contesta rápido; una pregunta de agenda tarda
 * más porque "alguien está mirando el calendario") y se le suma un tiempo de
 * lectura proporcional al largo, con algo de ruido para que no sea siempre
 * igual. `instant` (tests, Laboratorio) lo anula.
 */

export type DelayMode = "human" | "instant";

export type Intent = "greeting" | "ack" | "booking" | "question" | "other";

const RANGES: Record<Intent, [number, number]> = {
  greeting: [8, 20],
  ack: [6, 15],
  booking: [40, 100],
  question: [25, 70],
  other: [20, 60],
};

const GREETING = /^\s*(hola|buenas|buenos d[ií]as|buenas tardes|buenas noches|hey|ola)\b[!. ]*$/i;
const ACK = /^\s*(ok|okey|okay|dale|listo|gracias|muchas gracias|perfecto|genial|va|vale|bien|si|sí|no|claro|de acuerdo|👍|👌)\b[!. ]*$/i;
const BOOKING = /\b(cita|agend|horario|reuni[oó]n|llamada|llamar|visita|ma[ñn]ana|hoy|tarde|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|\d{1,2}\s*(am|pm|hrs|h)\b|a las \d)/i;

export function classifyIntent(text: string): Intent {
  const t = text.trim();
  if (t.length === 0) return "other";
  if (GREETING.test(t)) return "greeting";
  if (ACK.test(t)) return "ack";
  if (BOOKING.test(t)) return "booking";
  if (t.includes("?") || t.includes("¿") || t.length > 60) return "question";
  return "other";
}

export function computeDelaySec(input: {
  text: string;
  minSec: number;
  maxSec: number;
  mode: DelayMode;
  /** Inyectable para tests: devuelve [0,1). */
  rng?: () => number;
}): number {
  if (input.mode === "instant") return 0;
  const rng = input.rng ?? Math.random;
  const intent = classifyIntent(input.text);
  const [lo, hi] = RANGES[intent];
  const base = lo + (hi - lo) * rng();
  // ~30 caracteres por segundo de lectura, con tope: un pegote de texto no
  // puede convertirse en diez minutos de silencio.
  const reading = Math.min(45, input.text.length / 30);
  const jitter = 0.8 + 0.4 * rng();
  const total = (base + reading) * jitter;
  const min = Math.max(0, input.minSec);
  const max = Math.max(min, input.maxSec);
  return Math.round(Math.min(max, Math.max(min, total)));
}

/**
 * Cuánto antes de la respuesta se enciende "escribiendo…". Meta lo apaga solo
 * a los ~25 s, así que más de 20 no sirve; menos de 3 no se alcanza a ver.
 */
export function typingLeadSec(delaySec: number): number {
  if (delaySec < 6) return 0;
  return Math.min(20, Math.max(3, Math.round(delaySec * 0.4)));
}
