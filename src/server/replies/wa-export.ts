/**
 * Lee chats exportados de WhatsApp ("Exportar chat" → sin archivos) y los
 * convierte en material para el banco de respuestas: lo que el negocio YA
 * contesta, con sus propias palabras.
 *
 * Solo funciones puras: el formato del export cambia por plataforma e idioma,
 * y aquí es donde se rompe. Formatos cubiertos:
 *   Android  5/10/26, 10:31 a. m. - Nombre: texto        (también 24 h y dd/mm/yyyy)
 *   iOS      [5/10/26, 10:31:22 a. m.] Nombre: texto
 * Las líneas sin "Nombre:" son avisos del sistema; las que no abren con fecha
 * continúan el mensaje anterior.
 */

export type ExportMessage = { author: string; text: string; at: string };

const INVISIBLE = /[‎‏‪-‮﻿]/g;
const HEAD =
  /^\[?(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]\.?\s*m\.?)?)\]?\s*(?:-\s*)?(.*)$/i;
const MEDIA =
  /^<?(adjunto:|attached:|los mensajes y las llamadas est[aá]n cifrados|messages and calls are end-to-end|multimedia omitido|media omitted|imagen omitida|audio omitido|video omitido|sticker omitido|documento omitido|gif omitido|archivo adjunto|image omitted|se elimin[oó] este mensaje|eliminaste este mensaje|this message was deleted|llamada perdida|ubicaci[oó]n:)/i;

export function parseWhatsAppExport(raw: string): ExportMessage[] {
  const out: ExportMessage[] = [];
  const lines = raw.replace(INVISIBLE, "").replace(/ | /g, " ").split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(HEAD);
    if (m) {
      const rest = m[3] ?? "";
      const sep = rest.indexOf(": ");
      // Sin "Nombre: " es un aviso del sistema (cifrado, cambió el número…).
      if (sep <= 0 || sep > 60) continue;
      out.push({ author: rest.slice(0, sep).trim(), text: rest.slice(sep + 2).trim(), at: `${m[1]} ${m[2]}` });
    } else if (out.length > 0 && line.trim()) {
      out[out.length - 1]!.text += `\n${line.trim()}`;
    }
  }
  return out.filter((msg) => msg.text && !MEDIA.test(msg.text.replace(/^<|>$/g, "").trim()) && !MEDIA.test(msg.text));
}

/**
 * Quién es el negocio. Con varios chats es el autor que aparece en todos; con
 * uno solo no se puede saber: hay que decirlo con `hint`.
 */
export function detectBusinessAuthor(chats: ExportMessage[][], hint?: string): string | null {
  const authors = chats.map((c) => new Set(c.map((m) => m.author)));
  if (hint) {
    const h = hint.toLowerCase();
    for (const set of authors) for (const a of set) if (a.toLowerCase().includes(h)) return a;
    return null;
  }
  if (chats.length < 2) return null;
  const count = new Map<string, number>();
  for (const set of authors) for (const a of set) count.set(a, (count.get(a) ?? 0) + 1);
  const [best] = [...count.entries()].sort((a, b) => b[1] - a[1]);
  return best && best[1] >= Math.ceil(chats.length * 0.8) ? best[0] : null;
}

export type Exchange = {
  /** Lo que escribió el cliente justo antes (mensajes seguidos, unidos). */
  customer: string;
  /** Cada mensaje del negocio en su respuesta. */
  replies: string[];
  customerName: string;
};

/** Parte el chat en turnos: ráfaga del cliente → ráfaga del negocio. */
export function toExchanges(chat: ExportMessage[], business: string): Exchange[] {
  const out: Exchange[] = [];
  let customer: string[] = [];
  let replies: string[] = [];
  let name = "";
  const flush = () => {
    if (replies.length > 0) out.push({ customer: customer.join("\n"), replies, customerName: name });
    customer = [];
    replies = [];
  };
  for (const msg of chat) {
    if (msg.author === business) {
      replies.push(msg.text);
    } else {
      if (replies.length > 0) flush();
      customer.push(msg.text);
      name = msg.author;
    }
  }
  flush();
  return out;
}

const PHONE = /\+?\d[\d\s().-]{7,}\d/g;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

/** Quita lo que identifica a una persona. Devuelve null si el texto no sirve sin eso. */
export function anonymize(text: string, customerName: string): string | null {
  let out = text.replace(EMAIL, "[correo]").replace(PHONE, "[teléfono]");
  const tokens = /^[\d+\s().-]+$/.test(customerName)
    ? []
    : customerName.split(/\s+/).filter((t) => t.length >= 3 && /^[A-Za-zÁÉÍÓÚÑáéíóúñ]+$/.test(t));
  for (const t of tokens) {
    const re = new RegExp(`\\b${t}\\b`, "gi");
    if (re.test(out)) return null; // lleva el nombre del cliente: no es reutilizable
  }
  out = out.replace(/\s+\n/g, "\n").trim();
  return out.length >= 2 ? out : null;
}

export function normalizeForDedupe(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** "Hola, buen día. ¿En qué le ayudo?" → saludo + pregunta, por separado. */
export function splitGreetingAndQuestion(text: string): { greeting: string | null; question: string | null } {
  // En español la pregunta abre con "¿": todo lo anterior es el saludo, aunque
  // venga en la misma frase ("…Carmen del Estudio, ¿en qué le ayudo?").
  const open = text.indexOf("¿");
  if (open >= 0) {
    const greeting = text.slice(0, open).replace(/[,;:\s]+$/, "").trim();
    return { greeting: greeting || null, question: text.slice(open).trim() || null };
  }
  const parts = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const q = parts.filter((p) => p.includes("?"));
  const g = parts.filter((p) => !p.includes("?"));
  return { greeting: g.length ? g.join(" ") : null, question: q.length ? q.join(" ") : null };
}
