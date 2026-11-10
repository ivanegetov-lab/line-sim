// Records the schematic story video (1080x1350, LinkedIn 4:5): five machine blocks, bottles as dots,
// one headline and one big number per beat. Every state, buffer level and stop comes from the real
// simulation engine in index.html (Plant 2 Line 3), stepped second by second.
// Usage: node video/story.mjs      (needs ffmpeg + gifski; puppeteer path as in screenshots/shoot.mjs)
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const require = createRequire(process.env.PUPPETEER_FROM || '/Users/igetov/Tools/life-os/linked-in carousel/node_modules/');
const puppeteer = require('puppeteer');
const dir = path.dirname(fileURLToPath(import.meta.url));
const frames = path.join(dir, '.sframes'); fs.rmSync(frames, { recursive: true, force: true }); fs.mkdirSync(frames);
const FPS = 30, W = 1080, H = 1350;
const b = await puppeteer.launch({ headless: 'new' });
const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(String(e)));
await p.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
await p.goto(pathToFileURL(path.join(dir, '..', 'index.html')).href + '?view=2d', { waitUntil: 'networkidle0' });
await p.evaluate(() => document.fonts.ready);
await p.evaluate(() => __ls.story('normal')); // pauses the page's own loop

await p.addStyleTag({ content: `
  html,body{background:#0B1220 !important;overflow:hidden;margin:0}
  body>*:not(#st){display:none !important}
  #st{position:fixed;inset:0;background:#0B1220;color:#fff;font-family:Inter,sans-serif}
  #st .brand{position:absolute;left:64px;top:56px;display:flex;align-items:center;gap:12px;font:600 19px/1 Inter;letter-spacing:2.4px;color:#94A3B8}
  #st .brand i{width:18px;height:18px;border-radius:4px;background:#F06050}
  #hdr{position:absolute;left:64px;right:64px;top:124px}
  #hd{font:800 76px/1.02 Inter;letter-spacing:-2.8px}
  #sb{margin-top:18px;font:500 33px/1.3 Inter;color:#94A3B8}
  #clk{display:none}
  #big{position:absolute;left:64px;right:64px;top:1060px;display:flex;align-items:baseline;gap:20px;opacity:0}
  #big b{font:800 132px/1 Inter;letter-spacing:-5px;font-variant-numeric:tabular-nums}
  #big span{font:600 34px/1.2 Inter;color:#CBD5E1}
  #ft{position:absolute;left:64px;right:64px;bottom:58px;display:flex;justify-content:space-between;font:600 21px Inter;color:#64748B}
  #ft u{text-decoration:none;color:#F06050;font-weight:800}
  #end{position:absolute;inset:0;background:#0B1220;padding:210px 64px 0;opacity:0}
  #end h2{font:800 88px/1.02 Inter;letter-spacing:-3.2px;margin:0}
  #end h2 em{font-style:normal;color:#F06050}
  #end p{font:500 34px/1.4 Inter;color:#CBD5E1;margin:48px 0 0}
  #end .u{margin-top:26px;font:800 36px Inter;color:#fff}
  .lab{font:700 25px Inter;fill:#E2E8F0;text-anchor:middle}
  .stt{font:800 19px Inter;letter-spacing:1.4px;text-anchor:middle}
  .cnt{font:700 17px Inter;fill:#64748B;text-anchor:middle;font-variant-numeric:tabular-nums}
` });
await p.evaluate((W) => {
  const st = document.createElement('div'); st.id = 'st';
  st.innerHTML = `<div class="brand"><i></i>FREE LINE SIMULATOR</div><div id="clk"></div><div id="hdr"><div id="hd"></div><div id="sb"></div></div>
    <svg id="sv" width="${W}" height="640" style="position:absolute;left:0;top:430px"></svg>
    <div id="big"><b id="bn"></b><span id="bl"></span></div>
    <div id="ft"><span>Plant 2 open dataset · 200 simulated shifts per number</span><u>Try it on your line →</u></div>
    <div id="end"><h2>More conveyor buys time.<br><em>It doesn't stop the jams.</em></h2><p>Free simulator. Runs in your browser.<br>Put in your own line and downtime log.</p><div class="u">ivanegetov-lab.github.io/line-sim</div></div>`;
  document.body.appendChild(st);

  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, a, parent) => { const e = document.createElementNS(NS, tag); for (const k in a) e.setAttribute(k, a[k]); (parent || sv).appendChild(e); return e; };
  const sv = document.getElementById('sv');
  const PRE = JSON.parse(document.getElementById('presets').textContent).map(SimCore.normalize);
  const L3 = PRE.find(x => x.id === 'plant2-line3');
  const SC = {}; LineTools.scenariosFor(L3).forEach(s => { SC[s.id] = s.cfg; });
  const COL = ['#10B981', '#F59E0B', '#3B82F6', '#EF4444', '#94A3B8'], WORD = ['RUNNING', 'WAITING', 'BLOCKED', 'JAMMED', 'STOPPED'];
  const names = ['Filler', 'Capper', 'Labeler', 'Case packer', 'Palletizer'];
  // geometry: 5 machines in a row; conveyors between; the "big conveyor" is a serpentine under capper→labeler
  const MW = 158, MH = 168, Y = 30, X0 = 34, GAP = (W - 2 * X0 - 5 * MW) / 4;
  const mx = i => X0 + i * (MW + GAP);
  const SLOTS = 4, SPACE = GAP / (SLOTS + 1);
  const g = { m: [], c: [], dots: [], snake: null, snakeDots: [] };
  for (let i = 0; i < 4; i++) {
    const x = mx(i) + MW, y = Y + MH / 2;
    el('rect', { x: x - 2, y: y - 10, width: GAP + 4, height: 20, rx: 5, fill: '#1E293B' });
    const ds = []; for (let k = 0; k < SLOTS; k++) ds.push(el('circle', { cx: 0, cy: y, r: 6, fill: '#E2E8F0', opacity: 0 }));
    g.c.push({ x, y, ds });
  }
  for (let i = 0; i < 5; i++) {
    const x = mx(i), grp = el('g', {});
    const glow = el('rect', { x: x - 6, y: Y - 6, width: MW + 12, height: MH + 12, rx: 22, fill: 'none', 'stroke-width': 3, opacity: 0.35 }, grp);
    const box = el('rect', { x, y: Y, width: MW, height: MH, rx: 18, fill: '#111827', 'stroke-width': 3 }, grp);
    const lamp = el('circle', { cx: x + MW / 2, cy: Y + 56, r: 22 }, grp);
    const sw = el('text', { x: x + MW / 2, y: Y + 124, class: 'stt' }, grp);
    const lb = el('text', { x: x + MW / 2, y: Y + MH + 44, class: 'lab' }, grp); lb.textContent = names[i];
    g.m.push({ glow, box, lamp, sw });
  }
  // serpentine accumulation table (10 lanes) under capper → labeler
  const sx0 = mx(1) + 10, sx1 = mx(2) + MW - 10, sy0 = Y + MH + 110, lanes = 10, laneH = 32, per = 22, cA = mx(1) + MW + 8, cB = mx(2) - 8;
  const snake = el('g', { opacity: 0 });
  el('path', { d: `M ${cA} ${Y + MH / 2} V ${sy0}`, stroke: '#1E293B', 'stroke-width': 16, fill: 'none', 'stroke-linecap': 'round' }, snake);
  el('path', { d: `M ${cB} ${sy0} V ${Y + MH / 2}`, stroke: '#1E293B', 'stroke-width': 16, fill: 'none', 'stroke-linecap': 'round' }, snake);
  for (let l = 0; l < lanes; l++) el('rect', { x: sx0 - 10, y: sy0 + l * laneH - 9, width: sx1 - sx0 + 20, height: 18, rx: 9, fill: '#1E293B' }, snake);
  for (let l = 0; l < lanes; l++) for (let k = 0; k < per; k++) {
    const lx = l % 2 ? sx1 - k * ((sx1 - sx0) / (per - 1)) : sx0 + k * ((sx1 - sx0) / (per - 1));
    g.snakeDots.push(el('circle', { cx: lx, cy: sy0 + l * laneH, r: 6, fill: '#E2E8F0', opacity: 0 }, snake));
  }
  const snakeLbl = el('text', { x: (sx0 + sx1) / 2, y: sy0 + lanes * laneH + 26, class: 'cnt' }, snake); snakeLbl.setAttribute('style', 'font-size:22px;fill:#94A3B8');
  g.snake = snake;
  const bufLbl = [0, 1, 2, 3].map(i => el('text', { x: g.c[i].x + GAP / 2, y: g.c[i].y - 22, class: 'cnt' }));
  sv.insertBefore(snake, sv.firstChild);

  let sim = null, ph = 0, big = false;
  window.__S = {
    start(id, seed, t0) { sim = new SimCore.Sim(SC[id], seed, false); while (sim.t < t0 && sim.step()) {} big = id === 'wk45buf'; },
    jams(id, seed, upto) { const s = new SimCore.Sim(SC[id], seed, false); const out = []; let seen = 0;
      while (s.t < upto && s.step()) { for (; seen < s.events.length; seen++) { const e = s.events[seen]; if (e.kind === 'm' && e.i === 2 && e.dur >= 600) out.push(e.t0); } }
      return out; },
    calmSeed(id, from, upto) { for (let s = 1; s < 500; s++) { const x = new SimCore.Sim(SC[id], s, false); while (x.t < upto && x.step()) {} if (!x.events.some(e => e.t0 >= from)) return s; } return 1; },
    step(n) { for (let i = 0; i < n && sim.step(); i++) {} ph += Math.min(1, n / 6) * 0.9; },
    snake(o) { g.snake.setAttribute('opacity', o); },
    draw() {
      for (let i = 0; i < 5; i++) {
        const s = sim.t === 0 ? 0 : sim.state[i], c = COL[s], m = g.m[i];
        m.box.setAttribute('stroke', c); m.glow.setAttribute('stroke', c); m.glow.setAttribute('opacity', s === 0 ? 0.25 : 0.55);
        m.lamp.setAttribute('fill', c); m.sw.textContent = WORD[s]; m.sw.setAttribute('fill', c);
      }
      for (let i = 0; i < 4; i++) {
        const cap = sim.cap[i], b = sim.buf[i], c = g.c[i];
        const bigHere = big && i === 1;
        const flowing = sim.state[i] === 0 && sim.state[i + 1] === 0;
        const n = bigHere ? Math.min(SLOTS, Math.round(b / 22)) : Math.round(Math.min(1, b / cap) * SLOTS);
        c.ds.forEach((dot, k) => {
          let on, x;
          if (flowing && n < SLOTS * 0.6) { // a moving trickle of bottles
            const pos = ((k / SLOTS) + ph * 0.18) % 1; x = c.x + 8 + pos * (GAP - 16); on = k % 3 === 0;
          } else { x = c.x + GAP - SPACE * (k + 1); on = k < n; } // queued up against the next machine
          dot.setAttribute('cx', x); dot.setAttribute('opacity', on ? 1 : 0);
        });
        bufLbl[i].textContent = '';
        if (bigHere) {
          const filled = Math.round(Math.min(1, b / cap) * g.snakeDots.length), tot = g.snakeDots.length;
          // fill from the labeler end backwards
          g.snakeDots.forEach((dot, k) => dot.setAttribute('opacity', (tot - 1 - k) < filled ? 1 : 0));
          snakeLbl.textContent = '';
        }
      }
      const mins = sim.t / 60, h = Math.floor(mins / 60), mm = Math.floor(mins % 60);
      document.getElementById('clk').textContent = 'SHIFT TIME ' + h + ':' + String(mm).padStart(2, '0');
    },
    text(hd, sb) { document.getElementById('hd').innerHTML = hd; document.getElementById('sb').innerHTML = sb || ''; },
    big(n, label, color, o) { const B = document.getElementById('big'); B.style.opacity = o; document.getElementById('bn').textContent = n; document.getElementById('bn').style.color = color; document.getElementById('bl').innerHTML = label; },
    end(o) { document.getElementById('end').style.opacity = o; }
  };
}, W);

let fi = 0;
const cdp = await p.createCDPSession();
const snap = async () => { const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 93 }); fs.writeFileSync(path.join(frames, String(fi++).padStart(5, '0') + '.jpg'), Buffer.from(data, 'base64')); };
const S = (fn, ...a) => p.evaluate((fn, a) => __S[fn](...a), fn, a);
const play = async (sec, simPerFrame, each) => { const n = Math.round(sec * FPS); for (let k = 0; k < n; k++) { const x = k / n; await S('step', Math.round(typeof simPerFrame === 'function' ? simPerFrame(x) : simPerFrame)); await S('draw'); if (each) await each(x); await snap(); } };
const fade = x => Math.min(1, x * 4);

// the moments worth showing, found in the same engine
const seed = 70;
const a = await S('jams', 'wk45', seed, 27000);            // labeler jams with today's conveyor
const bj = await S('jams', 'wk45buf', seed, 27000);        // ... and with 10x conveyor
const calm = await S('calmSeed', 'normal', 0, 1800);
console.log('jams wk45', a.map(t => (t / 60).toFixed(0)), 'wk45buf', bj.map(t => (t / 60).toFixed(0)), 'calm seed', calm);

// beat 0: a normal line
await S('start', 'normal', calm, 600);
await S('text', 'A packaging line.', '110 bottles a minute. Green means running.');
await play(2.4, 3);
// beat 1: the labeler jams
await S('start', 'wk45', seed, a[0] - 25);
await S('text', 'Then the labeler starts jamming.', 'About once a shift, for half an hour.');
await play(1.6, 1);
await S('text', 'Everything in front of it stops.', 'The conveyor fills in about 3 minutes. Then the filler stops too.');
await play(4.2, x => 2 + x * 14);
await play(2.2, 14, async x => S('big', '−2,416', 'bottles a shift lost', '#EF4444', fade(x)));
// beat 2: option A, more conveyor
await S('start', 'wk45buf', seed, bj[0] - 25);
await S('big', '', '', '#fff', 0);
await S('text', 'Fix A: add 10× more conveyor.', 'Room for 2,000 bottles in front of the labeler.');
await play(1.4, 2, async x => S('snake', Math.min(1, x * 2)));
await S('text', 'The jam fills it up anyway.', 'Then it drains slowly: the labeler is barely faster than the filler.');
await play(4.0, x => 6 + x * 30);
await S('text', 'It’s still full when the next jam hits.', 'So the filler stops again.');
await S('start', 'wk45buf', seed, bj[1] - 25);
await play(3.0, x => 3 + x * 12, async x => S('big', '27%', 'of the loss back', '#F59E0B', fade(x)));
// beat 3: option B, fix the jam
await S('snake', 0);
await S('start', 'wk45fix', seed, a[0] - 25);
await S('big', '', '', '#fff', 0);
await S('text', 'Fix B: fix the label stock.', 'Supplier trial and incoming inspection. No new conveyor.');
await play(2.2, 6);
await play(2.4, 10, async x => S('big', '100%', 'of the loss back', '#10B981', fade(x)));
// end card
for (let k = 0; k < 14; k++) { await S('end', (k + 1) / 14); await snap(); }
for (let k = 0; k < FPS * 3.4; k++) await snap();
await b.close();
if (errs.length) console.log('page errors:', errs);
console.log(fi, 'frames,', (fi / FPS).toFixed(1), 's');

const mp4 = path.join(dir, 'line-sim-story.mp4'), gif = path.join(dir, 'line-sim-story.gif');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(frames, '%05d.jpg'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '19', '-preset', 'slow', '-movflags', '+faststart', mp4]);
const gf = path.join(dir, '.sgif'); fs.rmSync(gf, { recursive: true, force: true }); fs.mkdirSync(gf);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4, '-vf', 'fps=15,scale=540:-1:flags=lanczos', path.join(gf, '%04d.png')]);
execFileSync('gifski', ['--quiet', '--fps', '15', '--width', '540', '--quality', '85', '-o', gif, ...fs.readdirSync(gf).sort().map(f => path.join(gf, f))]);
fs.rmSync(gf, { recursive: true, force: true });
for (const f of [mp4, gif]) console.log(path.basename(f), (fs.statSync(f).size / 1e6).toFixed(2), 'MB');
