// HTTP 공통: 오류 형식, 본문 읽기, 응답
export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra; // { fields, code, ... }
  }
}
export const badRequest = (message, fields, extra = {}) => new HttpError(400, message, { fields, ...extra });
export const forbidden = (message = '이 작업을 할 권한이 없습니다.') => new HttpError(403, message);
export const notFound = (message = '대상을 찾을 수 없습니다.') => new HttpError(404, message);
export const conflict = (message, extra = {}) => new HttpError(409, message, extra);

const MAX_BODY = 1024 * 1024; // 1MB (서명 이미지 포함 충분)

export async function readJson(req) {
  if (req.body !== undefined && req.body !== null && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return parse(req.body);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, '요청 크기가 너무 큽니다.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return parse(Buffer.concat(chunks).toString('utf8'));
}
function parse(text) {
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw new HttpError(400, '요청 형식이 올바르지 않습니다.'); }
}

export function send(res, status, data, headers = {}) {
  const body = data === undefined ? '' : JSON.stringify(data);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(body);
}
