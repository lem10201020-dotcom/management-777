// 시스템 설정: DB 값이 있으면 덮어쓰고, 없으면 기본값 (FEATURES.md F-13)
import { DEFAULT_SETTINGS } from '../../js/utils/validate.js';

export async function getSettings(sql) {
  const rows = await sql`select key, value from settings`;
  const merged = structuredClone(DEFAULT_SETTINGS);
  for (const r of rows) if (Object.hasOwn(merged, r.key)) merged[r.key] = r.value;
  return merged;
}
