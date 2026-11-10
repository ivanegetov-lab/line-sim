// Records the 4-step story from the real simulator as a 1080x1350 MP4 (LinkedIn 4:5) plus a GIF.
// Every frame is the actual page; the sim is advanced by hand so the video is smooth and repeatable.
// Usage: node video/record.mjs        (needs ffmpeg and gifski; puppeteer path as in screenshots/shoot.mjs)
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const require = createRequire(process.env.PUPPETEER_FROM || '/Users/igetov/Tools/life-os/linked-in carousel/node_modules/');
const puppeteer = require('puppeteer');
const dir = path.dirname(fileURLToPath(import.meta.url));
const url = pathToFileURL(path.join(dir, '..', 'index.html')).href + '?view=2d';
const frames = path.join(dir, '.frames'); fs.rmSync(frames, { recursive: true, force: true }); fs.mkdirSync(frames);
const FPS = 30, W = 1080, H = 1350;
const b = await puppeteer.launch({ headless: 'new' });
const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(String(e)));
await p.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
await p.goto(url, { waitUntil: 'networkidle0' });
await p.evaluate(() => document.fonts.ready);
await new Promise(r => setTimeout(r, 800));

// recording layout: caption band, the real line card, a live result chart, footer
await p.evaluate(() => { window.__perRow = 5; window.__runLabel = 'simulated shift'; });
await p.addStyleTag({ content: `
  html,body{background:#0B1220 !important;overflow:hidden}
  .top,#story,#use,#editor,#cmpCard,.foot,section.grid4,section.two,section.card.pad.sec:not(#lineCard),#toast{display:none !important}
  main.wrap{max-width:none;padding:0 !important;margin:0}
  #lineCard{position:absolute;left:24px;top:350px;width:880px;zoom:1.174;margin:0;padding:14px 16px 10px;border:0;border-radius:15px}
  #lineCard .bar-top{display:none !important}
  #lineCard .legend{font-size:12px}
  #cap{position:absolute;left:0;right:0;top:0;height:340px;padding:44px 56px 0;color:#fff;font-family:Inter,sans-serif;box-sizing:border-box}
  #cap .brand{display:flex;align-items:center;gap:12px;font:600 18px/1 Inter;letter-spacing:2.2px;color:#9CA3AF}
  #cap .brand i{width:18px;height:18px;border-radius:4px;background:#F06050;display:inline-block}
  #cap .stepn{display:inline-block;margin-top:30px;font:800 17px/1 Inter;letter-spacing:1.5px;color:#0B1220;background:#F06050;padding:8px 12px;border-radius:7px;text-transform:uppercase}
  #cap h1{font:800 66px/1.04 Inter;letter-spacing:-2px;margin:16px 0 0;transition:opacity .2s}
  #cap p{font:500 30px/1.35 Inter;color:#D1D5DB;margin:12px 0 0;max-width:960px}
  #res{position:absolute;left:24px;right:24px;top:886px;height:316px;background:#111A2E;border-radius:18px;padding:22px 28px;box-sizing:border-box;font-family:Inter,sans-serif;color:#fff}
  #res .t{font:700 15px/1 Inter;letter-spacing:1.8px;color:#F06050;text-transform:uppercase;margin-bottom:16px}
  #res .row{display:grid;grid-template-columns:320px 1fr 150px;align-items:center;gap:14px;margin:0 0 20px;opacity:.18;transition:opacity .3s}
  #res .row.on{opacity:1}
  #res .row b{font:700 23px/1.2 Inter}
  #res .tr{height:26px;background:rgba(255,255,255,.08);border-radius:6px;overflow:hidden}
  #res .f{height:100%;border-radius:6px;width:0}
  #res .v{font:800 24px/1 Inter;text-align:right;font-variant-numeric:tabular-nums}
  #res .v small{display:block;font:600 14px/1.3 Inter;color:#9CA3AF}
  #foot{position:absolute;left:56px;right:56px;bottom:56px;display:flex;justify-content:space-between;align-items:center;font:600 20px Inter;color:#9CA3AF}
  #foot b{color:#fff}#foot span.u{color:#F06050;font-weight:800}
  #end{position:absolute;inset:0;background:#0B1220;color:#fff;font-family:Inter,sans-serif;padding:150px 70px 0;box-sizing:border-box;opacity:0;transition:none}
  #end h2{font:800 76px/1.04 Inter;letter-spacing:-2.6px;margin:0}
  #end h2 em{font-style:normal;color:#F06050}
  #end p{font:500 30px/1.4 Inter;color:#D1D5DB;margin:34px 0 0}
  #end .cta{margin-top:60px;display:inline-block;background:#F06050;color:#fff;font:800 34px/1 Inter;padding:26px 34px;border-radius:16px}
  #end .url{margin-top:24px;font:700 28px Inter;color:#fff}
`});
await p.evaluate(() => {
  const el = (h) => { const d = document.createElement('div'); d.innerHTML = h; return d.firstElementChild; };
  document.body.appendChild(el(`<div id="cap"><div class="brand"><i></i>LINE SIMULATOR · FREE TOOL</div><span class="stepn" id="sn">Plant 2 · Line 3</span><h1 id="h1"></h1><p id="pp"></p></div>`));
  const lc = document.getElementById('lineCard');
  const res = el(`<div id="res"><div class="t">Good bottles per shift · 200 simulated shifts</div>
    <div class="row" data-r="0"><b>Normal week</b><div class="tr"><div class="f" style="background:#64748B"></div></div><div class="v">33,090</div></div>
    <div class="row" data-r="1"><b>With the jams</b><div class="tr"><div class="f" style="background:#DC2626"></div></div><div class="v">−2,416</div></div>
    <div class="row" data-r="2"><b>+ 10× conveyor</b><div class="tr"><div class="f" style="background:#D97706"></div></div><div class="v">27%<small>of loss back</small></div></div>
    <div class="row" data-r="3"><b>Fix the labels</b><div class="tr"><div class="f" style="background:#059669"></div></div><div class="v">100%<small>of loss back</small></div></div></div>`);
  document.body.appendChild(res);
  document.body.appendChild(el(`<div id="foot"><span><b>Free</b> · runs in your browser · Plant 2 open dataset</span><span class="u">Simulate your own line →</span></div>`));
  document.body.appendChild(el(`<div id="end"><h2>Test the fix<br><em>before you buy it.</em></h2>
    <p>Free line simulator. Put in your own line and your own downtime log. Runs in your browser.</p>
    <div class="cta">Try it free</div><div class="url">ivanegetov-lab.github.io/line-sim</div></div>`));
  window.__rec = {
    cap(step, h, ptxt){ document.getElementById('sn').textContent = step; document.getElementById('h1').innerHTML = h; document.getElementById('pp').innerHTML = ptxt || ''; },
    bar(r, frac){ const row = document.querySelector(`#res .row[data-r="${r}"]`); row.classList.add('on'); row.querySelector('.f').style.width = (frac * 100) + '%'; },
    end(o){ document.getElementById('end').style.opacity = o; },
    place(){ const lc = document.getElementById('lineCard'), r = lc.getBoundingClientRect(); document.getElementById('res').style.top = (r.bottom + 18) + 'px'; return r.bottom; }
  };
});

let fi = 0; const cardH = new Set();
const cdp = await p.createCDPSession();
const snap = async () => { const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 92 }); fs.writeFileSync(path.join(frames, String(fi++).padStart(5, '0') + '.jpg'), Buffer.from(data, 'base64')); };
const run = async (sec, simPerFrame, onFrame) => { const n = Math.round(sec * FPS); for (let k = 0; k < n; k++) { const sp = typeof simPerFrame === 'function' ? simPerFrame(k / n) : simPerFrame; await p.evaluate((s) => __ls.advance(s, 1 / 30), Math.round(sp)); if (onFrame) await onFrame(k / n); await snap(); cardH.add(await p.evaluate(() => Math.round(document.getElementById('lineCard').getBoundingClientRect().height))); } };
const cap = (s, h, t) => p.evaluate((s, h, t) => __rec.cap(s, h, t), s, h, t);
const bar = (r, f) => p.evaluate((r, f) => __rec.bar(r, f), r, f);
const ease = x => 1 - Math.pow(1 - Math.min(1, x), 3);
const MAX = 33090 * 1.03, frac = v => v / MAX;
const go = async id => { await p.evaluate(id => __ls.story(id), id); await p.evaluate(() => window.scrollTo(0, 0)); };

// scene 1: the hook, on the real line, just before the labeler jams
await go('wk45');
await bar(0, frac(33090));
await cap('Plant 2 · Line 3 · 110 bottles a minute', 'This line loses 2,416 bottles every shift.', 'The labeler keeps jamming. The fix on the table: buy more conveyor. Let’s test it first.');
await run(3.8, 0.5);
// scene 2: the jam
await cap('The problem', 'One jam stops the whole line.', 'The labeler goes red. The conveyor in front of it fills. Then the capper and filler stop.');
await run(5.0, x => 2 + x * 14, async x => bar(1, (33090 - 2416 * ease(x * 1.5)) / MAX));
// scene 3: option 1, buy conveyor
await go('wk45buf');
await cap('Option 1 · buy conveyor', '10× more conveyor before the labeler.', 'Room for 2,000 bottles instead of 200.');
await run(2.0, 3);
await cap('Option 1 · buy conveyor', 'Still full when the next jam hits.', 'It drains too slowly between jams. <b style="color:#fff">Only 27% of the loss comes back.</b>');
await run(4.8, x => 4 + x * 16, async x => bar(2, (30674 + 664 * ease(x * 1.5)) / MAX));
// scene 4: option 2, fix the cause
await go('wk45fix');
await cap('Option 2 · fix the cause', 'Fix the label stock instead.', 'No new equipment. <b style="color:#fff">100% of the loss comes back.</b>');
await run(4.2, x => 6 + x * 14, async x => bar(3, (30674 + 2416 * ease(x * 1.5)) / MAX));
await run(0.8, 20);
// end card
for (let k = 0; k < 12; k++) { await p.evaluate(o => __rec.end(o), (k + 1) / 12); await snap(); }
for (let k = 0; k < FPS * 3.6; k++) await snap();
await b.close();
if (errs.length) console.log('page errors:', errs);
console.log('line card heights seen:', [...cardH].join(', '));
console.log(fi, 'frames,', (fi / FPS).toFixed(1), 's');

const mp4 = path.join(dir, 'line-sim-demo.mp4'), gif = path.join(dir, 'line-sim-demo.gif');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(frames, '%05d.jpg'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-preset', 'slow', '-movflags', '+faststart', mp4]);
const gf = path.join(dir, '.gif'); fs.rmSync(gf, { recursive: true, force: true }); fs.mkdirSync(gf);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4, '-vf', 'fps=12,scale=540:-1:flags=lanczos', path.join(gf, '%04d.png')]);
execFileSync('gifski', ['--quiet', '--fps', '12', '--width', '540', '--quality', '80', '-o', gif, ...fs.readdirSync(gf).sort().map(f => path.join(gf, f))]);
fs.rmSync(gf, { recursive: true, force: true });
for (const f of [mp4, gif]) console.log(path.basename(f), (fs.statSync(f).size / 1e6).toFixed(2), 'MB');
