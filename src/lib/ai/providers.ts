/**
 * Catálogo de proveedores de IA. Es la única lista que conocen la UI de
 * Ajustes → IA, el registro y la validación de entrada. Todos hablan por
 * Vercel AI SDK; `compat` cubre cualquier API compatible con OpenAI (Groq,
 * DeepSeek, Ollama, OpenCode Zen, Together…).
 */

export const AI_PROVIDERS = [
  "anthropic",
  "openai",
  "google",
  "openrouter",
  "compat",
] as const;

export type AiProvider = (typeof AI_PROVIDERS)[number];

export type ProviderInfo = {
  id: AiProvider;
  label: string;
  /** Dónde se obtiene la clave. */
  keysUrl: string;
  /** Prefijo típico de la clave; solo orienta, no bloquea. */
  keyPrefix?: string;
  /** Si el proveedor exige una URL base (APIs compatibles con OpenAI). */
  needsBaseUrl: boolean;
  /** Modelos sugeridos en la UI; el usuario puede escribir otro. */
  models: string[];
  /** Modelo de embeddings por defecto, si el proveedor ofrece. */
  embeddingModel?: string;
  hint?: string;
};

export const PROVIDER_INFO: Record<AiProvider, ProviderInfo> = {
  anthropic: {
    id: "anthropic",
    label: "Anthropic (Claude)",
    keysUrl: "https://console.anthropic.com/settings/keys",
    keyPrefix: "sk-ant-",
    needsBaseUrl: false,
    models: ["claude-sonnet-4-5", "claude-haiku-4-5", "claude-opus-4-1"],
    hint: "No ofrece embeddings: si usas conocimiento documental, el modelo de embeddings sale de otro proveedor.",
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    keysUrl: "https://platform.openai.com/api-keys",
    keyPrefix: "sk-",
    needsBaseUrl: false,
    models: ["gpt-5-mini", "gpt-5", "gpt-4o-mini"],
    embeddingModel: "text-embedding-3-small",
  },
  google: {
    id: "google",
    label: "Google (Gemini)",
    keysUrl: "https://aistudio.google.com/apikey",
    keyPrefix: "AIza",
    needsBaseUrl: false,
    models: ["gemini-2.5-flash", "gemini-2.5-pro"],
    embeddingModel: "text-embedding-004",
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter (cualquier modelo)",
    keysUrl: "https://openrouter.ai/settings/keys",
    keyPrefix: "sk-or-",
    needsBaseUrl: false,
    models: [
      "anthropic/claude-sonnet-4.5",
      "anthropic/claude-haiku-4.5",
      "openai/gpt-5-mini",
      "google/gemini-2.5-flash",
    ],
    embeddingModel: "openai/text-embedding-3-small",
    hint: "Requiere créditos cargados en openrouter.ai/settings/credits.",
  },
  compat: {
    id: "compat",
    label: "Compatible con OpenAI (Groq, DeepSeek, Ollama, OpenCode…)",
    keysUrl: "https://console.groq.com/keys",
    needsBaseUrl: true,
    models: ["llama-3.3-70b-versatile", "deepseek-chat", "qwen2.5:14b"],
    hint: "URL base sin /chat/completions. Ejemplos: https://api.groq.com/openai/v1 · https://api.deepseek.com/v1 · http://ollama:11434/v1",
  },
};

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export function isAiProvider(v: string): v is AiProvider {
  return (AI_PROVIDERS as readonly string[]).includes(v);
}

/**
 * Identificador `proveedor/modelo` usado en variables de entorno
 * (`AI_MODEL`, `AI_FALLBACK`). Para OpenRouter y compat el modelo puede
 * contener `/`, así que solo se corta en el PRIMER separador.
 */
export function parseModelId(id: string): { provider: AiProvider; model: string } | null {
  const i = id.indexOf("/");
  if (i <= 0) return null;
  const provider = id.slice(0, i);
  const model = id.slice(i + 1).trim();
  if (!isAiProvider(provider) || !model) return null;
  return { provider, model };
}
