// 화면 E2E (TEST_PLAN.md E2E-01 축약판): 실제 브라우저로 주요 업무 흐름을 따라간다.
// 준비: 로컬 개발 DB에 가상 데이터 입력(npm run db:seed -- --reset) 후 개발 서버 실행(npm run dev)
// 실행: node tests/e2e/ui-flow.cjs   (BASE_URL 기본값 http://localhost:3000)
const { chromium } = require('playwright');
const assert = require('node:assert/strict');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const SHOTS = process.env.SHOTS_DIR || null;

async function login(page, id) {
  await page.goto(BASE + '/');
  await page.fill('input[name=login_id]', id);
  await page.fill('input[name=password]', 'Sample1234');
  await page.click('form button[type=submit]');
  await page.waitForSelector('.app-header');
}
async function drawSignature(page, scope = 'main') {
  const canvas = page.locator(`${scope} .sig-canvas`);
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + 20, box.y + box.height * 0.6);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(box.x + 20 + i * 18, box.y + box.height * (0.6 + (i % 2 ? -0.25 : 0.2)));
  await page.mouse.up();
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const watch = (page) => {
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/status of 4\d\d/.test(m.text())) errors.push(m.text()); });
  };

  // 1) 직원(모바일): 대시보드 할 일 → 운행일지 입력 → 손글씨 서명 → 제출
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  let page = await mobile.newPage(); watch(page);
  await login(page, 'staff01');
  await page.click('text=운행일지를 입력해 주세요');
  await page.waitForSelector('h1:has-text("운행일지 입력")');
  assert.equal(await page.inputValue('input[name=odometer_start]'), '5000');
  await page.fill('input[name=odometer_end]', '5030');
  assert.equal(await page.textContent('output'), '30km');
  await page.fill('input[name=odometer_start]', '5010'); // 불일치 → 사유 필드 표시
  assert.ok(await page.isVisible('select[name=mismatch_reason]'));
  await page.fill('input[name=odometer_start]', '5000');
  assert.equal(await page.isVisible('select[name=mismatch_reason]'), false);
  await page.click('button:has-text("서명하고 제출")');
  await page.waitForSelector('.field-error:has-text("서명을 입력해 주세요")');
  await drawSignature(page);
  await shot(page, '01-mobile-usage-log');
  await page.click('button:has-text("서명하고 제출")');
  await page.waitForSelector('.toast:has-text("제출했습니다")');
  await page.waitForFunction(() => location.hash === '#/usage-logs');

  // 2) 직원(모바일): 겹치는 예약 → 다른 차량 제안으로 바꿔 저장
  await page.goto(BASE + '/#/calendar');
  await page.click('main .page-head button:has-text("차량예약")');
  const tomorrow = await page.evaluate(() => { const d = new Date(Date.now() + 9 * 3600e3 + 86400e3); return d.toISOString().slice(0, 10); });
  const dlg = page.locator('dialog.modal');
  await dlg.locator('select[name=vehicle_id]').selectOption({ label: '레이 (34나5678, 4인승)' });
  await dlg.locator('input[name=start_date]').fill(tomorrow);
  await dlg.locator('input[name=start_time]').fill('10:30');
  await dlg.locator('input[name=end_date]').fill(tomorrow);
  await dlg.locator('input[name=end_time]').fill('11:30');
  await dlg.locator('input[name=destination]').fill('○○동 행정복지센터');
  await dlg.locator('select[name=purpose_category]').selectOption('행정업무');
  await page.click('dialog.modal button:has-text("예약 저장")');
  await page.waitForSelector('dialog.modal .form-summary:has-text("김가상님이")');
  await shot(page, '02-mobile-overlap');
  await page.click('dialog.modal button:has-text("로 바꾸기")');
  await page.click('dialog.modal button:has-text("예약 저장")');
  await page.waitForSelector('.toast:has-text("예약을 저장했습니다")');
  await mobile.close();

  // 3) 차량담당자(PC): 지난달 대장 결재요청
  const desk = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  page = await desk.newPage(); watch(page);
  await login(page, 'mgr01');
  await page.goto(BASE + '/#/ledgers');
  await page.click('main .list-item:has-text("스타리아")');
  await page.waitForSelector('#ledger-title');
  await page.click('main button:has-text("결재요청")');
  await page.fill('dialog.modal textarea[name=comment]', '지난달 운행 확인 완료');
  await page.click('dialog.modal button:has-text("결재요청")');
  await page.waitForSelector('.toast:has-text("결재를 요청했습니다")');
  await page.close();

  // 4) 1단계(팀장): 손글씨 서명 결재 / 2단계(관장): 키보드 대체 서명 결재
  const deskA1 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  page = await deskA1.newPage(); watch(page);
  await login(page, 'apv01');
  await page.click('text=결재 대기');
  await page.waitForSelector('h3:has-text("팀장 결재")');
  await drawSignature(page, 'form');
  await page.click('form button:has-text("결재")');
  await page.waitForSelector('.toast:has-text("결재했습니다")');
  await page.close();

  const deskA2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  page = await deskA2.newPage(); watch(page);
  await login(page, 'apv02');
  await page.goto(BASE + '/#/approvals');
  await page.click('main .list-item');
  await page.waitForSelector('h3:has-text("관장 결재")');
  await page.click('button:has-text("대체 서명 사용")');
  await page.keyboard.type('최관장');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Sample1234');
  await page.click('form button:has-text("결재")');
  await page.waitForSelector('.toast:has-text("결재했습니다")');
  await page.waitForSelector('main .badge:has-text("결재완료")');

  // 5) 출력 미리보기
  await page.click('main a:has-text("인쇄/PDF")');
  await page.waitForSelector('.doc-table');
  assert.equal(await page.locator('.doc-table tbody tr').count(), 3);
  assert.equal(await page.locator('.approval-box td img').count(), 1); // 팀장 손글씨
  assert.match(await page.locator('.approval-box').textContent(), /전자 확인: 최관장/);
  assert.equal(await page.locator('.watermark').count(), 0);
  await shot(page, '03-print');
  await page.emulateMedia({ media: 'print' });
  assert.equal(await page.isVisible('.sidebar'), false);
  await desk.close();
  await browser.close();

  if (errors.length) { console.error('브라우저 오류:', errors); process.exit(1); }
  console.log('화면 E2E 통과: 운행일지 입력·서명, 예약 겹침 안내·차량 제안, 결재요청, 2단계 결재(손글씨·대체 서명), 출력');
})().catch((e) => { console.error(e); process.exit(1); });
