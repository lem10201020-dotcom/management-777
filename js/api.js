// fetch 래퍼: 오류 형식 통일, 세션 만료 시 재로그인 (UI_UX.md 5-2)
export class ApiError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.fields = extra.fields || {};
    this.code = extra.code;
    this.extra = extra;
  }
}

let onUnauthenticated = null;
export function setUnauthenticatedHandler(fn) { onUnauthenticated = fn; }

// 체험 모드: 서버·DB 없이 브라우저 안의 가짜 API 사용 (js/demo/mock-api.js)
const MODE_KEY = 'vl.mode';
export function isDemo() { try { return localStorage.getItem(MODE_KEY) === 'demo'; } catch { return false; } }
export function setDemo(on) { try { if (on) localStorage.setItem(MODE_KEY, 'demo'); else localStorage.removeItem(MODE_KEY); } catch { /* 무시 */ } }

async function demoApi(method, path, body, retryAuth) {
  const { demoRequest } = await import('./demo/mock-api.js');
  try {
    return await demoRequest(method, path, body);
  } catch (e) {
    const err = new ApiError(e.status || 500, e.message, e.extra || {});
    if (err.status === 401 && err.code === 'UNAUTHENTICATED' && retryAuth && onUnauthenticated) {
      if (await onUnauthenticated()) return demoApi(method, path, body, false);
    }
    throw err;
  }
}

export async function api(method, path, body, { retryAuth = true } = {}) {
  if (isDemo()) return demoApi(method, path, body, retryAuth);
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, '서버에 연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요. 입력한 내용은 그대로 있습니다.');
  }
  let data = {};
  try { data = await res.json(); } catch { /* 빈 응답 */ }
  if (res.ok) return data;
  const err = new ApiError(res.status, data?.error?.message || '요청을 처리하지 못했습니다.', data?.error || {});
  if (res.status === 401 && err.code === 'UNAUTHENTICATED' && retryAuth && onUnauthenticated) {
    const ok = await onUnauthenticated();
    if (ok) return api(method, path, body, { retryAuth: false });
  }
  throw err;
}
export const get = (path) => api('GET', path);
export const post = (path, body = {}) => api('POST', path, body);
export const patch = (path, body = {}) => api('PATCH', path, body);

export function qs(params) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, v);
  const str = s.toString();
  return str ? `?${str}` : '';
}
