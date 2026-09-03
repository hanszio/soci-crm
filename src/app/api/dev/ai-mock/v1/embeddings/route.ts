import { createHash } from "node:crypto";
import { mockGuard } from "@/lib/dev-guard";

export const dynamic = "force-dynamic";

const DIMS = 1536;

/** Vector determinista por texto (hash → floats en [-1, 1]), para el self-test. */
function vectorFor(text: string): number[] {
  const out: number[] = [];
  let seed = createHash("sha256").update(text).digest();
  while (out.length < DIMS) {
    for (let i = 0; i + 1 < seed.length && out.length < DIMS; i += 2) {
      out.push(((seed.readUInt16BE(i) / 65535) * 2 - 1));
    }
    seed = createHash("sha256").update(seed).digest();
  }
  return out;
}

export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;
  const body = (await req.json().catch(() => ({}))) as { input?: string | string[]; model?: string };
  const inputs = Array.isArray(body.input) ? body.input : body.input ? [body.input] : [];
  return Response.json({
    object: "list",
    model: body.model ?? "aimock-embed",
    data: inputs.map((text, index) => ({ object: "embedding", index, embedding: vectorFor(text) })),
    usage: { prompt_tokens: inputs.join(" ").length, total_tokens: inputs.join(" ").length },
  });
}
