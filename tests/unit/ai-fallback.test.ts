import { beforeEach, describe, expect, it } from "vitest";
import {
  breakerIsOpen,
  FAILURES_TO_OPEN,
  FallbackExhaustedError,
  OPEN_MS,
  reportFailure,
  resetBreakers,
  withFallback,
} from "@/lib/ai/fallback";

const classify = (err: unknown) => ({
  message: err instanceof Error ? err.message : String(err),
  opensBreaker: !(err instanceof Error && err.message.startsWith("config")),
});

describe("withFallback + circuit breaker", () => {
  beforeEach(() => resetBreakers());

  it("usa el primer candidato que responde y no llama al resto", async () => {
    const calls: string[] = [];
    const { result, key } = await withFallback(
      [
        { key: "a", value: "a" },
        { key: "b", value: "b" },
      ],
      async (v) => {
        calls.push(v);
        return `ok-${v}`;
      },
      classify
    );
    expect(result).toBe("ok-a");
    expect(key).toBe("a");
    expect(calls).toEqual(["a"]);
  });

  it("402 en el primario → pasa al segundo; tras 3 fallos el primario queda abierto y se salta", async () => {
    const calls: string[] = [];
    const run = () =>
      withFallback(
        [
          { key: "primario", value: "primario" },
          { key: "respaldo", value: "respaldo" },
        ],
        async (v) => {
          calls.push(v);
          if (v === "primario") throw new Error("proveedor respondió 402: sin créditos");
          return "ok";
        },
        classify
      );
    for (let i = 0; i < FAILURES_TO_OPEN; i++) {
      const r = await run();
      expect(r.key).toBe("respaldo");
    }
    expect(breakerIsOpen("primario")).toBe(true);
    calls.length = 0;
    await run();
    // con el breaker abierto, el primario ni se intenta
    expect(calls).toEqual(["respaldo"]);
  });

  it("errores de configuración no abren el breaker pero sí hacen fallback", async () => {
    for (let i = 0; i < FAILURES_TO_OPEN + 1; i++) {
      const r = await withFallback(
        [
          { key: "mal", value: "mal" },
          { key: "bien", value: "bien" },
        ],
        async (v) => {
          if (v === "mal") throw new Error("config: clave inválida (401)");
          return "ok";
        },
        classify
      );
      expect(r.key).toBe("bien");
    }
    expect(breakerIsOpen("mal")).toBe(false);
  });

  it("todos fallan → FallbackExhaustedError con el detalle de cada intento", async () => {
    await expect(
      withFallback(
        [
          { key: "a", value: "a" },
          { key: "b", value: "b" },
        ],
        async (v) => {
          throw new Error(`cae ${v}`);
        },
        classify
      )
    ).rejects.toBeInstanceOf(FallbackExhaustedError);
  });

  it("el breaker se cierra (medio-abierto) al pasar OPEN_MS", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < FAILURES_TO_OPEN; i++) reportFailure("x", true, t0);
    expect(breakerIsOpen("x", t0 + 1000)).toBe(true);
    expect(breakerIsOpen("x", t0 + OPEN_MS + 1)).toBe(false);
  });
});
