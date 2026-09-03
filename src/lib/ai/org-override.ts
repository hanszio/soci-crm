import type { AiProvider } from "@/lib/ai/providers";

/**
 * Configuración de IA propia de una organización (Ajustes → IA). Si existe,
 * reemplaza clave y modelos de la plataforma para esa organización.
 */
export type OrgAiOverride = {
  provider: AiProvider;
  apiKey: string;
  baseUrl: string | null;
  model: string;
  judgeModel: string | null;
};

/**
 * Indirección para que `lib/ai` no dependa del módulo de servidor al
 * cargarse (evita ciclos y permite tests sin BD). El store de
 * `server/ai-settings` se registra al arrancar.
 */
type Loader = (organizationId: string) => Promise<OrgAiOverride | null>;

const globalForLoader = globalThis as unknown as { __sociAiOverrideLoader?: Loader };

export function registerOrgAiOverrideLoader(loader: Loader): void {
  globalForLoader.__sociAiOverrideLoader = loader;
}

export async function getOrgAiOverride(organizationId: string): Promise<OrgAiOverride | null> {
  const loader = globalForLoader.__sociAiOverrideLoader;
  if (!loader) return null;
  try {
    return await loader(organizationId);
  } catch (err) {
    console.error("[ai] no se pudo leer la configuración de IA de la organización:", err);
    return null;
  }
}
