// 결재라인 편집 E2E (체험 모드 서버에서 실행): 단계 추가·순서 변경·결재자 지정 → 출력 결재란 반영, 전체 차량 인쇄
// 실행: DATABASE_URL= PORT=3001 npm run dev  →  BASE_URL=http://localhost:3001 node tests/e2e/approval-line.cjs
const { chromium } = require('playwright');
const assert = require('node:assert/strict');

const BASE = process.env.BASE_URL || 'http://localhost:3001';
const SHOTS = process.env.SHOTS_DIR || null;

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const quick = async (label) => { await page.click(`.auth-card button:has-text("${label}")`); await page.waitForSelector('.app-header'); };
  const logout = async () => { await page.click('button[aria-label="로그아웃"]'); await page.waitForSelector('.auth-card'); };

  await page.goto(BASE + '/?demo=1');
  await page.waitForSelector('text=체험 모드 (서버 없이 동작)');
  await quick('관리자');
  await page.click('.sidebar a:has-text("결재라인 설정")');
  await page.waitForSelector('h1:has-text("결재라인 설정")');

  // 빈 단계 저장 시 오류 안내
  await page.click('button:has-text("결재 단계 추가")');
  await page.click('button:has-text("결재라인 저장")');
  await page.waitForSelector('.field-error:has-text("3단계 이름")');

  // 3단계 "사무국장"(이담당) 추가 → 위로 올려 2단계로
  await page.fill('#al-name-2', '사무국장');
  await page.selectOption('#al-pick-2', { label: '이담당 (행정지원팀)' });
  await page.click('#al-add-2');
  await page.click('button[aria-label="3단계를 위로"]');
  assert.equal(await page.inputValue('#al-name-1'), '사무국장');
  const heads = await page.locator('.approval-box th[scope=col]').allTextContents();
  assert.deepEqual(heads, ['담당', '팀장', '사무국장', '관장']);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/approval-line-editor.png`, fullPage: true });
  await page.click('button:has-text("결재라인 저장")');
  await page.waitForSelector('.toast:has-text("결재라인을 저장했습니다")');
  await logout();

  // 차량담당자: 지난달 대장 결재요청 → 출력 결재란 확인
  await quick('차량담당자');
  await page.goto(BASE + '/#/ledgers');
  await page.waitForSelector('text=결재라인: 팀장 → 사무국장 → 관장');
  await page.click('main .list-item:has-text("스타리아")');
  await page.click('main button:has-text("결재요청")');
  await page.click('dialog.modal button:has-text("결재요청")');
  await page.waitForSelector('.toast:has-text("결재를 요청했습니다")');
  await page.click('main a:has-text("인쇄/PDF")');
  await page.waitForSelector('.doc-table');
  assert.deepEqual(await page.locator('.approval-box th[scope=col]').allTextContents(), ['담당', '팀장', '사무국장', '관장']);
  assert.match(await page.locator('.approval-box td').first().textContent(), /이담당/);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/approval-line-print.png`, fullPage: true });

  // 결재 진행 중에는 결재라인 저장 불가 안내
  await logout();
  await quick('관리자');
  await page.goto(BASE + '/#/approval-line');
  await page.waitForSelector('text=결재 진행 중인 대장이 1건 있어');
  assert.equal(await page.isDisabled('button:has-text("결재라인 저장")'), true);

  // 이 달 전체 차량 인쇄: 차량마다 한 쪽
  await page.goto(BASE + '/#/ledgers');
  await page.click('main a:has-text("이 달 전체 차량 인쇄")');
  await page.waitForSelector('.paper');
  assert.equal(await page.locator('.paper').count(), 3);
  await browser.close();
  if (errors.length) { console.error('브라우저 오류:', errors); process.exit(1); }
  console.log('결재라인 E2E 통과: 단계 추가·순서 변경·결재자 지정·저장, 출력 결재란(담당+3단계), 진행 중 잠금, 전체 차량 인쇄');
})().catch((e) => { console.error(e); process.exit(1); });
