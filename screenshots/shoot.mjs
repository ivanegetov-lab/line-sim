// Takes the layout-check screenshots and reports console errors per shot.
// Usage: node screenshots/shoot.mjs [path-to-html]      (3D shots need network access for the pinned three.js)
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const require = createRequire(process.env.PUPPETEER_FROM || '/Users/igetov/Tools/life-os/linked-in carousel/node_modules/');
const puppeteer = require('puppeteer');
const dir = path.dirname(fileURLToPath(import.meta.url));
const url = pathToFileURL(path.resolve(process.argv[2] || path.join(dir, '..', 'index.html'))).href;
const csvFile = path.join(dir, '..', '..', 'plant2-dataset', 'data', 'production', 'downtime_events.csv');
const browser = await puppeteer.launch({ headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'linesim-'));
const cdp = await page.createCDPSession();
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: tmp });
let errors = [], bad = 0;
page.on('pageerror', e => errors.push('pageerror: ' + e));
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
page.on('requestfailed', r => errors.push('request failed: ' + r.url()));
const wait = ms => new Promise(r => setTimeout(r, ms));
const open = async (q, w = 1360, h = 900, dpr = 2) => {
  await page.setViewport({ width: w, height: h, deviceScaleFactor: dpr, isMobile: w < 500, hasTouch: w < 500 });
  await page.goto('about:blank');
  await page.goto(url + q, { waitUntil: 'networkidle0' });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} return document.fonts.ready; });
  await page.waitForFunction(() => window.__ls && window.__ls.cmp(), { timeout: 90000 });
  await wait(1500);
};
const done = async (file, extra) => {
  const info = await page.evaluate(() => ({ view: __ls.view(), v3: !!__ls.v3(), err: window.__v3error || null, gl: __ls.v3() ? __ls.v3().info() : null, overflow: document.documentElement.scrollWidth - window.innerWidth }));
  console.log(`${file}: view=${info.view}${info.gl ? ` (3D ${info.gl.calls} draw calls, ${info.gl.tris} triangles)` : ''}${info.err ? ' 3D ERROR ' + info.err : ''}, horizontal overflow ${info.overflow}px${extra ? ', ' + extra : ''}; console: ${errors.length ? '\n   ' + errors.join('\n   ') : 'clean'}`);
  bad += errors.length; errors = [];
};
const shot = async (file, opt) => { const { note, ...o } = opt || {}; await page.screenshot({ path: path.join(dir, file), ...o }); await done(file, opt && opt.note); };
const shotEl = async (sel, file, note) => { const el = await page.$(sel); await el.evaluate(e => e.scrollIntoView({ block: 'start' })); await wait(300); await el.screenshot({ path: path.join(dir, file) }); await done(file, note); };
const fps = () => page.evaluate(() => new Promise(r => { let n = 0; const t0 = performance.now(); const f = () => { n++; performance.now() - t0 < 2000 ? requestAnimationFrame(f) : r(Math.round(n / 2)); }; requestAnimationFrame(f); }));

// 1. 2D, week 45, mid-shift
await open('?view=2d&preset=wk45&seed=45&t=236&play=1');
await shot('01-2d-running.png');
// 2. 3D, default angle and a second angle
await open('?view=3d&preset=wk45&seed=45&t=236&play=1');
await wait(2500);
await shot('02-3d-default-angle.png', { note: `${await fps()} frames/s in software-rendered headless Chrome` });
await page.evaluate(() => { const c = __ls.v3().camera; c.theta = -0.75; c.phi = 0.8; c.lastUser = 1e9; });
await wait(1200);
await shot('03-3d-second-angle.png');
await page.evaluate(() => { const c = __ls.v3().camera; c.theta = 0.05; c.phi = 1.32; c.lastUser = 1e9; });
await wait(1200);
await shotEl('#lineCard', '04-3d-low-front-angle.png');
// 2b. 3D during a labeler stop: down (red), blocked upstream (blue), starved downstream (amber), buffers full before the labeler
await open('?view=3d&preset=wk45&seed=45&t=160');
await wait(2500);
await shotEl('#lineCard', '04b-3d-labeler-down.png', await page.evaluate(() => 'states ' + JSON.stringify(Array.from(__ls.sim().state)) + ' buffers ' + JSON.stringify(Array.from(__ls.sim().buf))));
// 3. full page (2D) at the end of a shift, and the scenario comparison
await open('?view=2d&preset=wk45&seed=45&t=450');
await page.setViewport({ width: 1360, height: 900, deviceScaleFactor: 1 }); await wait(400);
await shot('05-full-page.png', { fullPage: true }); // 1x: a 2x capture of a page this tall repeats itself (GPU tile limit)
await page.setViewport({ width: 1360, height: 900, deviceScaleFactor: 2 }); await wait(400);
await shotEl('#cmpCard', '06-scenario-comparison.png');
// 4. build-your-line editor (Line 3), then an 8-machine custom line in 2D and 3D
await shotEl('#editor', '07-editor.png');
const eight = { name: 'Canning line 4', product: 'Sparkling water 330 ml', unit: 'cans', shift_min: 720, run_speed_factor: 0.92,
  machines: [['Depalletizer', 640, 0.2, 6], ['Rinser', 660, 0.1, 3], ['Filler', 600, 0.5, 5], ['Seamer', 620, 0.6, 4], ['Pasteurizer', 650, 0.05, 25], ['Coder', 700, 0.3, 2], ['Tray packer', 680, 0.7, 6], ['Palletizer', 720, 0.2, 9]]
    .map(([name, rated_speed, stops_per_hour, stop_mean_min]) => ({ name, rated_speed, stops_per_hour, stop_mean_min, stop_spread: 0.6 })),
  buffers: [400, 300, 150, 6000, 800, 600, 900].map(capacity => ({ capacity })) };
const enc = await page.evaluate(c => LineTools.encodeShare(SimCore.normalize(c)), eight);
await open('?view=2d&seed=7&t=300&play=1#c=' + enc);
await shotEl('#lineCard', '08-8-machines-2d.png');
await shotEl('#editor', '09-8-machines-editor.png');
await open('?view=3d&seed=7&t=300&play=1#c=' + enc);
await wait(2500);
await shotEl('#lineCard', '10-8-machines-3d.png');
// 4b. share link: the link the page gives out must reproduce the same line and the same shift in a fresh page
{ const run = () => page.evaluate(() => { document.getElementById('btnFinish').click(); const r = __ls.sim().results(); return { out: r.out, stops: r.nStops, down: r.loggedMin, cfg: JSON.stringify(__ls.cfg()) }; });
  const a = await run(), link = await page.evaluate(() => __ls.shareUrl());
  await page.goto('about:blank'); await page.goto(link, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__ls && window.__ls.cmp(), { timeout: 90000 });
  const b = await run();
  console.log(`share link (${link.length} chars): ${a.out} out, ${a.stops} stops, ${a.down.toFixed(1)} min down -> reopened: ${b.out} out, ${b.stops} stops, ${b.down.toFixed(1)} min down; config identical: ${a.cfg === b.cfg}; ${a.out === b.out && a.stops === b.stops && a.cfg === b.cfg ? 'SAME RESULT' : 'DIFFERENT RESULT'}`);
  if (!(a.out === b.out && a.cfg === b.cfg)) bad++; }
// 5. CSV import, column-mapping step
await open('?view=2d&seed=45&t=100');
if (fs.existsSync(csvFile)) {
  await page.click('#btnCsv');
  await page.evaluate(t => { __ls.csv.fileName = 'downtime_events.csv'; __ls.csvLoad(t); }, fs.readFileSync(csvFile, 'utf8'));
  await wait(600);
  await page.screenshot({ path: path.join(dir, '11-csv-import-mapping.png') }); await done('11-csv-import-mapping.png');
  await page.evaluate(() => document.getElementById('csvDlg').scrollTo && document.querySelector('#csvDlg').scrollTo(0, 1e5));
  const dlg = await page.$('#csvDlg'); const full = await dlg.evaluate(e => { const b = e.querySelector('.db') || e; b.scrollTop = b.scrollHeight; return b.scrollHeight; });
  await wait(300);
  await page.screenshot({ path: path.join(dir, '12-csv-import-result.png') }); await done('12-csv-import-result.png', 'dialog scroll height ' + full);
  await page.click('#csvClose');
} else console.log('SKIP CSV shots: dataset not found');
// 6. the 4-step story: the cards, then step 3 (big buffer) at the second labeler jam
await open('?view=2d');
await page.setViewport({ width: 1360, height: 900, deviceScaleFactor: 2 });
await page.screenshot({ path: path.join(dir, '00-hero-and-story.png') }); await done('00-hero-and-story.png');
await shotEl('#story', '13-story-steps.png');
await page.evaluate(() => document.querySelector('.step4[data-sc="wk45buf"]').click()); await wait(14000);
await page.evaluate(() => { document.getElementById('btnPlay').click(); });
await shotEl('#lineCard', '01-story-big-buffer.png', 'story plan ' + JSON.stringify(await page.evaluate(() => __ls.storyPick())));
await page.evaluate(() => document.querySelector('.step4[data-sc="wk45"]').click()); await wait(14000);
await shotEl('#lineCard', '14-story-week45-jam.png');
await shotEl('#use', '15-use-on-your-line.png');
// 7. phone width
await open('?view=2d&preset=wk45&seed=45&t=236&play=1', 390, 844, 3);
await shot('18-phone-2d.png');
// the phone page is taller than one capture can hold (it repeats after 8,192 px), so take it in three parts
await page.setViewport({ width: 390, height: 4000, deviceScaleFactor: 1, isMobile: true, hasTouch: true }); await wait(600);
for (const [k, y] of [['a', 0], ['b', 4000], ['c', 8000]]) { await page.evaluate(v => window.scrollTo(0, v), y); await wait(500); await shot(`19${k}-phone-2d-page.png`); }
await open('?view=3d&preset=wk45&seed=45&t=236&play=1', 390, 844, 3);
await wait(2500);
await shotEl('#view3d', '20-phone-3d.png');
await page.evaluate(() => document.getElementById('lineCard').scrollIntoView()); await wait(1300);
await shot('20b-phone-3d-screen.png');
// 7b. a page built by the skill (node test_skill.mjs --keep, then LINE_SIM_BUILT=/path/to/line1.html node screenshots/shoot.mjs)
if (process.env.LINE_SIM_BUILT) {
  const u = pathToFileURL(path.resolve(process.env.LINE_SIM_BUILT)).href;
  await page.setViewport({ width: 1360, height: 900, deviceScaleFactor: 2 });
  await page.goto('about:blank'); await page.goto(u + '?view=2d&seed=45&t=450', { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__ls && window.__ls.cmp(), { timeout: 90000 }); await wait(1200);
  const r = await page.evaluate(() => { const b = __ls.base(), c = __ls.cmp().rows[0].s; return `opens on "${b.name}" (${b.machines.length} machines), ${c.n} shifts: ${Math.round(c.good)} good per shift, data ${b.reference ? b.reference.good_per_shift : 'n/a'}`; });
  await shot('22-skill-built-line.png', { note: r });
  await shotEl('#cmpCard', '23-skill-built-comparison.png');
  await page.evaluate(() => document.querySelector('#valTbl').closest('.card, section, div').scrollIntoView()); await wait(400);
  await shot('24-skill-built-method.png');
}
// 8. no WebGL: the page must fall back to 2D
const b2 = await puppeteer.launch({ headless: 'new', args: ['--disable-gpu', '--disable-3d-apis', '--disable-webgl', '--disable-webgl2'] });
const p2 = await b2.newPage(); const e2 = [];
p2.on('pageerror', e => e2.push(String(e)));
await p2.setViewport({ width: 1360, height: 900, deviceScaleFactor: 2 });
await p2.goto(url + '?view=3d&preset=wk45&seed=45&t=236&play=1', { waitUntil: 'networkidle0' });
await wait(800);
await p2.screenshot({ path: path.join(dir, '21-no-webgl-fallback.png') });
console.log('21-no-webgl-fallback.png: ' + JSON.stringify(await p2.evaluate(() => ({ view: __ls.view(), why: window.__v3error, toast: document.getElementById('toast').textContent }))) + '; page errors: ' + (e2.join(' | ') || 'none'));
await b2.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(bad ? `\n${bad} console problems` : '\nno console errors or warnings in any shot');
await browser.close();
