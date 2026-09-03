/**
 * Catálogo de proveedores de IA. Es la única lista que conocen la UI de
 * Ajustes → IA, el registro y la validación de entrada. Todos hablan por
 * Vercel AI SDK; `opencode` es OpenCode Zen (API compatible con OpenAI con
 * modelos de varios laboratorios) y `compat` cubre cualquier otra API
 * compatible con OpenAI (Groq, DeepSeek, Ollama, Together…).
 */

export const AI_PROVIDERS = [
  "anthropic",
  "openai",
  "google",
  "opencode",
  "openrouter",
  "compat",
] as const;

export type AiProvider = (typeof AI_PROVIDERS)[number];

export type ModelTag = "recomendado" | "economico" | "calidad" | "gratis";

export type ModelInfo = {
  id: string;
  label: string;
  /** Qué lo distingue; la UI lo muestra junto al nombre. */
  tag?: ModelTag;
  /** Sugerido como juez del Laboratorio (barato y suficiente). */
  judge?: boolean;
  note?: string;
};

export type ProviderInfo = {
  id: AiProvider;
  label: string;
  /** Dónde se obtiene la clave. */
  keysUrl: string;
  /** Prefijo típico de la clave; solo orienta, no bloquea. */
  keyPrefix?: string;
  /** Si el proveedor exige una URL base (APIs compatibles con OpenAI). */
  needsBaseUrl: boolean;
  /** URL base fija del proveedor (no editable) cuando aplica. */
  defaultBaseUrl?: string;
  /** Modelos sugeridos en la UI; el usuario siempre puede escribir otro. */
  models: ModelInfo[];
  /** Modelo de embeddings por defecto, si el proveedor ofrece. */
  embeddingModel?: string;
  hint?: string;
};

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const OPENCODE_BASE_URL = "https://opencode.ai/zen/v1";

export const PROVIDER_INFO: Record<AiProvider, ProviderInfo> = {
  anthropic: {
    id: "anthropic",
    label: "Anthropic (Claude)",
    keysUrl: "https://console.anthropic.com/settings/keys",
    keyPrefix: "sk-ant-",
    needsBaseUrl: false,
    models: [
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", tag: "recomendado", judge: true, note: "Rápido y barato; ideal para atención por chat." },
      { id: "claude-sonnet-5", label: "Claude Sonnet 5", tag: "calidad", note: "Mejor redacción y razonamiento; más caro." },
      { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
      { id: "claude-opus-5", label: "Claude Opus 5", note: "El más capaz; solo para casos exigentes." },
    ],
    hint: "No ofrece embeddings: si usas conocimiento documental, el modelo de embeddings sale de otro proveedor.",
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    keysUrl: "https://platform.openai.com/api-keys",
    keyPrefix: "sk-",
    needsBaseUrl: false,
    models: [
      { id: "gpt-5-mini", label: "GPT-5 mini", tag: "recomendado", judge: true },
      { id: "gpt-5-nano", label: "GPT-5 nano", tag: "economico", judge: true },
      { id: "gpt-5", label: "GPT-5", tag: "calidad" },
      { id: "gpt-4o-mini", label: "GPT-4o mini" },
    ],
    embeddingModel: "text-embedding-3-small",
  },
  google: {
    id: "google",
    label: "Google (Gemini)",
    keysUrl: "https://aistudio.google.com/apikey",
    keyPrefix: "AIza",
    needsBaseUrl: false,
    models: [
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", tag: "recomendado", judge: true },
      { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite", tag: "economico", judge: true },
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", tag: "calidad" },
    ],
    embeddingModel: "text-embedding-004",
  },
  opencode: {
    id: "opencode",
    label: "OpenCode Zen",
    keysUrl: "https://opencode.ai/auth",
    needsBaseUrl: false,
    defaultBaseUrl: OPENCODE_BASE_URL,
    models: [
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", tag: "recomendado", judge: true, note: "$1 / $5 por millón de tokens." },
      { id: "gpt-5.4-mini", label: "GPT 5.4 Mini", tag: "recomendado", judge: true, note: "$0.75 / $4.50." },
      { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite", tag: "economico", judge: true, note: "$0.30 / $2.50." },
      { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash", tag: "economico", judge: true, note: "Desde $0.22 / $0.66." },
      { id: "gpt-5.4-nano", label: "GPT 5.4 Nano", tag: "economico", judge: true, note: "$0.20 / $1.25." },
      { id: "claude-sonnet-5", label: "Claude Sonnet 5", tag: "calidad", note: "$2 / $10." },
      { id: "gpt-5.6-sol", label: "GPT 5.6 Sol", tag: "calidad", note: "Desde $2 / $10." },
      { id: "kimi-k2.6", label: "Kimi K2.6", note: "$0.95 / $4." },
      { id: "big-pickle", label: "Big Pickle", tag: "gratis", judge: true, note: "Gratis; calidad variable, útil para pruebas." },
      { id: "mimo-v2.5-free", label: "MiMo V2.5 (gratis)", tag: "gratis", judge: true },
      { id: "nemotron-3-ultra-free", label: "Nemotron 3 Ultra (gratis)", tag: "gratis" },
    ],
    hint: "Una sola clave para modelos de Anthropic, OpenAI, Google, DeepSeek, Kimi y más, con 7 modelos gratis. Requiere cuenta en opencode.ai con facturación para los de pago.",
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter (cualquier modelo)",
    keysUrl: "https://openrouter.ai/settings/keys",
    keyPrefix: "sk-or-",
    needsBaseUrl: false,
    defaultBaseUrl: OPENROUTER_BASE_URL,
    models: [
      { id: "anthropic/claude-haiku-4.5", label: "Claude Haiku 4.5", tag: "recomendado", judge: true },
      { id: "openai/gpt-5-mini", label: "GPT-5 mini", tag: "recomendado", judge: true },
      { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash", tag: "economico", judge: true },
      { id: "deepseek/deepseek-chat-v3.1", label: "DeepSeek V3.1", tag: "economico" },
      { id: "anthropic/claude-sonnet-4.5", label: "Claude Sonnet 4.5", tag: "calidad" },
      { id: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B" },
    ],
    embeddingModel: "openai/text-embedding-3-small",
    hint: "Requiere créditos cargados en openrouter.ai/settings/credits.",
  },
  compat: {
    id: "compat",
    label: "Compatible con OpenAI (Groq, DeepSeek, Ollama, Together…)",
    keysUrl: "https://console.groq.com/keys",
    needsBaseUrl: true,
    models: [
      { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B (Groq)", tag: "recomendado", judge: true, note: "Groq: https://api.groq.com/openai/v1 · capa gratis." },
      { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B (Groq)", tag: "economico", judge: true },
      { id: "deepseek-chat", label: "DeepSeek Chat", tag: "economico", note: "DeepSeek: https://api.deepseek.com/v1" },
      { id: "qwen2.5:14b", label: "Qwen 2.5 14B (Ollama)", tag: "gratis", note: "Ollama en tu servidor: http://ollama:11434/v1" },
    ],
    hint: "URL base sin /chat/completions. Ejemplos: https://api.groq.com/openai/v1 · https://api.deepseek.com/v1 · http://ollama:11434/v1",
  },
};

export function isAiProvider(v: string): v is AiProvider {
  return (AI_PROVIDERS as readonly string[]).includes(v);
}

/** Modelo sugerido por defecto para un proveedor (el primer "recomendado"). */
export function defaultModelFor(provider: AiProvider): string {
  const info = PROVIDER_INFO[provider];
  return (info.models.find((m) => m.tag === "recomendado") ?? info.models[0])?.id ?? "";
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
