/**
 * J0 — Mide Jev (TypeSafe) en español usando las MISMAS preguntas y la MISMA
 * política que el producto (`server/jev/questions.ts` y `route.ts`).
 *
 * Uso:  pnpm jev:eval            (necesita TYPESAFE_API_KEY en .env)
 *
 * Reporta exactitud por pregunta y por umbral de confianza, y lo que de verdad
 * importa: de los turnos que saldrían por el carril DIRECTO, cuántos contradicen
 * la etiqueta humana. Correr antes de subir de versión de modelo o de tocar
 * umbrales.
 */
import { CASOS, FICHAS, HORARIOS, NEGOCIO } from "../tests/fixtures/jev-eval/casos.mjs";
import { buildJevRequest } from "../src/server/jev/questions";
import { routeTurn, type Plan } from "../src/server/jev/route";
import type { Answer, ChoiceAnswer, NoulAnswer } from "../src/lib/typesafe";

const KEY = process.env.TYPESAFE_API_KEY;
const BASE = process.env.TYPESAFE_BASE_URL ?? "https://api.typesafe.ai";
const MODEL = process.env.TYPESAFE_MODEL ?? "jev-1.13.0";
if (!KEY) {
  console.error("Falta TYPESAFE_API_KEY");
  process.exit(1);
}

type Caso = (typeof CASOS)[number] & {
  exp: { i: string[]; f?: string | null; h?: string | null; hum?: number; iny?: number; hos?: number; comp?: number };
};

const OFERTA = "Claro, tengo estos horarios disponibles:\n" + HORARIOS.map((h) => `• ${h.etiqueta}`).join("\n");
const FICHA_REAL = Object.fromEntries(FICHAS.map((f) => [`kb_${f.id}`, f.id]));
const SLOT_REAL = Object.fromEntries(HORARIOS.map((h) => [`utc_${h.id}`, h.id]));

function request(caso: Caso) {
  return buildJevRequest({
    business: { name: NEGOCIO.nombre, agent: "Ana" },
    history: caso.slots
      ? [
          { from: "cliente", text: "quiero una cita por llamada" },
          { from: "asistente", text: OFERTA },
        ]
      : [],
    lastMessage: caso.t,
    offers: caso.slots ? HORARIOS.map((h) => ({ startUtc: `utc_${h.id}`, label: h.etiqueta })) : [],
    fichas: FICHAS.map((f) => ({ id: `kb_${f.id}`, question: f.pregunta })),
    files: [{ id: "cat_precios", title: "Lista de precios y servicios", when: "cuando pidan precios, tarifas, catálogo o brochure" }],
    // Una sola modalidad: así la decisión de reservar depende solo del horario.
    modalities: ["llamada"],
  });
}

async function ask(caso: Caso) {
  const req = request(caso);
  const t0 = performance.now();
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${BASE}/v1/systemone`, {
      method: "POST",
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ state: req.state, model: MODEL, questions: req.questions }),
    });
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    const json = (await res.json()) as { answers: Record<string, Answer>; usage?: { input_tokens?: number } };
    if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(json).slice(0, 200)}`);
    const plan = routeTurn(json.answers, {
      agenda: true,
      lastOutIsQuestion: false,
      modalities: ["llamada"],
      sentItemIds: [],
      maps: req.maps,
    });
    return { ms: performance.now() - t0, answers: json.answers, tokens: json.usage?.input_tokens ?? 0, plan, maps: req.maps };
  }
  throw new Error("sin respuesta tras reintentos");
}

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<(R | { error: string })[]> {
  const out: (R | { error: string })[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]!).catch((e) => ({ error: String(e) }));
      }
    })
  );
  return out;
}

const pct = (a: number, b: number) => (b === 0 ? "   –  " : `${((100 * a) / b).toFixed(1)}%`.padStart(6));
const quant = (arr: number[], p: number) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))]! : 0;
};
const ch = (a: Answer | undefined) => a as ChoiceAnswer;
const nl = (a: Answer | undefined) => (a as NoulAnswer).noul;

/** ¿El plan directo contradice la etiqueta humana? Devuelve el motivo o null. */
function directError(plan: Plan, caso: Caso): string | null {
  const e = caso.exp;
  switch (plan.type) {
    case "llm":
      return null;
    case "ficha": {
      const got = FICHA_REAL[plan.fichaId];
      return e.f === null || got === (e.f ?? "ninguna") ? null : `ficha ${got}, esperada ${e.f ?? "ninguna"}`;
    }
    case "book": {
      const got = SLOT_REAL[plan.startUtc];
      return got === e.h ? null : `reservó ${got}, esperado ${e.h}`;
    }
    case "offer":
      return e.i.includes("agendar") ? null : "ofreció horarios sin que pidan cita";
    case "send":
      return e.i.includes("pedir_precio_o_catalogo") ? null : "mandó archivo sin que pidan precios";
    case "handoff":
      return e.hum === 1 || e.hos === 1 || e.i.includes("cancelar_o_cambiar_cita") || e.i.includes("pedir_humano") || e.i.includes("queja_hostil")
        ? null
        : `handoff (${plan.reason}) sin motivo`;
    case "bank": {
      const need: Record<string, string> = { abrir: "saludo", ack: "confirmacion", despedida: "despedida" };
      if (plan.key === "fuera_de_tema") {
        return e.iny === 1 || e.i.includes("fuera_de_tema") ? null : "trató como fuera de tema un mensaje del negocio";
      }
      const k = need[plan.key];
      return k && e.i.includes(k) ? null : `respondió «${plan.key}»`;
    }
  }
}

console.log(`\n══════ Jev ${MODEL} · ${CASOS.length} casos en español · preguntas y política del producto ══════`);
const res = await pool(CASOS as Caso[], 5, ask);
const good = res
  .map((r, i) => ({ r, caso: (CASOS as Caso[])[i]! }))
  .filter((x): x is { r: Awaited<ReturnType<typeof ask>>; caso: Caso } => !("error" in x.r));
const errors = res.filter((r) => "error" in r);
if (errors.length) console.log(`  ERRORES de red: ${errors.length} — ${(errors[0] as { error: string }).error}`);

const ms = good.map((x) => x.r.ms);
const tok = good.reduce((a, x) => a + x.r.tokens, 0) / good.length;
console.log(
  `  latencia p50 ${Math.round(quant(ms, 0.5))} ms · p95 ${Math.round(quant(ms, 0.95))} ms · máx ${Math.round(Math.max(...ms))} ms · ` +
    `tokens de entrada (media) ${Math.round(tok)} ≈ US$${(tok * 0.042e-6).toFixed(6)} por turno`
);

function choiceReport(name: string, rows: { ok: boolean; conf: number }[]) {
  console.log(`\n  ${name}  (n=${rows.length})\n    umbral  cobertura  exactitud`);
  for (const t of [0, 0.6, 0.75, 0.85, 0.95]) {
    const kept = rows.filter((r) => r.conf >= t);
    console.log(`    ≥${t.toFixed(2)}   ${pct(kept.length, rows.length)}    ${pct(kept.filter((r) => r.ok).length, kept.length)}`);
  }
}
choiceReport("intencion", good.map(({ r, caso }) => ({ ok: caso.exp.i.includes(ch(r.answers.intencion).choice), conf: ch(r.answers.intencion).confidence })));
choiceReport(
  "ficha",
  good.filter(({ caso }) => caso.exp.f !== null).map(({ r, caso }) => ({ ok: (caso.exp.f ?? "ninguna") === ch(r.answers.ficha).choice, conf: ch(r.answers.ficha).confidence }))
);
choiceReport(
  "horario",
  good.filter(({ caso }) => caso.slots && caso.exp.h != null).map(({ r, caso }) => ({ ok: caso.exp.h === ch(r.answers.horario).choice, conf: ch(r.answers.horario).confidence }))
);

console.log("\n  nouls (umbral del producto)");
const noulRow = (key: string, expKey: "hum" | "hos" | "iny" | "comp", t: number, def: number | undefined) => {
  const rows = good.filter(({ caso }) => (caso.exp[expKey] ?? def) !== undefined).map(({ r, caso }) => ({ p: nl(r.answers[key]), exp: caso.exp[expKey] ?? def }));
  const pos = rows.filter((r) => r.exp === 1);
  const neg = rows.filter((r) => r.exp === 0);
  console.log(
    `    ${key.padEnd(12)} ≥${t}: detecta ${pos.filter((r) => r.p >= t).length}/${pos.length} · falsos positivos ${neg.filter((r) => r.p >= t).length}/${neg.length}`
  );
};
noulRow("pide_humano", "hum", 0.7, 0);
noulRow("hostil", "hos", 0.75, 0);
noulRow("inyeccion", "iny", 0.6, 0);
noulRow("compuesta", "comp", 0.5, undefined);

const byPlan: Record<string, number> = {};
const bad: string[] = [];
let direct = 0;
for (const { r, caso } of good) {
  byPlan[r.plan.type] = (byPlan[r.plan.type] ?? 0) + 1;
  if (r.plan.type !== "llm") direct++;
  const err = directError(r.plan, caso);
  if (err) bad.push(`«${caso.t}» → ${err}`);
}
console.log(`\n  CARRIL DIRECTO: ${direct}/${good.length} turnos (${pct(direct, good.length).trim()}) sin LLM · por tipo: ${JSON.stringify(byPlan)}`);
console.log(`  precisión del carril directo: ${pct(direct - bad.length, direct).trim()} (${bad.length} decisiones contradicen la etiqueta)`);
for (const b of bad) console.log(`    ✗ ${b}`);
const llmReasons: Record<string, number> = {};
for (const { r } of good) if (r.plan.type === "llm") llmReasons[r.plan.reason] = (llmReasons[r.plan.reason] ?? 0) + 1;
console.log(`  motivos para ir al LLM: ${JSON.stringify(llmReasons)}`);
process.exit(bad.length > 0 && process.argv.includes("--strict") ? 1 : 0);
