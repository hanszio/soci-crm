/**
 * Simulador de WhatsApp en la terminal, contra la app local con wa-mock.
 *
 * Escribes como si fueras el cliente; el CRM recibe el mensaje por el mismo
 * webhook que usa Meta y la respuesta del agente aparece aquí. Nada sale a
 * WhatsApp de verdad.
 *
 * Uso:
 *   pnpm dev:chat                       # usa PN-LOCAL y el número 51977172089
 *   pnpm dev:chat -- --pn PN-E2E-1 --from 51999888777 --name "Ana"
 *
 * Requisitos: app corriendo con WA_MOCK_ENABLED=true y META_GRAPH_BASE_URL
 * apuntando a /api/dev/wa-mock/graph; en Ajustes → WhatsApp del negocio, el
 * phone_number_id conectado tiene que ser el mismo que --pn.
 */
import readline from "node:readline";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1] ?? ""] : null))
    .filter(Boolean)
);
const BASE = args.base ?? process.env.APP_BASE_URL ?? "http://localhost:3100";
const PN = args.pn ?? process.env.WA_MOCK_PN ?? "PN-LOCAL";
const FROM = args.from ?? "51977172089";
const NAME = args.name ?? "Cliente local";

async function outbox() {
  const res = await fetch(`${BASE}/api/dev/wa-mock/outbox`).catch(() => null);
  if (!res?.ok) return [];
  return (await res.json()).outbox ?? [];
}

let lastN = Math.max(0, ...(await outbox()).map((e) => e.n));
let seq = Date.now();

function textOf(entry) {
  const b = entry.body ?? {};
  if (b.text?.body) return b.text.body;
  if (b.template) return `[plantilla ${b.template.name}]`;
  if (b.type) return `[${b.type}]`;
  return JSON.stringify(b).slice(0, 200);
}

setInterval(async () => {
  for (const e of await outbox()) {
    if (e.n <= lastN) continue;
    lastN = e.n;
    if (e.to !== FROM) continue;
    // Marcar entregado/leído como haría el teléfono, por si algo lo mira.
    process.stdout.write(`\n🤖 ${textOf(e)}\n> `);
  }
}, 1000).unref();

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
console.log(`Simulador wa-mock → ${BASE} · número ${FROM} (${NAME}) · phone_number_id ${PN}`);
console.log("Escribe y Enter. Ctrl+C para salir.\n");
rl.setPrompt("> ");
rl.prompt();
rl.on("line", async (line) => {
  const text = line.trim();
  if (!text) return rl.prompt();
  const res = await fetch(`${BASE}/api/dev/wa-mock/inbound`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      phoneNumberId: PN,
      from: FROM,
      name: NAME,
      text,
      waMessageId: `wamid.local.${seq++}`,
    }),
  }).catch(() => null);
  if (!res?.ok) {
    const detail = await res?.text().catch(() => "");
    console.log(`  ✗ no entregado (${res?.status ?? "sin respuesta"}): ${detail.slice(0, 200)}`);
  }
  rl.prompt();
});
rl.on("close", () => process.exit(0));
