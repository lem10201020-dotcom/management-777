// 감사 기록 — 비밀번호·서명 이미지·세션값은 넣지 않는다. (SECURITY.md 3-3)
export async function audit(sql, userId, action, entity, entityId, summary = {}) {
  await sql`
    insert into audit_logs (user_id, action, entity, entity_id, summary)
    values (${userId ?? null}, ${action}, ${entity}, ${entityId == null ? null : String(entityId)}, ${sql.json(summary)})`;
}
