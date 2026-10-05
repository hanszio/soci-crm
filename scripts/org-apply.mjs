/**
 * Crea (o actualiza) una empresa a partir de una plantilla JSON: marca, agente,
 * conocimiento, agenda, variantes de respuesta y catálogo. Es la versión por
 * línea de comandos del "Perfil de negocio" (specs/018): mientras no exista el
 * asistente /onboarding, una empresa nueva se da de alta así.
 *
 * Uso:
 *   node scripts/org-apply.mjs --config docs/plantillas/contabilidad.json \
 *     --base http://localhost:3100 --admin-email tu@correo --admin-password ••• \
 *     --owner-password ••• [--wa-mock-pn PN-DEMO] [--reset-kb]
 *
 * Idempotente: si la empresa ya existe la actualiza; las fichas y variantes
 * que ya están no se duplican. --reset-kb borra las fichas antes de cargar.
 * Los campos que empiezan con "PENDIENTE" no se cargan: son huecos por llenar.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) => (a.startsWith("--") ? [[a.slice(2), all[i + 1]?.startsWith("--") || all[i + 1] === undefined ? "true" : all[i + 1]]] : []))
);
const need = (k) => args[k] ?? (console.error(`Falta --${k}`), process.exit(1));
const BASE = need("base");
const cfg = JSON.parse(readFileSync(need("config"), "utf8"));
const pending = (v) => typeof v === "string" && v.trim().toUpperCase().startsWith("PENDIENTE");

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login ${email}: ${res.status}`);
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}
const call = (cookie) => async (p, method = "GET", body) => {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: { origin: BASE, cookie, ...(body && !(body instanceof FormData) ? { "content-type": "application/json" } : {}) },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
};

const admin = call(await login(need("admin-email"), need("admin-password")));
const ownerPassword = need("owner-password");
const created = await admin("/api/platform/organizations", "POST", {
  name: cfg.org.name,
  slug: cfg.org.slug,
  currency: cfg.org.currency ?? "PEN",
  ownerEmail: cfg.org.ownerEmail,
  ownerPassword,
  ownerName: cfg.org.ownerName ?? cfg.org.name,
});
console.log(`empresa: ${created.status === 201 ? "creada" : created.json?.error?.code ?? created.status}`);
const api = call(await login(cfg.org.ownerEmail, ownerPassword));

const b = cfg.branding ?? {};
console.log("marca:", (await api("/api/settings/branding", "PUT", { name: (b.name ?? cfg.org.name).slice(0, 30), accent: b.accent ?? "#0d5bff", currency: cfg.org.currency ?? "PEN" })).status);

const profile = Object.fromEntries(Object.entries(cfg.profile ?? {}).filter(([, v]) => !pending(v)));
if (Array.isArray(profile.greeting)) profile.greeting = profile.greeting.join("\n");
console.log("agente:", (await api("/api/agent/profile", "PUT", profile)).status);

if (args["reset-kb"]) {
  for (const e of (await api("/api/kb")).json?.entries ?? []) await api(`/api/kb/${e.id}`, "DELETE");
}
const have = new Set(((await api("/api/kb")).json?.entries ?? []).map((e) => (e.question ?? e.content ?? "").trim()));
let kbAdded = 0, kbPending = 0;
for (const e of cfg.kb ?? []) {
  if (pending(e.answer) || pending(e.content)) { kbPending++; continue; }
  const key = (e.question ?? e.content).trim();
  if (have.has(key)) continue;
  const body = e.content ? { kind: "block", content: e.content } : { kind: "qa", question: e.question, answer: e.answer };
  if ((await api("/api/kb", "POST", body)).status === 201) kbAdded++;
}
console.log(`fichas: +${kbAdded} (pendientes de datos: ${kbPending})`);

if (cfg.calendar) {
  const cal = Object.fromEntries(Object.entries(cfg.calendar).filter(([, v]) => !pending(v)));
  console.log("agenda:", (await api("/api/calendar/settings", "PUT", cal)).status);
}

const variants = Object.entries(cfg.variants ?? {}).flatMap(([key, texts]) => texts.map((text) => ({ key, text })));
if (variants.length) console.log("variantes:", JSON.stringify((await api("/api/reply-variants/import", "POST", { source: "owner", variants })).json));

const existing = new Set(((await api("/api/catalog")).json?.items ?? []).map((i) => i.title));
for (const it of cfg.catalog ?? []) {
  if (existing.has(it.title) || pending(it.file)) continue;
  const data = readFileSync(it.file);
  const ext = path.extname(it.file).toLowerCase();
  const type = ext === ".pdf" ? "application/pdf" : ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
  const form = new FormData();
  form.set("file", new Blob([data], { type }), path.basename(it.file));
  form.set("title", it.title);
  if (it.description) form.set("description", it.description);
  if (it.price) form.set("price", it.price);
  console.log(`archivo «${it.title}»:`, (await api("/api/catalog", "POST", form)).status);
}

if (args["wa-mock-pn"]) {
  // Solo para probar en local con wa-mock: un número de mentira para esta empresa.
  const r = await api("/api/settings/whatsapp", "PUT", { wabaId: `WABA-${args["wa-mock-pn"]}`, phoneNumberId: args["wa-mock-pn"], token: "token-de-prueba-local" });
  console.log("whatsapp (mock):", r.status, r.json?.displayPhoneNumber ?? r.json?.error?.message ?? "");
}
console.log(`\nListo. Entra a ${BASE}/login con ${cfg.org.ownerEmail}`);
