import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireBotKey } from "@/server/bot/auth";
import { resetRateLimit } from "@/lib/rate-limit";

/** La puerta de toda la superficie `/api/bot/*`. */

const KEY = "clave-de-servicio-larga-0123456789abcdef";

function reqWith(key?: string): Request {
  return new Request("http://localhost/api/bot/context", {
    headers: key ? { "x-api-key": key } : {},
  });
}

describe("requireBotKey", () => {
  beforeEach(() => {
    vi.stubEnv("BOT_API_KEY", KEY);
    resetRateLimit();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("key correcta → pasa (null)", () => {
    expect(requireBotKey(reqWith(KEY))).toBeNull();
  });

  it("key incorrecta → 401", () => {
    const res = requireBotKey(reqWith("otra-clave-igual-de-larga-pero-mala!!"));
    expect(res?.status).toBe(401);
  });

  it("sin header → 401", () => {
    expect(requireBotKey(reqWith())?.status).toBe(401);
  });

  it("sin BOT_API_KEY configurada → 401 SIEMPRE (aunque manden algo)", () => {
    vi.stubEnv("BOT_API_KEY", "");
    expect(requireBotKey(reqWith("cualquier-cosa"))?.status).toBe(401);
  });

  it("key demasiado corta configurada → 401 (no se acepta una key débil)", () => {
    vi.stubEnv("BOT_API_KEY", "corta");
    expect(requireBotKey(reqWith("corta"))?.status).toBe(401);
  });

  it("longitudes distintas no filtran información (401 uniforme)", () => {
    const res = requireBotKey(reqWith("x"));
    expect(res?.status).toBe(401);
  });
});
