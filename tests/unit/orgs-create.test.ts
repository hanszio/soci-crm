import { describe, expect, it } from "vitest";
import { slugify } from "@/server/orgs/create";

/** T3.1 — el slug de una empresa nueva sale del nombre, sin sorpresas. */
describe("slugify", () => {
  it("quita tildes, símbolos y espacios", () => {
    expect(slugify("Recepciones & Bodas Golden")).toBe("recepciones-bodas-golden");
    expect(slugify("  Imprenta Ñandú S.A.C. ")).toBe("imprenta-nandu-s-a-c");
    expect(slugify("---")).toBe("");
  });
});
