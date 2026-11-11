// Records a continuous screen demo of the real page for LinkedIn (1080x1350, 4:5):
// one take, a visible cursor clicking the real controls, a slow camera, one caption at a time.
// The sim is stepped by hand each frame, so the video is smooth and the same every run.
// Usage: node video/record.mjs      (needs ffmpeg and gifski; puppeteer path as in screenshots/shoot.mjs)
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const require = createRequire(process.env.PUPPETEER_FROM || '/Users/igetov/Tools/life-os/linked-in carousel/node_modules/');
const puppeteer = require('puppeteer');
const dir = path.dirname(fileURLToPath(import.meta.url));
const frames = path.join(dir, '.frames'); fs.rmSync(frames, { recursive: true, force: true }); fs.mkdirSync(frames);
const FPS = 30, W = 1080, H = 1350, TOP = 190, BOT = 120, PAGE_W = 1360;
const b = await puppeteer.launch({ headless: 'shell', protocolTimeout: 600000 });
const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(String(e)));
await p.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
await p.goto(pathToFileURL(path.join(dir, '..', 'index.html')).href + '?view=2d', { waitUntil: 'networkidle0' });
await p.evaluate(() => document.fonts.ready);
await p.waitForFunction(() => window.__ls && __ls.cmp(), { timeout: 120000 });

await p.addStyleTag({ content: `
  html,body{overflow:hidden !important;background:#F3F4F6 !important}
  #cam{position:absolute;left:0;top:0;width:${PAGE_W}px;transform-origin:0 0;background:#F3F4F6}
  #topb{position:fixed;left:0;right:0;top:0;height:${TOP}px;background:#0B1220;display:flex;align-items:center;justify-content:center;padding:0 60px;box-sizing:border-box;z-index:50}
  #topb div{font:700 46px/1.18 Inter,sans-serif;letter-spacing:-.8px;color:#fff;text-align:center;transition:none}
  #botb{position:fixed;left:0;right:0;bottom:0;height:${BOT}px;background:#0B1220;display:flex;align-items:center;justify-content:center;gap:14px;z-index:50;font:600 26px Inter,sans-serif;color:#fff}
  #botb i{width:22px;height:22px;border-radius:5px;background:#F06050;display:inline-block}
  #botb span{color:#94A3B8;font-weight:500}
  #cur{position:fixed;left:0;top:0;width:34px;height:34px;z-index:60;pointer-events:none;filter:drop-shadow(0 2px 3px rgba(0,0,0,.45))}
  #rip{position:fixed;width:56px;height:56px;margin:-28px 0 0 -28px;border-radius:50%;border:4px solid #F06050;z-index:59;pointer-events:none;opacity:0}
  #toast{display:none !important}
  #cam .top,#cam #story{display:none !important}
  #cam main.wrap{padding-top:28px !important}
` });
await p.evaluate((PAGE_W) => {
  const cam = document.createElement('div'); cam.id = 'cam';
  while (document.body.firstChild) cam.appendChild(document.body.firstChild);
  document.body.appendChild(cam);
  const add = h => { const d = document.createElement('div'); d.innerHTML = h; const e = d.firstElementChild; document.body.appendChild(e); return e; };
  add('<div id="topb"><div id="capt"></div></div>');
  add('<div id="botb"><i></i>Line Simulator<span>· free, runs in your browser · built by Ivan Getov</span></div>');
  add('<svg id="cur" viewBox="0 0 24 24"><path d="M4 2 L4 20 L9 15.5 L12.5 22.5 L15.5 21 L12 14 L19 14 Z" fill="#fff" stroke="#0B1220" stroke-width="1.6" stroke-linejoin="round"/></svg>');
  add('<div id="rip"></div>');
  window.__C = { tx: 0, ty: 0, s: 1, cx: 760, cy: 900 };
  window.__R = {
    // camera: fit a page-space rectangle into the area between the two bands
    rect(sel) { const e = typeof sel === 'string' ? document.querySelector(sel) : sel, r = e.getBoundingClientRect(), C = __C;
      return { x: (r.left - C.tx) / C.s, y: (r.top - C.ty) / C.s, w: r.width / C.s, h: r.height / C.s }; },
    union(a, b) { const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y); return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }; },
    fit(r, top, bot, W, H, pad) { const aw = W - 2 * pad, ah = H - top - bot - 2 * pad, s = Math.min(aw / r.w, ah / r.h);
      return { s, tx: W / 2 - (r.x + r.w / 2) * s, ty: top + (H - top - bot) / 2 - (r.y + r.h / 2) * s }; },
    set(v) { Object.assign(__C, v); document.getElementById('cam').style.transform = `translate(${v.tx}px,${v.ty}px) scale(${v.s})`; },
    cap(t) { document.getElementById('capt').innerHTML = t; },
    cur(x, y) { __C.cx = x; __C.cy = y; document.getElementById('cur').style.transform = `translate(${x - 6}px,${y - 3}px)`; },
    target(sel, text) { let e = document.querySelector(sel);
      if (text) e = [...document.querySelectorAll(sel)].find(x => x.textContent.trim() === text);
      const r = e.getBoundingClientRect(); return { x: r.left + r.width * 0.55, y: r.top + r.height * 0.6 }; },
    click(sel, text) { let e = document.querySelector(sel); if (text) e = [...document.querySelectorAll(sel)].find(x => x.textContent.trim() === text); e.click(); __ls.hold(); },
    rip(o, sc) { const r = document.getElementById('rip'); r.style.left = __C.cx + 'px'; r.style.top = __C.cy + 'px'; r.style.opacity = o; r.style.transform = `scale(${sc})`; },
    seed(n) { const el = document.getElementById('seed'); el.value = n; el.dispatchEvent(new Event('change')); __ls.hold(); },
    // a seed where week 45 shows the labeler jam first, and the 10x buffer run shows two labeler jams first
    pickSeed() {
      const PRE = JSON.parse(document.getElementById('presets').textContent).map(SimCore.normalize), L3 = PRE.find(x => x.id === 'plant2-line3');
      const SC = {}; LineTools.scenariosFor(L3).forEach(s => { SC[s.id] = s.cfg; });
      const evs = (id, seed) => { const s = new SimCore.Sim(SC[id], seed, false); while (s.step()) {} return s.events.filter(e => e.t0 > 31).sort((a, b) => a.t0 - b.t0); };
      const isJam = e => e.kind === 'm' && e.i === 2 && e.dur >= 900;
      for (let seed = 1; seed < 3000; seed++) {
        const a = evs('wk45', seed); if (!a.length || !isJam(a[0]) || a[0].t0 < 1500 || a[0].t0 > 5400) continue;
        const bb = evs('wk45buf', seed); if (bb.length < 2 || !isJam(bb[0]) || !isJam(bb[1]) || bb[0].t0 < 1500 || bb[0].t0 > 5400) continue;
        if (bb[1].t0 - (bb[0].t0 + bb[0].dur) > 3600 || bb[1].t0 > 13000) continue;
        const f = evs('wk45fix', seed); if (f.some(e => e.t0 < 5400 && e.kind === 'm')) continue;
        return { seed, a: a[0].t0, b0: bb[0].t0, b1: bb[1].t0 };
      }
      return null;
    }
  };
}, PAGE_W);

const R = (fn, ...a) => p.evaluate((fn, a) => __R[fn](...a), fn, a);
let fi = 0;
const cdp = await p.createCDPSession();
const snap = async () => { const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 92 }); fs.writeFileSync(path.join(frames, String(fi++).padStart(5, '0') + '.jpg'), Buffer.from(data, 'base64')); };
const ease = x => x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
let cam = null, simRate = 4;
const label = () => 'running';
// one frame: advance the sim, move camera/cursor if asked, capture
const frame = async (opts = {}) => {
  await p.evaluate((n, lab) => { window.__runLabel = lab; __ls.advance(n, 1 / 30); }, opts.sim ?? simRate, label(opts.sim ?? simRate));
  if (opts.cam) await R('set', opts.cam);
  if (opts.cur) await R('cur', opts.cur.x, opts.cur.y);
  if (opts.rip) await R('rip', opts.rip[0], opts.rip[1]);
  await p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); // let the page finish painting this frame
  await snap();
};
const hold = async (sec, sim) => { for (let k = 0; k < Math.round(sec * FPS); k++) await frame({ sim: typeof sim === 'function' ? sim(k / (sec * FPS)) : sim }); };
const lerp = (a, b, t) => a + (b - a) * t;
const camTo = async (target, sec, sim, pad = 24) => {
  const to = await R('fit', target, TOP, BOT, W, H, pad), from = cam;
  for (let k = 1; k <= Math.round(sec * FPS); k++) { const t = ease(k / (sec * FPS)); cam = { s: lerp(from.s, to.s, t), tx: lerp(from.tx, to.tx, t), ty: lerp(from.ty, to.ty, t) }; await frame({ cam, sim }); }
};
const clickOn = async (sel, text, sim) => {
  const from = await p.evaluate(() => ({ x: __C.cx, y: __C.cy })), to = await R('target', sel, text);
  const n = Math.round(0.65 * FPS);
  for (let k = 1; k <= n; k++) { const t = ease(k / n); await frame({ sim, cur: { x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t) - Math.sin(t * Math.PI) * 30 } }); }
  await R('click', sel, text);
  for (let k = 0; k < 9; k++) await frame({ sim: 0, rip: [1 - k / 9, 0.5 + k / 9] });
  await R('rip', 0, 1);
};

// set up: Line 3, a seed that shows the jams early, week 45 running
const pick = await R('pickSeed');
if (!pick) throw new Error('no suitable seed');
console.log('seed', pick.seed, 'jam at', (pick.a / 60).toFixed(1), 'min; buffer run jams at', (pick.b0 / 60).toFixed(1), (pick.b1 / 60).toFixed(1));
await R('seed', pick.seed);
await R('click', '#scChips .pchip', 'Week 45');
await p.evaluate(() => __ls.advance(600, 1 / 30));
// camera framings: the whole simulator card, the first three machines (where the jam happens), and the controls
const lineArea = await p.evaluate(() => __R.rect('#lineCard'));
const first3 = await p.evaluate(() => { const m = document.querySelectorAll('#lineSvg .mach'); const r = __R.union(__R.rect(m[0]), __R.rect(m[2])); r.y -= 40; r.h += 300; return r; }); // machines + buffers + start of the timeline
const around = sel => p.evaluate(sel => { const r = __R.rect(sel), w = 760, h = 900; return { x: r.x + r.w / 2 - w / 2, y: r.y + r.h / 2 - h / 2 + 260, w, h }; }, sel);
const near = (sel, text) => p.evaluate((sel, text) => { let e = document.querySelector(sel); if (text) e = [...document.querySelectorAll(sel)].find(x => x.textContent.trim() === text);
  const r = __R.rect(e); return { x: r.x + r.w / 2 - 430, y: r.y - 70, w: 860, h: 640 }; }, sel, text);
cam = await R('fit', lineArea, TOP, BOT, W, H, 18); await R('set', cam);
await R('cur', 900, 1150);

// 0. what this is
await R('cap', 'I built a Claude skill that simulates<br>your production line.');
await hold(2.6, 6);
// 1. the problem: the whole line, then in close
await R('cap', 'Test case: Line 3 loses 2,416 bottles<br>a shift to a jamming labeler.');
await hold(1.2, 6);
await camTo(first3, 1.1, 6, 20);
await hold(0.8, 6);
// click "Skip to next stop" with the camera following the cursor
await camTo(await near('#btnSkip'), 0.7, 6, 10);
await clickOn('#btnSkip', null, 6);
// 2. the jam
await R('cap', 'When the labeler jams,<br>everything before it stops.');
await camTo(first3, 0.8, 2, 20);
await hold(4.2, x => 2 + x * 12);
// 3. plan A: more conveyor
await R('cap', 'Plan A: 10× more conveyor<br>in front of the labeler.');
await camTo(await near('#scChips .pchip', 'Wk 45 + big buffer'), 0.8, 10, 10);
await clickOn('#scChips .pchip', 'Wk 45 + big buffer', 8);
await camTo(await near('#btnSkip'), 0.6, 8, 10);
await clickOn('#btnSkip', null, 8);
await camTo(first3, 0.8, 3, 20);
await R('cap', 'It fills up during the jam,<br>then drains far too slowly.');
await hold(3.4, x => 3 + x * 22);
await camTo(await near('#btnSkip'), 0.6, 10, 10);
await clickOn('#btnSkip', null, 10);
await camTo(first3, 0.7, 3, 20);
await R('cap', 'Still full when the next jam hits.<br>Only 27% of the loss comes back.');
await hold(3.0, x => 3 + x * 8);
// 4. plan B: fix the cause
await R('cap', 'Plan B: fix the label stock.');
await camTo(await near('#scChips .pchip', 'Wk 45 + labeler fixed'), 0.8, 10, 10);
await clickOn('#scChips .pchip', 'Wk 45 + labeler fixed', 20);
await camTo(first3, 0.9, 20, 20);
await R('cap', 'Plan B: fix the label stock.<br>The line just keeps running.');
await hold(2.4, 30);
// 5. the answer over 200 shifts
await R('cap', '200 simulated shifts each:<br>more conveyor 27% back, the fix 100%.');
const cmpArea = await p.evaluate(() => { const r = __R.union(__R.rect('#cmpCard .sh'), __R.rect('#cmpRows')); r.w *= 0.66; return r; });
await camTo(cmpArea, 1.5, 30, 20);
await hold(3.4, 30);
// LinkedIn cut (FOR=linkedin) points to the comments; the page/README cut shows the URL
const LI = process.env.FOR === 'linkedin';
await R('cap', 'Free simulator + Claude skill.<br>Download it and try it on your line.');
await p.evaluate(LI => { document.querySelector('#botb').innerHTML = LI ? '<i></i>Free download<span>· link in the comments</span>' : '<i></i>Free line simulator<span>· ivanegetov-lab.github.io/line-sim</span>'; }, LI);
await hold(2.6, 30);
await b.close();
if (errs.length) console.log('page errors:', errs);
console.log(fi, 'frames,', (fi / FPS).toFixed(1), 's');

const mp4 = path.join(dir, LI ? 'line-sim-linkedin.mp4' : 'line-sim-demo.mp4'), gif = path.join(dir, LI ? 'line-sim-linkedin.gif' : 'line-sim-demo.gif');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(frames, '%05d.jpg'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-preset', 'slow', '-movflags', '+faststart', mp4]);
const gf = path.join(dir, '.gif'); fs.rmSync(gf, { recursive: true, force: true }); fs.mkdirSync(gf);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4, '-vf', 'fps=12,scale=540:-1:flags=lanczos', path.join(gf, '%04d.png')]);
execFileSync('gifski', ['--quiet', '--fps', '12', '--width', '540', '--quality', '80', '-o', gif, ...fs.readdirSync(gf).sort().map(f => path.join(gf, f))]);
fs.rmSync(gf, { recursive: true, force: true });
for (const f of [mp4, gif]) console.log(path.basename(f), (fs.statSync(f).size / 1e6).toFixed(2), 'MB');
