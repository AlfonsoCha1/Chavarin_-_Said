import type { Db } from '../db.js';

export async function audit(
  db: Db,
  e: {
    actorKind: 'staff' | 'customer' | 'admin' | 'system' | 'public';
    actorId?: string | null;
    companyId?: string | null;
    action: string;
    entity?: string;
    entityId?: string | null;
    details?: Record<string, unknown>;
    ip?: string | null;
  },
) {
  await db.query(
    `INSERT INTO audit_log(actor_kind, actor_id, company_id, action, entity, entity_id, details, ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [e.actorKind, e.actorId ?? null, e.companyId ?? null, e.action, e.entity ?? null, e.entityId ?? null, e.details ?? null, e.ip ?? null],
  );
}
