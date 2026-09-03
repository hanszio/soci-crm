import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import { parseModelId, PROVIDER_INFO, AI_PROVIDERS } from "@/lib/ai/providers";
import { resolveCandidates, specKey } from "@/lib/ai/registry";

function baseEnv() {
  vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
  vi.stubEnv("DATABASE_URL", "postgresql://t:t@localhost:5432/t");
  vi.stubEnv("BETTER_AUTH_SECRET", "secret-de-test-suficiente");
  vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64"));
  vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-test");
}

describe("parseModelId", () => {
  it("proveedor/modelo simple", () => {
    expect(parseModelId("anthropic/claude-sonnet-4-5")).toEqual({ provider: "anthropic", model: "claude-sonnet-4-5" });
  });
  it("modelo con barras (OpenRouter) se corta solo en la primera", () => {
    expect(parseModelId("openrouter/anthropic/claude-sonnet-4.5")).toEqual({ provider: "openrouter", model: "anthropic/claude-sonnet-4.5" });
  });
  it("proveedor desconocido o sin modelo → null", () => {
    expect(parseModelId("mistral/x")).toBeNull();
    expect(parseModelId("openai/")).toBeNull();
    expect(parseModelId("gpt-5")).toBeNull();
  });
  it("todo proveedor del catálogo tiene ficha", () => {
    for (const p of AI_PROVIDERS) expect(PROVIDER_INFO[p].id).toBe(p);
  });
});

describe("resolveCandidates (orden y compatibilidad)", () => {
  beforeEach(() => {
    baseEnv();
    // env.ts memoiza: forzar recarga por módulo aislado no es posible aquí,
    // así que cada test usa variables que no colisionan con el cache.
  });
  afterEach(() => vi.unstubAllEnvs());

  it("sin nada configurado → lista vacía (not_configured)", async () => {
    vi.resetModules();
    const { resolveCandidates: rc } = await import("@/lib/ai/registry");
    expect(await rc("chat")).toEqual([]);
  });

  it("OPENROUTER_* heredado se modela como compat apuntando a <base>/v1", async () => {
    vi.resetModules();
    vi.stubEnv("OPENROUTER_API_TOKEN", "tok");
    vi.stubEnv("OPENROUTER_MODEL", "anthropic/claude-sonnet-4.5");
    vi.stubEnv("OPENROUTER_BASE_URL", "http://localhost:3000/api/dev/ai-mock");
    const { resolveCandidates: rc } = await import("@/lib/ai/registry");
    const c = await rc("chat");
    expect(c).toHaveLength(1);
    expect(c[0]!.provider).toBe("compat");
    expect(c[0]!.baseUrl).toBe("http://localhost:3000/api/dev/ai-mock/v1");
    expect(c[0]!.model).toBe("anthropic/claude-sonnet-4.5");
    expect(c[0]!.source).toBe("legacy");
  });

  it("AI_MODEL + AI_FALLBACK con claves de plataforma, sin duplicados, y omite proveedores sin clave", async () => {
    vi.resetModules();
    vi.stubEnv("AI_MODEL", "anthropic/claude-sonnet-4-5");
    vi.stubEnv("AI_FALLBACK", "openai/gpt-5-mini, google/gemini-2.5-flash, anthropic/claude-sonnet-4-5");
    vi.stubEnv("ANTHROPIC_API_KEY", "a");
    vi.stubEnv("OPENAI_API_KEY", "o");
    // sin GOOGLE_GENERATIVE_AI_API_KEY → google se omite
    const { resolveCandidates: rc, specKey: sk } = await import("@/lib/ai/registry");
    const c = await rc("chat");
    expect(c.map((s) => `${s.provider}/${s.model}`)).toEqual([
      "anthropic/claude-sonnet-4-5",
      "openai/gpt-5-mini",
    ]);
    expect(new Set(c.map(sk)).size).toBe(c.length);
  });

  it("la configuración de la organización va primero", async () => {
    vi.resetModules();
    vi.stubEnv("AI_MODEL", "openai/gpt-5-mini");
    vi.stubEnv("OPENAI_API_KEY", "o");
    const { registerOrgAiOverrideLoader } = await import("@/lib/ai/org-override");
    registerOrgAiOverrideLoader(async (org) =>
      org === "org_a"
        ? { provider: "anthropic", apiKey: "k", baseUrl: null, model: "claude-haiku-4-5", judgeModel: null }
        : null
    );
    const { resolveCandidates: rc } = await import("@/lib/ai/registry");
    const a = await rc("chat", "org_a");
    expect(a[0]!.source).toBe("org");
    expect(a[0]!.provider).toBe("anthropic");
    expect(a[1]!.source).toBe("platform");
    const b = await rc("chat", "org_b");
    expect(b[0]!.source).toBe("platform");
  });
});

// evita warning de import sin uso en algunos linters
void resolveCandidates;
void specKey;
