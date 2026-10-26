// Acceso a Cici Empresarios: la dueña manda, ADMIN gestiona la operación
// cotidiana y VIEWER solo consulta. La vinculación de tiendas se valida aparte
// contra la dueña de cada tienda (ver lib/members.ts).
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { empresas, empresaMiembros } from "../db/schema";

export type EmpresaRole = "OWNER" | "ADMIN" | "VIEWER";

export interface EmpresaAccess {
  ok: boolean;
  status?: number;
  msg?: string;
  empresaId?: string;
  role?: EmpresaRole;
  empresa?: typeof empresas.$inferSelect;
}

function fail(status: number, msg: string): EmpresaAccess {
  return { ok: false, status, msg };
}

export async function getEmpresaAccess(
  empresaId: string,
  userId: string,
): Promise<EmpresaAccess> {
  const [empresa] = await db
    .select()
    .from(empresas)
    .where(eq(empresas.id, empresaId))
    .limit(1);

  if (!empresa) return fail(404, "Empresa no encontrada.");
  if (empresa.ownerId === userId) {
    return { ok: true, empresaId, role: "OWNER", empresa };
  }

  const [member] = await db
    .select({ role: empresaMiembros.role })
    .from(empresaMiembros)
    .where(
      and(
        eq(empresaMiembros.empresaId, empresa.id),
        eq(empresaMiembros.userId, userId),
      ),
    )
    .limit(1);

  if (!member) return fail(403, "No tienes acceso a esta empresa.");
  return { ok: true, empresaId, role: member.role, empresa };
}

/** Puede vincular tiendas y gestionar el equipo de la empresa. */
export function canManageEmpresa(role?: EmpresaRole): boolean {
  return role === "OWNER" || role === "ADMIN";
}
