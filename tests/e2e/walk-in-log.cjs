// 예약 없이 운행일지 쓰기 E2E (체험 모드 서버, 모바일 화면)
// 실행: DATABASE_URL= PORT=3001 npm run dev  →  BASE_URL=http://localhost:3001 node tests/e2e/walk-in-log.cjs
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const BASE = process.env.BASE_URL || 'http://localhost:3001';

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + '/?demo=1');
  await page.click('.auth-card button:has-text("직원")');
  await page.waitForSelector('.app-header');

  await page.click('main a:has-text("예약 없이 운행일지 쓰기")');
  await page.waitForSelector('h1:has-text("운행일지 입력")');
  const opts = await page.locator('select[name=vehicle_id] option').allTextContents();
  assert.ok(!opts.some((o) => o.includes('카니발')), '점검중 차량은 목록에 없어야 함');
  await page.selectOption('select[name=vehicle_id]', { label: '레이 (34나5678)' });
  await page.waitForFunction(() => document.querySelector('input[name=odometer_start]').value === '5000');
  await page.fill('input[name=depart_time]', '00:10');
  await page.fill('input[name=return_time]', '00:40');
  await page.fill('input[name=odometer_end]', '5012');
  await page.fill('input[name=destination]', '△△동 주민센터');
  await page.selectOption('select[name=purpose_category]', '행정업무');
  await page.click('button:has-text("대체 서명 사용")');
  await page.fill('input[id$="-typed-name"]', '홍길동');
  await page.fill('input[id$="-typed-pw"]', 'Sample1234');
  await page.click('button:has-text("서명하고 제출")');
  await page.waitForSelector('.toast:has-text("제출했습니다")');
  await page.waitForFunction(() => location.hash === '#/usage-logs');
  await page.waitForSelector('main .list-item:has-text("레이")');

  // 같은 시간에 한 번 더 → 겹침 안내
  await page.click('main a:has-text("예약 없이 운행일지 쓰기")');
  await page.selectOption('select[name=vehicle_id]', { label: '레이 (34나5678)' });
  await page.waitForFunction(() => document.querySelector('input[name=odometer_start]').value === '5012');
  await page.fill('input[name=depart_time]', '00:20');
  await page.fill('input[name=return_time]', '00:50');
  await page.fill('input[name=odometer_end]', '5020');
  await page.fill('input[name=destination]', '□□마트');
  await page.selectOption('select[name=purpose_category]', '물품 운반');
  await page.click('button:has-text("임시저장")');
  await page.waitForSelector('.field-error:has-text("시간이 겹칩니다")');
  await browser.close();
  if (errors.length) { console.error('브라우저 오류:', errors); process.exit(1); }
  console.log('예약 없이 운행일지 E2E 통과: 직원 작성·계기판 자동 채움·점검중 차량 제외·제출, 시간 겹침 안내');
})().catch((e) => { console.error(e); process.exit(1); });
