import { mockGuard } from "@/lib/dev-guard";
import { typesafeMockAnswers } from "@/server/dev/typesafe-mock";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;
  const body = (await req.json().catch(() => ({}))) as {
    state?: Record<string, unknown>;
    questions?: Record<string, { type: string; criteria?: Record<string, unknown> }>;
  };
  return Response.json({
    model: "jev-mock",
    answers: typesafeMockAnswers(body.state ?? {}, body.questions ?? {}),
    usage: { input_tokens: 100, output_tokens: 10 },
  });
}
