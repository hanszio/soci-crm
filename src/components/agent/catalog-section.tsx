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
import { Label } from "@/components/ui/label";

/**
 * T5.1 — Catálogo del agente: PDF e imágenes que el bot puede mandar por
 * WhatsApp. El texto de los PDF entra al conocimiento automáticamente.
 */

type Item = {
  id: string;
  title: string;
  description: string | null;
  price: string | null;
  kind: "pdf" | "image";
  fileName: string;
  fileSize: number;
  active: boolean;
  hasText: boolean;
  textChars: number;
};

function kb(n: number): string {
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
}

export function CatalogSection() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch("/api/catalog").catch(() => null);
    if (!res?.ok) return setItems([]);
    const data = (await res.json()) as { items: Item[] };
    setItems(data.items);
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function upload() {
    if (!file || !title.trim()) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("file", file);
    form.set("title", title.trim());
    form.set("description", description.trim());
    form.set("price", price.trim());
    const res = await fetch("/api/catalog", { method: "POST", body: form }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as { error?: { message?: string } } | null;
      setError(data?.error?.message ?? "No se pudo subir");
      return;
    }
    setTitle("");
    setDescription("");
    setPrice("");
    setFile(null);
    const input = document.getElementById("catalog-file") as HTMLInputElement | null;
    if (input) input.value = "";
    void refresh();
  }

  async function toggle(it: Item) {
    await fetch(`/api/catalog/${it.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: !it.active }),
    }).catch(() => null);
    void refresh();
  }

  async function remove(id: string) {
    await fetch(`/api/catalog/${id}`, { method: "DELETE" }).catch(() => null);
    void refresh();
  }

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>Catálogo y archivos</CardTitle>
        <CardDescription>
          PDF e imágenes que el agente puede mandar por WhatsApp cuando el
          cliente pide precios, muestras o el catálogo. El texto de los PDF
          entra al conocimiento: el bot responde precios con lo que diga ahí.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="catalog-title">Título</Label>
            <Input
              id="catalog-title"
              placeholder="Lista de precios tarjetas 2026"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="catalog-price">Precio (opcional)</Label>
            <Input
              id="catalog-price"
              placeholder="S/ 80 el millar"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="catalog-desc">Cuándo mandarlo</Label>
            <Input
              id="catalog-desc"
              placeholder="Cuando pidan precios de tarjetas de presentación"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="catalog-file">Archivo (PDF, JPG, PNG, WebP)</Label>
            <Input
              id="catalog-file"
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={upload} disabled={busy || !file || !title.trim()}>
            {busy ? "Subiendo…" : "Subir al catálogo"}
          </Button>
          {error && <span className="text-sm text-destructive">{error}</span>}
        </div>

        {items === null && <p className="text-sm text-muted-foreground">Cargando…</p>}
        {items?.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Todavía no hay archivos. Sube tu lista de precios en PDF para empezar.
          </p>
        )}
        {items && items.length > 0 && (
          <ul className="divide-y rounded-md border">
            {items.map((it) => (
              <li key={it.id} className="flex flex-wrap items-center gap-2 p-3">
                <Badge variant="secondary">{it.kind === "pdf" ? "PDF" : "Imagen"}</Badge>
                <a
                  href={`/api/catalog/${it.id}/file`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-sm font-medium hover:underline"
                >
                  {it.title}
                </a>
                {it.price && <span className="text-sm text-muted-foreground">{it.price}</span>}
                <span className="text-xs text-muted-foreground">{kb(it.fileSize)}</span>
                {it.kind === "pdf" && (
                  <span className="text-xs text-muted-foreground">
                    {it.hasText ? `${it.textChars} caracteres leídos` : "sin texto legible"}
                  </span>
                )}
                {!it.active && <Badge variant="secondary">Apagado</Badge>}
                <span className="ml-auto flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => toggle(it)}>
                    {it.active ? "Apagar" : "Encender"}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => remove(it.id)}>
                    Borrar
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
