import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Server-side persistence for the trusted DEV wallets list.
 * The browser copy (localStorage) stays as an offline fallback; when a session
 * is present these functions are the source of truth, so the list survives
 * another browser, a cleared storage, and redeploys.
 *
 * Server-only modules are imported dynamically — this file is imported from
 * the client bundle (createServerFn RPC).
 */

export interface AllowDevRow {
  address: string;
  original: string | null;
  label: string | null;
}

/** Resolve the signed-in user id, or null when nobody is signed in / auth off. */
async function currentUserId(): Promise<string | null> {
  const { requireUserId } = await import("@/lib/auth/verify.server.ts");
  try {
    return await requireUserId();
  } catch {
    return null;
  }
}

export const listAllowDevs = createServerFn({ method: "POST" }).handler(async (): Promise<AllowDevRow[] | null> => {
  const userId = await currentUserId();
  if (!userId) return null;
  const { getSql } = await import("@/lib/db.ts");
  const sql = await getSql();
  return sql.query<AllowDevRow>(
    "select address, original, label from allow_devs where user_id = $1 order by created_at asc",
    [userId],
  );
});

export const saveAllowDev = createServerFn({ method: "POST" })
  .validator(
    z.object({
      address: z.string().min(32).max(48),
      original: z.string().min(32).max(64),
      label: z.string().max(120).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const userId = await currentUserId();
    if (!userId) return { ok: false as const, error: "unauthorized" };
    const { getSql } = await import("@/lib/db.ts");
    const sql = await getSql();
    await sql.query(
      `insert into allow_devs (user_id, address, original, label)
       values ($1, $2, $3, $4)
       on conflict (user_id, address) do update set original = excluded.original, label = excluded.label`,
      [userId, data.address.toLowerCase(), data.original, data.label ?? null],
    );
    return { ok: true as const };
  });

export const deleteAllowDev = createServerFn({ method: "POST" })
  .validator(z.object({ address: z.string().min(32).max(48) }))
  .handler(async ({ data }) => {
    const userId = await currentUserId();
    if (!userId) return { ok: false as const, error: "unauthorized" };
    const { getSql } = await import("@/lib/db.ts");
    const sql = await getSql();
    await sql.query("delete from allow_devs where user_id = $1 and address = $2", [
      userId,
      data.address.toLowerCase(),
    ]);
    return { ok: true as const };
  });
