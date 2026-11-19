// 체험 모드 E2E: DB 없이 배포된 서버에서 자동으로 체험 모드로 들어가 전체 흐름이 되는지 확인한다.
// 실행: DATABASE_URL= PORT=3001 npm run dev  →  BASE_URL=http://localhost:3001 node tests/e2e/demo-flow.cjs
const { chromium } = require('playwright');
const assert = require('node:assert/strict');

const BASE = process.env.BASE_URL || 'http://localhost:3001';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const quick = async (label) => {
    await page.click(`.auth-card button:has-text("${label}")`);
    await page.waitForSelector('.app-header');
    assert.ok(await page.isVisible('.app-header .badge:has-text("체험 모드")'));
  };
  const logout = async () => {
    await page.click('button[aria-label="로그아웃"]');
    await page.waitForSelector('.auth-card button:has-text("관리자")');
  };
  const typedSign = async (name) => {
    await page.click('button:has-text("대체 서명 사용")');
    await page.fill('input[id$="-typed-name"]', name);
    await page.fill('input[id$="-typed-pw"]', 'Sample1234');
  };

  // 서버에 DB가 없으면 자동으로 체험 모드 로그인 화면
  await page.goto(BASE + '/');
  await page.waitForSelector('text=체험 모드 (서버 없이 동작)');

  // 직원: 운행일지 입력 (대체 서명)
  await quick('직원');
  await page.click('text=운행일지를 입력해 주세요');
  await page.fill('input[name=odometer_end]', '5030');
  await typedSign('홍길동');
  await page.click('button:has-text("서명하고 제출")');
  await page.waitForSelector('.toast:has-text("제출했습니다")');
  await logout();

  // 차량담당자: 지난달 대장 결재요청
  await quick('차량담당자');
  await page.goto(BASE + '/#/ledgers');
  await page.click('main .list-item:has-text("스타리아")');
  await page.click('main button:has-text("결재요청")');
  await page.click('dialog.modal button:has-text("결재요청")');
  await page.waitForSelector('.toast:has-text("결재를 요청했습니다")');
  await logout();

  // 1·2단계 결재
  for (const [label, name] of [['1단계', '박팀장'], ['2단계', '최관장']]) {
    await quick(label);
    await page.click('text=결재 대기');
    await page.waitForSelector('form h3:has-text("결재")');
    await typedSign(name);
    await page.click('form button[type=submit]:has-text("결재")');
    await page.waitForSelector('.toast:has-text("결재했습니다")');
    await logout();
  }

  // 결과: 잠금 + 출력
  await quick('차량담당자');
  await page.goto(BASE + '/#/ledgers');
  await page.click('main .list-item:has-text("스타리아")');
  await page.waitForSelector('main .badge:has-text("결재완료")');
  await page.click('main a:has-text("인쇄/PDF")');
  await page.waitForSelector('.doc-table');
  assert.equal(await page.locator('.doc-table tbody tr').count(), 3);
  assert.match(await page.locator('.approval-box').textContent(), /최관장/);

  // 새로고침해도 체험 데이터 유지
  await page.reload();
  await page.waitForSelector('.doc-table');
  await browser.close();
  if (errors.length) { console.error('브라우저 오류:', errors); process.exit(1); }
  console.log('체험 모드 E2E 통과: 자동 전환, 운행일지, 결재요청, 2단계 결재, 출력, 새로고침 유지');
})().catch((e) => { console.error(e); process.exit(1); });
