"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

/**
 * Banco de respuestas: varias formas de decir lo mismo. El asistente elige una
 * al azar sin repetir dentro de la conversación, para no sonar a plantilla.
 */

type Variant = { id: string; text: string; source: "owner" | "mined" | "ai"; active: boolean };
type KeyGroup = { key: string; group: string; label: string; hint: string; defaults: string[]; variants: Variant[] };

const SOURCE_LABEL: Record<Variant["source"], string> = {
  owner: "Tuya",
  mined: "De tus chats",
  ai: "Sugerida",
};

export function RepliesSection() {
  const [groups, setGroups] = useState<KeyGroup[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch("/api/reply-variants").catch(() => null);
    if (!res?.ok) return setGroups([]);
    setGroups(((await res.json()) as { keys: KeyGroup[] }).keys);
  }
  useEffect(() => {
    void refresh();
  }, []);

  async function add(key: string) {
    const text = (drafts[key] ?? "").trim();
    if (!text) return;
    setError(null);
    const res = await fetch("/api/reply-variants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, text }),
    }).catch(() => null);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as { error?: { message?: string } } | null;
      setError(data?.error?.message ?? "No se pudo guardar");
      return;
    }
    setDrafts((d) => ({ ...d, [key]: "" }));
    void refresh();
  }

  async function toggle(v: Variant) {
    await fetch(`/api/reply-variants/${v.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: !v.active }),
    }).catch(() => null);
    void refresh();
  }

  async function remove(id: string) {
    await fetch(`/api/reply-variants/${id}`, { method: "DELETE" }).catch(() => null);
    void refresh();
  }

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>Respuestas con variantes</CardTitle>
        <CardDescription>
          Varias formas de decir lo mismo. El asistente elige una distinta cada
          vez y no repite dentro de la misma conversación. Si no escribes las
          tuyas, usa las de fábrica. Puedes usar {"{negocio}"} y {"{agente}"}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {groups === null && <p className="text-sm text-muted-foreground">Cargando…</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {groups?.map((g) => {
          const active = g.variants.filter((v) => v.active).length;
          return (
            <div key={g.key} className="space-y-2">
              <div className="flex flex-wrap items-baseline gap-2">
                <h4 className="text-sm font-semibold">
                  <span className="font-normal text-muted-foreground">{g.group} · </span>
                  {g.label}
                </h4>
                <span className="text-xs text-muted-foreground">{g.hint}</span>
                <Badge variant="secondary" className="ml-auto">
                  {active > 0 ? `${active} tuyas activas` : `${g.defaults.length} de fábrica`}
                </Badge>
              </div>
              {g.variants.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  De fábrica: {g.defaults.map((d) => `«${d}»`).join(" · ")}
                </p>
              )}
              {g.variants.length > 0 && (
                <ul className="divide-y rounded-md border">
                  {g.variants.map((v) => (
                    <li key={v.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                      <span className={v.active ? "text-sm" : "text-sm text-muted-foreground line-through"}>
                        {v.text}
                      </span>
                      <Badge variant="secondary">{SOURCE_LABEL[v.source]}</Badge>
                      <span className="ml-auto flex gap-2">
                        <Button size="sm" variant="secondary" onClick={() => toggle(v)}>
                          {v.active ? "Apagar" : "Encender"}
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => remove(v.id)}>
                          Borrar
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-2">
                <Input
                  placeholder="Agregar otra forma de decirlo…"
                  value={drafts[g.key] ?? ""}
                  onChange={(e) => setDrafts((d) => ({ ...d, [g.key]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void add(g.key);
                  }}
                />
                <Button variant="secondary" onClick={() => add(g.key)} disabled={!(drafts[g.key] ?? "").trim()}>
                  Agregar
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
