import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { CreateOrgError, createOrganization, listOrganizations } from "@/server/orgs/create";
import { isPlatformOwner } from "@/server/orgs/platform";

export const dynamic = "force-dynamic";

/**
 * T3.1 — Consola del propietario: empresas alojadas en esta instancia.
 * Solo el propietario de la organización `principal`. Para cualquier otro la
 * superficie no existe (404), igual que los módulos apagados.
 */
export const GET = withAuth(async (session) => {
  if (!(await isPlatformOwner(session))) return apiError(404, "not_found", "No encontrado");
  return Response.json({ organizations: await listOrganizations() });
});

const postSchema = z.object({
  name: z.string().trim().min(1).max(80),
  slug: z.string().trim().min(1).max(40).regex(/^[a-z0-9-]+$/).optional(),
  ownerEmail: z.string().trim().email(),
  ownerPassword: z.string().min(8).max(200),
  ownerName: z.string().trim().min(1).max(80),
  currency: z.string().trim().min(3).max(3).optional(),
});

export const POST = withAuth(async (session, req: Request) => {
  if (!(await isPlatformOwner(session))) return apiError(404, "not_found", "No encontrado");
  const body = await parseBody(req, postSchema);
  if (!body.ok) return body.response;
  try {
    const created = await createOrganization({
      name: body.data.name,
      slug: body.data.slug ?? null,
      currency: body.data.currency,
      owner: {
        email: body.data.ownerEmail,
        password: body.data.ownerPassword,
        name: body.data.ownerName,
      },
    });
    return Response.json({ organization: created }, { status: 201 });
  } catch (err) {
    if (err instanceof CreateOrgError) {
      return apiError(err.code === "invalid" ? 422 : 409, err.code, err.message);
    }
    throw err;
  }
});
