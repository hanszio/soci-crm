/**
 * Mina chats reales exportados de WhatsApp y saca el banco de respuestas del
 * negocio: sus saludos, acuses, despedidas y las respuestas que ya da a las
 * preguntas frecuentes — con sus palabras, no las de un modelo.
 *
 * Uso:
 *   pnpm wa:mine <carpeta|archivo.txt|archivo.zip>... [--negocio "Nombre en el chat"]
 *        [--out banco.json] [--push http://localhost:3100 --email x --password y]
 *
 * Cómo exportar: en WhatsApp, abrir el chat → ⋮ / nombre del contacto →
 * "Exportar chat" → "Sin archivos". Junta los .txt (o .zip) en una carpeta.
 *
 * Qué hace:
 *   1. Lee y parte cada chat en turnos cliente → negocio.
 *   2. Quita lo personal (teléfonos, correos; descarta lo que nombra al cliente).
 *   3. Le pregunta a Jev, por cada mensaje del negocio, qué función cumple y
 *      si se puede reutilizar tal cual con otro cliente. Jev no reescribe nada.
 *   4. Agrupa: variantes por clave del banco, saludos, y pares pregunta →
 *      respuesta como candidatos a ficha (esos se revisan a mano).
 *
 * Con --push sube las variantes y los saludos; las fichas candidatas SOLO se
 * escriben en el JSON: llevan datos del negocio y alguien tiene que mirarlas.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  anonymize,
  detectBusinessAuthor,
  normalizeForDedupe,
  parseWhatsAppExport,
  splitGreetingAndQuestion,
  toExchanges,
  type ExportMessage,
} from "../src/server/replies/wa-export";

const KEY = process.env.TYPESAFE_API_KEY;
const BASE = process.env.TYPESAFE_BASE_URL ?? "https://api.typesafe.ai";
const MODEL = process.env.TYPESAFE_MODEL ?? "jev-1.13.0";

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const inputs = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1]!.startsWith("--")));
if (inputs.length === 0 || !KEY) {
  console.error('Uso: pnpm wa:mine <carpeta|.txt|.zip>... [--negocio "Nombre"] [--out banco.json] [--push URL --email E --password P]');
  if (!KEY) console.error("Falta TYPESAFE_API_KEY en .env");
  process.exit(1);
}

function collect(p: string): string[] {
  const st = statSync(p);
  if (st.isDirectory()) return readdirSync(p).flatMap((f) => collect(path.join(p, f)));
  if (p.toLowerCase().endsWith(".zip")) {
    const dir = mkdtempSync(path.join(tmpdir(), "wa-mine-"));
    execFileSync("unzip", ["-o", "-q", p, "*.txt", "-d", dir]);
    return collect(dir);
  }
  return p.toLowerCase().endsWith(".txt") ? [p] : [];
}

const files = inputs.flatMap(collect);
const chats: ExportMessage[][] = files.map((f) => parseWhatsAppExport(readFileSync(f, "utf8"))).filter((c) => c.length > 0);
const business = detectBusinessAuthor(chats, flag("negocio"));
if (!business) {
  const authors = [...new Set(chats.flat().map((m) => m.author))].slice(0, 12);
  console.error(`No pude saber cuál autor es el negocio. Pásalo con --negocio. Autores vistos: ${authors.join(" | ")}`);
  process.exit(1);
}
console.log(`Chats: ${chats.length} · mensajes: ${chats.flat().length} · negocio: «${business}»`);

type Candidate = { text: string; customer: string; count: number };
const candidates = new Map<string, Candidate>();
let dropped = 0;
for (const chat of chats) {
  for (const ex of toExchanges(chat, business)) {
    for (const reply of ex.replies.slice(0, 4)) {
      const clean = anonymize(reply, ex.customerName);
      if (!clean || clean.length > 400) {
        dropped++;
        continue;
      }
      const k = normalizeForDedupe(clean);
      const prev = candidates.get(k);
      if (prev) prev.count++;
      else candidates.set(k, { text: clean, customer: anonymize(ex.customer, "") ?? "", count: 1 });
    }
  }
}
const list = [...candidates.values()].slice(0, 3000);
console.log(`Respuestas distintas del negocio: ${list.length} (descartadas por datos personales o largo: ${dropped})`);

const FUNCIONES = {
  saludo: "Solo saluda y/o se presenta (nombre, empresa), sin preguntar nada.",
  preguntar_que_necesita: "Solo le pregunta al cliente qué necesita o en qué le puede ayudar, sin saludar.",
  saludo_y_pregunta: "Saluda o se presenta Y además pregunta qué necesita, en el mismo mensaje.",
  acuse: "Acuse corto o cortesía: de nada, con gusto, perfecto, listo, a usted.",
  despedida: "Se despide o cierra la conversación.",
  ofrecer_horarios: "Introduce u ofrece horarios o fechas para una cita o llamada.",
  acompanar_archivo: "Anuncia o acompaña el envío de un archivo, PDF, foto o catálogo.",
  respuesta_informativa: "Responde una pregunta con información del negocio: servicios, precios, ubicación, horario, requisitos, formas de pago.",
  pedir_dato: "Le pide al cliente un dato o le hace una pregunta sobre su caso.",
  otro: "Ninguna de las anteriores.",
} as const;

async function classify(c: Candidate) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${BASE}/v1/systemone`, {
      method: "POST",
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        state: { cliente_escribio: c.customer.slice(0, 500), negocio_respondio: c.text },
        questions: {
          funcion: {
            type: "choice",
            instructions: "¿Qué función cumple el mensaje `negocio_respondio` dentro de la conversación?",
            criteria: FUNCIONES,
          },
          reutilizable: {
            type: "noul",
            instructions:
              "¿El mensaje `negocio_respondio` se puede enviar tal cual a CUALQUIER otro cliente? Sí, si solo contiene cortesía, el nombre del negocio o de quien atiende. No, si menciona al cliente por su nombre, una fecha u hora concreta, un monto, o un dato del caso particular de este cliente.",
          },
          es_pregunta_cliente: {
            type: "noul",
            instructions: "¿`cliente_escribio` contiene una pregunta sobre el negocio (servicios, precios, ubicación, horarios, requisitos, pagos)?",
          },
        },
      }),
    });
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
      continue;
    }
    const json = (await res.json()) as {
      answers: {
        funcion: { choice: keyof typeof FUNCIONES; confidence: number };
        reutilizable: { noul: number };
        es_pregunta_cliente: { noul: number };
      };
    };
    if (!res.ok) throw new Error(`TypeSafe ${res.status}: ${JSON.stringify(json).slice(0, 160)}`);
    return json.answers;
  }
  throw new Error("TypeSafe no respondió");
}

const results: (Candidate & { funcion: string; conf: number; reusable: number; isQuestion: number })[] = [];
let i = 0;
await Promise.all(
  Array.from({ length: 8 }, async () => {
    while (i < list.length) {
      const c = list[i++]!;
      try {
        const a = await classify(c);
        results.push({ ...c, funcion: a.funcion.choice, conf: a.funcion.confidence, reusable: a.reutilizable.noul, isQuestion: a.es_pregunta_cliente.noul });
      } catch (err) {
        console.warn(`  (sin clasificar: ${String(err).slice(0, 80)})`);
      }
    }
  })
);

const KEY_OF: Record<string, string> = {
  preguntar_que_necesita: "abrir",
  acuse: "ack",
  despedida: "despedida",
  ofrecer_horarios: "ofrecer_horarios",
  acompanar_archivo: "pie_archivo",
};
const greetings = new Map<string, string>();
const variants = new Map<string, { key: string; text: string; count: number }>();
const faqs: { question: string; answer: string; count: number }[] = [];
const add = (key: string, text: string, count: number) => {
  const k = `${key}|${normalizeForDedupe(text)}`;
  if (!variants.has(k)) variants.set(k, { key, text, count });
};

for (const r of results.sort((a, b) => b.count - a.count)) {
  if (r.conf < 0.6) continue;
  const generic = r.reusable >= 0.6;
  if (r.funcion === "saludo" && generic) greetings.set(normalizeForDedupe(r.text), r.text);
  else if (r.funcion === "saludo_y_pregunta" && generic) {
    const { greeting, question } = splitGreetingAndQuestion(r.text);
    if (greeting) greetings.set(normalizeForDedupe(greeting), greeting);
    if (question) add("abrir", question.replace(/^(¿?)(\p{L})/u, (_m, q: string, l: string) => q + l.toUpperCase()), r.count);
  } else if (KEY_OF[r.funcion] && generic && r.text.length <= 160) {
    // Una introducción de horarios con horas concretas no es reutilizable.
    if (r.funcion === "ofrecer_horarios" && /\d/.test(r.text)) continue;
    add(KEY_OF[r.funcion]!, r.text, r.count);
  } else if (r.funcion === "respuesta_informativa" && r.isQuestion >= 0.6 && r.customer) {
    faqs.push({ question: r.customer.split("\n").pop()!.slice(0, 200), answer: r.text, count: r.count });
  }
}

const out = {
  business,
  chats: chats.length,
  greetings: [...greetings.values()],
  variants: [...variants.values()],
  faqCandidates: faqs,
};
const byKey: Record<string, number> = {};
for (const v of out.variants) byKey[v.key] = (byKey[v.key] ?? 0) + 1;
console.log(`\nSaludos: ${out.greetings.length}`);
for (const g of out.greetings) console.log(`  · ${g}`);
console.log(`Variantes por clave: ${JSON.stringify(byKey)}`);
for (const v of out.variants) console.log(`  [${v.key}] ${v.text}`);
console.log(`Fichas candidatas (revisar a mano): ${out.faqCandidates.length}`);
for (const f of out.faqCandidates) console.log(`  P: ${f.question}\n  R: ${f.answer.replace(/\n/g, " / ")}`);

const outFile = flag("out") ?? "banco-minado.json";
writeFileSync(outFile, JSON.stringify(out, null, 1));
console.log(`\nGuardado en ${outFile}`);

const push = flag("push");
if (push) {
  const login = await fetch(`${push}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: push },
    body: JSON.stringify({ email: flag("email"), password: flag("password") }),
  });
  const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  if (!login.ok) {
    console.error(`No pude iniciar sesión en ${push} (${login.status})`);
    process.exit(1);
  }
  const h = { "content-type": "application/json", origin: push, cookie };
  if (out.variants.length) {
    const r = await fetch(`${push}/api/reply-variants/import`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({ source: "mined", variants: out.variants.map(({ key, text }) => ({ key, text })) }),
    });
    console.log(`Variantes subidas: ${JSON.stringify(await r.json())}`);
  }
  if (out.greetings.length) {
    const prof = (await (await fetch(`${push}/api/agent/profile`, { headers: h })).json()) as { profile: { greeting: string | null } };
    const current = (prof.profile.greeting ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
    const seen = new Set(current.map(normalizeForDedupe));
    const merged = [...current, ...out.greetings.filter((g) => !seen.has(normalizeForDedupe(g)))].join("\n").slice(0, 1000);
    const r = await fetch(`${push}/api/agent/profile`, { method: "PUT", headers: h, body: JSON.stringify({ greeting: merged }) });
    console.log(`Saludos actualizados: ${r.status}`);
  }
  console.log("Las fichas candidatas NO se subieron: revísalas en el JSON y cárgalas en Agente → Conocimiento.");
}
