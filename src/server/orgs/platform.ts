import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

/**
 * Quién manda en la plataforma: el propietario de la organización `principal`
 * (la primera, la de la agencia). Solo esa persona da de alta empresas.
 */
export const PLATFORM_SLUG = "principal";

export async function isPlatformOwner(session: {
  organizationId: string;
  role: string;
}): Promise<boolean> {
  if (session.role !== "owner") return false;
  const db = getDb();
  const rows = await db
    .select({ slug: schema.organization.slug })
    .from(schema.organization)
    .where(eq(schema.organization.id, session.organizationId))
    .limit(1);
  return rows[0]?.slug === PLATFORM_SLUG;
}
