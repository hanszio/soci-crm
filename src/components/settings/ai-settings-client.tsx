"use client";

import { useEffect, useMemo, useState } from "react";
import { AI_PROVIDERS, PROVIDER_INFO, type AiProvider } from "@/lib/ai/providers";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Settings = {
  provider: AiProvider;
  apiKeyLast4: string;
  baseUrl: string | null;
  model: string;
  judgeModel: string | null;
  updatedAt: string;
};

type ApiErr = { error?: { message?: string } };

export function AiSettingsClient() {
  const [loaded, setLoaded] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [current, setCurrent] = useState<Settings | null>(null);
  const [platformConfigured, setPlatformConfigured] = useState(false);

  const [provider, setProvider] = useState<AiProvider>("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [judgeModel, setJudgeModel] = useState("");

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const info = PROVIDER_INFO[provider];

  useEffect(() => {
    fetch("/api/settings/ai")
      .then(async (r) => {
        if (r.status === 403) {
          setForbidden(true);
          return null;
        }
        return r.ok ? ((await r.json()) as { settings: Settings | null; platformConfigured: boolean }) : null;
      })
      .then((d) => {
        if (d) {
          setPlatformConfigured(d.platformConfigured);
          if (d.settings) {
            setCurrent(d.settings);
            setProvider(d.settings.provider);
            setBaseUrl(d.settings.baseUrl ?? "");
            setModel(d.settings.model);
            setJudgeModel(d.settings.judgeModel ?? "");
          } else {
            setModel(PROVIDER_INFO.anthropic.models[0] ?? "");
          }
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  // Al cambiar de proveedor, sugerir su primer modelo si el campo está vacío o era una sugerencia del anterior.
  function changeProvider(p: AiProvider) {
    const prev = PROVIDER_INFO[provider];
    setProvider(p);
    setTestResult(null);
    if (!model || prev.models.includes(model)) setModel(PROVIDER_INFO[p].models[0] ?? "");
    if (!PROVIDER_INFO[p].needsBaseUrl && p !== "openrouter") setBaseUrl("");
  }

  const keyChanged = apiKey.trim().length > 0;
  const hasStoredKey = !!current && current.provider === provider;
  const canTest = model.trim().length > 0 && (keyChanged || hasStoredKey) && (!info.needsBaseUrl || baseUrl.trim().length > 0);
  const canSave = canTest && testResult?.ok === true;

  const payload = useMemo(
    () => ({
      provider,
      apiKey: keyChanged ? apiKey.trim() : undefined,
      baseUrl: info.needsBaseUrl || provider === "openrouter" ? (baseUrl.trim() || null) : null,
      model: model.trim(),
      judgeModel: judgeModel.trim() || null,
    }),
    [provider, apiKey, keyChanged, baseUrl, model, judgeModel, info.needsBaseUrl]
  );

  async function test() {
    setTesting(true);
    setTestResult(null);
    setSaveMsg(null);
    const res = await fetch("/api/settings/ai/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => null);
    setTesting(false);
    if (!res) return setTestResult({ ok: false, text: "Sin conexión" });
    const data = (await res.json().catch(() => null)) as ({ ok: true; latencyMs: number; model: string } & ApiErr) | null;
    if (res.ok && data?.ok) {
      setTestResult({ ok: true, text: `Responde en ${data.latencyMs} ms (${data.model}). Ya puedes guardar.` });
    } else {
      setTestResult({ ok: false, text: data?.error?.message ?? "El proveedor rechazó la prueba" });
    }
  }

  async function save() {
    setSaving(true);
    setSaveMsg(null);
    const res = await fetch("/api/settings/ai", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => null);
    setSaving(false);
    const data = (await res?.json().catch(() => null)) as ({ ok: true; settings: Settings } & ApiErr) | null;
    if (res?.ok && data?.ok) {
      setCurrent(data.settings);
      setApiKey("");
      setTestResult(null);
      setSaveMsg({ ok: true, text: "Guardado. El agente y el Laboratorio ya usan esta configuración." });
    } else {
      setSaveMsg({ ok: false, text: data?.error?.message ?? "No se pudo guardar" });
    }
  }

  async function reset() {
    if (!confirm("¿Volver a la configuración de la plataforma? Se borrará tu clave guardada.")) return;
    const res = await fetch("/api/settings/ai", { method: "DELETE" }).catch(() => null);
    if (res?.ok) {
      setCurrent(null);
      setApiKey("");
      setTestResult(null);
      setSaveMsg({ ok: true, text: "Listo: esta organización vuelve a usar la clave de la plataforma." });
    }
  }

  if (!loaded) return <p className="text-sm text-text-3">Cargando…</p>;
  if (forbidden) return <p className="text-sm text-text-3">Solo el dueño o un administrador puede configurar la IA.</p>;

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Proveedor de IA</CardTitle>
          <CardDescription>
            {current
              ? `Usando tu clave de ${PROVIDER_INFO[current.provider].label} (…${current.apiKeyLast4}) con el modelo ${current.model}.`
              : platformConfigured
                ? "Usando la clave de la plataforma. Pega la tuya para que el agente use tu proveedor y tu saldo."
                : "La plataforma no tiene IA configurada: pega tu clave para encender el agente y el Laboratorio."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="ai-provider">Proveedor</Label>
            <select
              id="ai-provider"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={provider}
              onChange={(e) => changeProvider(e.target.value as AiProvider)}
            >
              {AI_PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {PROVIDER_INFO[p].label}
                </option>
              ))}
            </select>
            <p className="text-xs text-text-3">
              Obtén tu clave en{" "}
              <a className="underline" href={info.keysUrl} target="_blank" rel="noreferrer">
                {info.keysUrl.replace(/^https?:\/\//, "")}
              </a>
              {info.hint ? ` · ${info.hint}` : ""}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ai-key">Clave de API</Label>
            <Input
              id="ai-key"
              type="password"
              autoComplete="off"
              placeholder={hasStoredKey ? `Guardada (…${current!.apiKeyLast4}). Pega otra solo si quieres cambiarla` : (info.keyPrefix ? `${info.keyPrefix}…` : "clave")}
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setTestResult(null);
              }}
            />
            <p className="text-xs text-text-3">Se guarda cifrada. Nunca se muestra completa ni sale en los registros.</p>
          </div>

          {(info.needsBaseUrl || provider === "openrouter") && (
            <div className="space-y-2">
              <Label htmlFor="ai-base">URL base {provider === "openrouter" ? "(opcional)" : ""}</Label>
              <Input
                id="ai-base"
                placeholder={provider === "openrouter" ? "https://openrouter.ai/api/v1" : "https://api.groq.com/openai/v1"}
                value={baseUrl}
                onChange={(e) => {
                  setBaseUrl(e.target.value);
                  setTestResult(null);
                }}
              />
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ai-model">Modelo principal</Label>
              <Input
                id="ai-model"
                list="ai-model-suggestions"
                value={model}
                onChange={(e) => {
                  setModel(e.target.value);
                  setTestResult(null);
                }}
              />
              <datalist id="ai-model-suggestions">
                {info.models.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
              <p className="text-xs text-text-3">Responde a tus clientes. Sugeridos: {info.models.join(", ")}.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ai-judge">Modelo juez (opcional)</Label>
              <Input
                id="ai-judge"
                list="ai-model-suggestions"
                placeholder="Igual al principal si lo dejas vacío"
                value={judgeModel}
                onChange={(e) => setJudgeModel(e.target.value)}
              />
              <p className="text-xs text-text-3">Evalúa el Laboratorio; uno barato basta.</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" onClick={test} disabled={!canTest || testing}>
              {testing ? "Probando…" : "Probar conexión"}
            </Button>
            <Button type="button" onClick={save} disabled={!canSave || saving}>
              {saving ? "Guardando…" : "Guardar"}
            </Button>
            {current && (
              <button type="button" className="text-sm text-text-3 underline" onClick={reset}>
                Volver a la configuración de la plataforma
              </button>
            )}
          </div>

          {testResult && (
            <p className={testResult.ok ? "text-sm text-emerald-600" : "text-sm text-red-600"} role="status">
              {testResult.ok ? "✓ " : "✗ "}
              {testResult.text}
            </p>
          )}
          {saveMsg && (
            <p className={saveMsg.ok ? "text-sm text-emerald-600" : "text-sm text-red-600"} role="status">
              {saveMsg.text}
            </p>
          )}
          {!testResult?.ok && (
            <p className="text-xs text-text-3">Guardar se habilita cuando la prueba de conexión pasa.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
