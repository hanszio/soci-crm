import { eq, sql } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { SEED_STAGES } from "@/server/auth/on-signup";
import { DEFAULT_BRANDING, normalizeBranding } from "@/lib/branding";

/**
 * T3.1 — Alta de una empresa desde la consola del propietario.
 *
 * Vocero nace "una instancia = un negocio": el registro público solo crea la
 * PRIMERA organización. Soci aloja varias empresas en la misma instancia, así
 * que el propietario de la plataforma da de alta cada empresa con su propio
 * usuario dueño. Cada empresa conecta su número de WhatsApp (los webhooks se
 * enrutan por phone_number_id) y su calendario; nada se comparte.
 */

export class CreateOrgError extends Error {
  code: "slug_taken" | "email_taken" | "invalid";
  constructor(code: CreateOrgError["code"], message: string) {
    super(message);
    this.name = "CreateOrgError";
    this.code = code;
  }
}

/** "Recepciones & Bodas Golden" → "recepciones-bodas-golden". */
export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function randomId(): string {
  // Mismo alfabeto/longitud que usa Better Auth para user/account.
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let out = "";
  for (let i = 0; i < 32; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export async function createOrganization(input: {
  name: string;
  slug?: string | null;
  /** Moneda del negocio; por defecto soles (la agencia es peruana). */
  currency?: string;
  owner: { email: string; password: string; name: string };
}): Promise<{ organizationId: string; slug: string; userId: string }> {
  const name = input.name.trim();
  const slug = (input.slug?.trim() || slugify(name)) || "empresa";
  const email = input.owner.email.trim().toLowerCase();
  if (!name || !email || input.owner.password.length < 8) {
    throw new CreateOrgError("invalid", "Nombre, correo y contraseña (mín. 8) son obligatorios");
  }
  const db = getDb();
  const passwordHash = await hashPassword(input.owner.password);

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(874202)`);
    const dupSlug = await tx
      .select({ id: schema.organization.id })
      .from(schema.organization)
      .where(eq(schema.organization.slug, slug))
      .limit(1);
    if (dupSlug[0]) throw new CreateOrgError("slug_taken", `Ya existe una empresa con el slug "${slug}"`);
    const dupEmail = await tx
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.email, email))
      .limit(1);
    if (dupEmail[0]) throw new CreateOrgError("email_taken", `Ya existe un usuario con el correo ${email}`);

    const userId = randomId();
    await tx.insert(schema.user).values({
      id: userId,
      name: input.owner.name.trim() || name,
      email,
      emailVerified: true,
    });
    await tx.insert(schema.account).values({
      id: randomId(),
      accountId: userId,
      providerId: "credential",
      userId,
      password: passwordHash,
    });

    const organizationId = newId("organization");
    // La marca nace con el nombre de la empresa: nadie debería ver "Vocero".
    const branding = normalizeBranding({
      ...DEFAULT_BRANDING,
      name: name.slice(0, 30),
      currency: (input.currency ?? "PEN") as typeof DEFAULT_BRANDING.currency,
    });
    await tx.insert(schema.organization).values({
      id: organizationId,
      name,
      slug,
      metadata: JSON.stringify({ branding }),
    });
    await tx.insert(schema.member).values({
      id: newId("member"),
      organizationId,
      userId,
      role: "owner",
    });
    await tx.insert(schema.pipelineStage).values(
      SEED_STAGES.map((s, i) => ({
        id: newId("stage"),
        organizationId,
        name: s.name,
        position: i,
        kind: s.kind,
      }))
    );
    await tx.insert(schema.agentProfile).values({
      id: newId("agentProfile"),
      organizationId,
    });
    return { organizationId, slug, userId };
  });
}

export async function listOrganizations(): Promise<
  { id: string; name: string; slug: string | null; createdAt: Date; ownerEmail: string | null }[]
> {
  const db = getDb();
  const orgs = await db.select().from(schema.organization);
  const owners = await db
    .select({
      organizationId: schema.member.organizationId,
      email: schema.user.email,
    })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
    .where(eq(schema.member.role, "owner"));
  const byOrg = new Map(owners.map((o) => [o.organizationId, o.email]));
  return orgs.map((o) => ({
    id: o.id,
    name: o.name,
    slug: o.slug,
    createdAt: o.createdAt,
    ownerEmail: byOrg.get(o.id) ?? null,
  }));
}
