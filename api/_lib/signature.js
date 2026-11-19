// 서명 검증 (FEATURES.md F-07)
import bcrypt from 'bcryptjs';
import { badRequest } from './http.js';

const MAX_IMAGE_BYTES = 50 * 1024;
const PNG_PREFIX = 'data:image/png;base64,';

/**
 * 입력: { type: 'image', data } 또는 { type: 'typed', name, password }
 * 반환: { signature, signature_type }
 */
export async function verifySignature(sql, user, input, field = 'signature') {
  if (!input || typeof input !== 'object') throw badRequest('서명이 필요합니다.', { [field]: '서명을 입력해 주세요.' });
  if (input.type === 'image') {
    const data = typeof input.data === 'string' ? input.data : '';
    if (!data.startsWith(PNG_PREFIX)) throw badRequest('서명 형식이 올바르지 않습니다.', { [field]: '서명을 다시 입력해 주세요.' });
    const b64 = data.slice(PNG_PREFIX.length);
    if (!/^[A-Za-z0-9+/]+=*$/.test(b64)) throw badRequest('서명 형식이 올바르지 않습니다.', { [field]: '서명을 다시 입력해 주세요.' });
    const bytes = Buffer.from(b64, 'base64');
    if (bytes.length > MAX_IMAGE_BYTES) throw badRequest('서명 이미지가 너무 큽니다.', { [field]: '서명을 지우고 다시 입력해 주세요.' });
    if (bytes.length < 100 || bytes.subarray(1, 4).toString('ascii') !== 'PNG') {
      throw badRequest('서명 형식이 올바르지 않습니다.', { [field]: '서명을 다시 입력해 주세요.' });
    }
    return { signature: data, signature_type: 'image' };
  }
  if (input.type === 'typed') {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (name !== user.name) throw badRequest('대체 서명 이름이 일치하지 않습니다.', { [field]: `본인 이름(${user.name})을 정확히 입력해 주세요.` });
    const [row] = await sql`select password_hash from users where id = ${user.id}`;
    const ok = typeof input.password === 'string' && row && (await bcrypt.compare(input.password, row.password_hash));
    if (!ok) throw badRequest('비밀번호가 맞지 않습니다.', { [field]: '비밀번호를 다시 확인해 주세요.' });
    const at = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short' }).format(new Date());
    return { signature: `전자 확인: ${user.name} (${at})`, signature_type: 'typed' };
  }
  throw badRequest('서명이 필요합니다.', { [field]: '서명을 입력해 주세요.' });
}
