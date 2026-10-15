// Colaboradoras de tienda: acceso operativo sin ser dueña.
// Regla: la dueña es dueña; la colaboradora opera el día a día (catálogo,
// pedidos, agenda, chat, ventas manuales). Planes, trial, referidos,
// finanzas protegidas y miembros siguen siendo solo de la dueña.
import { randomBytes } from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { stores, storeMembers, storeInvites } from "../db/schema";

export interface StoreAccess {
  ok: boolean;
  status?: number;
  msg?: string;
  storeId?: string;
  isOwner?: boolean;
}

function fail(status: number, msg: string): StoreAccess {
  return { ok: false, status, msg };
}

/** Dueña o colaboradora de la tienda. */
export async function assertStoreAccess(storeId: string, userId: string): Promise<StoreAccess> {
  const [store] = await db
    .select({ id: stores.id, ownerId: stores.ownerId })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);
  if (!store) return fail(404, "Tienda no encontrada.");
  if (store.ownerId === userId) return { ok: true, storeId: store.id, isOwner: true };
  const [member] = await db
    .select({ id: storeMembers.id })
    .from(storeMembers)
    .where(and(eq(storeMembers.storeId, store.id), eq(storeMembers.userId, userId)))
    .limit(1);
  if (!member) return fail(403, "No tienes acceso a esta tienda.");
  return { ok: true, storeId: store.id, isOwner: false };
}

/** Solo la dueña (planes, trial, finanzas, miembros, identidad). */
export async function assertStoreOwner(storeId: string, userId: string): Promise<StoreAccess> {
  const [store] = await db
    .select({ id: stores.id, ownerId: stores.ownerId })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);
  if (!store) return fail(404, "Tienda no encontrada.");
  if (store.ownerId !== userId) return fail(403, "Solo la dueña puede hacer esto.");
  return { ok: true, storeId: store.id, isOwner: true };
}

/** Tienda donde trabajo: la mía primero, si no la primera donde colaboro. */
export async function myWorkStore(userId: string): Promise<{ id: string; isOwner: boolean } | null> {
  const [owned] = await db
    .select({ id: stores.id })
    .from(stores)
    .where(eq(stores.ownerId, userId))
    .limit(1);
  if (owned) return { id: owned.id, isOwner: true };
  const [member] = await db
    .select({ storeId: storeMembers.storeId })
    .from(storeMembers)
    .where(eq(storeMembers.userId, userId))
    .limit(1);
  if (member) return { id: member.storeId, isOwner: false };
  return null;
}

/** Todas las tiendas donde trabajo (dueña o colaboradora). */
export async function myWorkStoreIds(userId: string): Promise<string[]> {
  const owned = await db
    .select({ id: stores.id })
    .from(stores)
    .where(eq(stores.ownerId, userId));
  const member = await db
    .select({ storeId: storeMembers.storeId })
    .from(storeMembers)
    .where(eq(storeMembers.userId, userId));
  return [...owned.map((s) => s.id), ...member.map((s) => s.storeId)];
}

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function makeInviteCode(): string {
  const bytes = randomBytes(6);
  let code = "";
  for (const b of bytes) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return code;
}
