// Browser test of the touch controls on test/touch.html (touch events through the DevTools protocol).
// Needs playwright-core and a Chromium, and the dev server (npm run dev):
//   PLAYWRIGHT=/path/to/playwright-core/index.mjs CHROME=/path/to/chrome node test/touch-controls.mjs
const { chromium } = await import( process.env.PLAYWRIGHT || 'playwright-core' );
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (m.type() === 'error' && ! /404/.test(m.text())) errs.push(m.text()); });
let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log(c ? 'ok  ' : 'FAIL', m); };
await page.goto('http://127.0.0.1:5189/test/touch.html?mode=swim&gun=1&loaded=1');
await page.waitForFunction(() => window.__t);
const cdp = await ctx.newCDPSession(page);
const touch = async (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: p[2] ?? i })) });
const L = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__t.log)));
// first touch enables
await touch('touchStart', [[150, 250, 1]]);
await page.waitForTimeout(100);
ok(await page.evaluate(() => window.__t.tc.on && window.__t.input.touch), 'the first touch turns touch controls on');
// stick: drag up = W, then up-right = W+D, all the way = Shift
for (let k = 1; k <= 6; k++) { await touch('touchMove', [[150, 250 - k * 10, 1]]); await page.waitForTimeout(16); }
await page.waitForTimeout(80);
let l = await L();
ok(l.keys.includes('KeyW') && !l.keys.includes('KeyS'), `stick up: ${l.keys}`);
ok(l.keys.includes('ShiftLeft'), 'pushed all the way: sprint');
await touch('touchMove', [[200, 210, 1]]);
await page.waitForTimeout(80);
l = await L();
ok(l.keys.includes('KeyW') && l.keys.includes('KeyD'), `stick up-right: ${l.keys}`);

// second finger on the right looks, while the stick is held
await touch('touchStart', [[200, 210, 1], [600, 150, 2]]);
for (let k = 1; k <= 5; k++) { await touch('touchMove', [[200, 210, 1], [600 + k * 10, 150 + k * 4, 2]]); await page.waitForTimeout(16); }
await page.waitForTimeout(60);
l = await L();
ok(l.look.x > 80 && l.look.y > 30, `drag right side looks (${l.look.x.toFixed(0)}, ${l.look.y.toFixed(0)})`);
ok(l.keys.includes('KeyW'), 'and the stick still holds W');
await touch('touchEnd', []);
await page.waitForTimeout(80);
l = await L();
ok(!l.keys.includes('KeyW') && !l.keys.includes('KeyD'), `released: no keys (${l.keys})`);
// buttons shown: gun out, swimming, one band of two
ok(['fire', 'aim', 'load', 'dive', 'up', 'gun', 'bag'].every(b => l.shown.includes(b)) && !l.shown.includes('cam'), `buttons for swimming with the gun: ${l.shown}`);
ok(l.prompt.key === 'Hold Load' && /Fire  shoot/.test(l.prompt.text), `prompt in button words: ${l.prompt.key} | ${l.prompt.text}`);
const box = async (id) => page.evaluate((id) => { const r = window.__t.tc.btn[id].getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, id);
// Fire: held = mouse button down
const f = await box('fire');
await touch('touchStart', [[f[0], f[1], 5]]);
await page.waitForTimeout(60);
ok((await L()).fire, 'Fire held = left button down');
await touch('touchEnd', []);
await page.waitForTimeout(60);
ok(!(await L()).fire, 'released');
// Aim taps Q (the stub toggles the latch)
const a = await box('aim');
await touch('touchStart', [[a[0], a[1], 6]]); await page.waitForTimeout(40); await touch('touchEnd', []);
await page.waitForTimeout(60);
ok(await page.evaluate(() => window.__t.spear.aimLatched && window.__t.tc.btn.aim.classList.contains('is-latched')), 'Aim tap latches aim');
// Load held = R held
const r = await box('load');
await touch('touchStart', [[r[0], r[1], 7]]); await page.waitForTimeout(60);
ok((await L()).keys.includes('KeyR'), 'Load held = R');
await touch('touchEnd', []); await page.waitForTimeout(60);
ok(!(await L()).keys.includes('KeyR'), 'Load released');
// a button press doesn't look or move
const before = (await L()).look.x;
await touch('touchStart', [[f[0], f[1], 8]]); await touch('touchMove', [[f[0] - 30, f[1], 8]]); await touch('touchEnd', []);
await page.waitForTimeout(60);
ok((await L()).look.x === before, 'dragging on a button does not turn the view');

// boat
await page.goto('http://127.0.0.1:5189/test/touch.html?mode=boat&touch');
await page.waitForFunction(() => window.__t);
await page.waitForTimeout(100);
l = await L();
ok(l.shown.includes('cam') && !l.shown.includes('fire') && !l.shown.includes('dive'), `at the helm: ${l.shown}`);
ok(errs.length === 0, 'no page errors ' + errs.join(' | '));
console.log(fails ? fails + ' failed' : 'all passed');
await browser.close();
process.exit(fails ? 1 : 0);
