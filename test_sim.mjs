// Correctness checks for the engine and helpers embedded in index.html.
// Usage: node test_sim.mjs            (CSV checks need ../plant2-dataset; they are skipped if it is missing)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(dir, process.argv[2] || 'index.html'), 'utf8');
const block = id => html.match(new RegExp(`<script id="${id}"[^>]*>([\\s\\S]*?)</script>`))[1];
const C = new Function('module', block('engine') + '; return SimCore;')(undefined);
const T = new Function('SimCore', 'module', block('tools') + '; return LineTools;')(C, undefined);
const PRE = JSON.parse(block('presets')).map(C.normalize);
const L3 = PRE.find(p => p.id === 'plant2-line3');
const f = (n, d = 0) => n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
let fails = 0, n = 0;
const check = (name, ok, detail) => { n++; if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '\n      ' + detail : ''}`); };
const clone = o => JSON.parse(JSON.stringify(o));
const clean = base => { const c = clone(base); c.machines.forEach(m => m.stops_per_hour = 0); c.line_stops = []; delete c.conveyor_stops; delete c.scenarios; c.run_speed_factor = 1; c.reject_rate = 0; return C.normalize(c); };
const sum = (cfg, k, seed0 = 45000) => C.summarize(C.runMany(cfg, seed0, k));
const scen = id => T.scenariosFor(L3).find(s => s.id === id).cfg;

// A line that starts empty needs one 1-second step per transfer before the first unit reaches the end:
// (machines - 1) seconds of the slowest machine's output never leave the line. So the exact expectation is
// slowest rate x (shift - (machines - 1) s), and every unit that went in is either out or sitting in a buffer.
const noFail = (c, r, rate) => { const lag = (c.machines.length - 1) / 60, exp = rate * (c.shift_min - lag);
  return { exp, ok: Math.abs(r.out - exp) <= 2 && r.inCount === r.out + r.wip,
    txt: `out ${f(r.out)} vs ${f(rate * c.shift_min)} minus start-up ${f(rate * lag, 1)} (${c.machines.length - 1} s x ${f(rate / 60, 2)}/s) = ${f(exp, 1)}, diff ${(r.out - exp).toFixed(1)}; in ${f(r.inCount)} = out + ${f(r.wip)} in buffers` }; };
console.log('--- Plant 2 Line 3 (default preset) ---');
{ const c = clean(L3); c.buffers.forEach(b => b.capacity = 5000); const r = C.runShift(c, 1);
  const e = noFail(c, r, 110);
  check('1. No failures, big buffers: output = 450 x 110 less start-up', e.ok, e.txt); }
for (const [i, v] of [[2, 90], [3, 80], [1, 100], [4, 60]]) { const c = clean(L3); c.buffers.forEach(b => b.capacity = 5000); c.machines[i].rated_speed = v;
  const r = C.runShift(c, 1);
  const e = noFail(c, r, v);
  check(`2. ${c.machines[i].name} at ${v}/min, no failures: output = 450 x ${v} less start-up`, e.ok && r.bottleneck === i, `${e.txt}; bottleneck by method: ${c.machines[r.bottleneck].name}`); }
{ const c = clean(L3); c.machines[2].rated_speed = 90; const r = C.runShift(c, 1);
  check('2b. Labeler at 90/min with default buffers', Math.abs(r.out - 40500) <= 10, `out ${f(r.out)} vs 40,500; filler blocked ${f(r.blocked[0], 1)} min; in ${f(r.inCount)} = out + buffers ${f(r.out + r.wip)}`); }

function conservation(cfgs, shifts, label) {
  let steps = 0, bad = 0, k = 0;
  for (const c of cfgs) for (let s = 0; s < shifts; s++) { const sim = new C.Sim(c, 9000 + s, false); k++;
    while (sim.step()) { steps++; let wip = 0;
      for (let i = 0; i < sim.N - 1; i++) { wip += sim.buf[i]; if (sim.buf[i] < 0 || sim.buf[i] > sim.cap[i] || !Number.isInteger(sim.buf[i])) bad++; }
      if (sim.inCount !== sim.outCount + wip) bad++; }
    const r = sim.results(); for (let i = 0; i < sim.N; i++) { const tot = r.run[i] + r.starved[i] + r.blocked[i] + r.down[i] + r.line[i]; if (Math.abs(tot - c.shift_min) > 1e-6) bad++; } }
  check(label, bad === 0, `${k} shifts, ${f(steps)} one-second steps checked, ${bad} violations`);
}
const harsh = (() => { const c = clone(L3); delete c.scenarios; c.machines.forEach((m, i) => { m.stops_per_hour = 1.2; m.stop_mean_min = 6 + i; m.stop_spread = 0.8; }); c.conveyor_stops.stops_per_hour = 1; c.line_stops.forEach(l => { l.stops_per_hour = 0.5; l.prob_per_shift = 0.9; });
  [10, 37, 2000, 55].forEach((v, i) => c.buffers[i].capacity = v); [110, 95, 140, 100, 180].forEach((v, i) => c.machines[i].rated_speed = v); return C.normalize(c); })();
conservation([scen('normal'), scen('wk45'), harsh], 40, '3. Buffers within 0..capacity, units in = out + in buffers, state times add to the shift');
{ const a = C.runShift(scen('normal'), 77), b = C.runShift(scen('normal'), 77), c = C.runShift(scen('normal'), 78);
  check('4. Same seed gives the same shift', a.out === b.out && a.nStops === b.nStops && a.out !== c.out, `seed 77: ${a.out} / ${b.out}; seed 78: ${c.out}`); }
const N = 3000, ref = L3.reference;
const sn = sum(scen('normal'), N);
{ console.log(`\n   Normal week, ${N} simulated shifts vs ${L3.source.shifts} shifts of data`);
  console.log('   source              stops/shift data     sim   avg min data     sim');
  let ok = true;
  const row = (name, o, a, m) => { const d = o.data;
    console.log(`   ${name.padEnd(19)} ${d.stops_per_shift.toFixed(3).padStart(10)} ${a.toFixed(3).padStart(9)} ${o.stop_mean_min.toFixed(1).padStart(12)} ${(m ?? 0).toFixed(1).padStart(8)}`);
    if (d.n_stops && (Math.abs(a / d.stops_per_shift - 1) > 0.1 || Math.abs(m / o.stop_mean_min - 1) > 0.1)) ok = false; if (!d.n_stops && a !== 0) ok = false; };
  L3.machines.forEach((m, i) => row(m.name, m, sn.mStops[i], sn.mAvgMin[i]));
  row('Conveyors', L3.conveyor_stops, sn.convStops, sn.convAvgMin);
  L3.line_stops.forEach((l, i) => row(l.name, l, sn.lsStops[i], sn.lsAvgMin[i]));
  check('5. Simulated normal-week stops per shift and mean duration within 10% of data, every source', ok, `logged downtime/shift: sim ${sn.loggedMin.toFixed(1)} vs data ${ref.downtime_min_per_shift}`);
  check('5b. Normal-week output and OEE close to data', Math.abs(sn.good / ref.good_per_shift - 1) < 0.02, `good/shift sim ${f(sn.good)} vs data ${f(ref.good_per_shift)} (${((sn.good / ref.good_per_shift - 1) * 100).toFixed(2)}%); OEE sim ${(sn.OEE * 100).toFixed(1)}% vs data ${(ref.oee * 100).toFixed(1)}%; A ${(sn.A * 100).toFixed(1)} vs ${(ref.availability * 100).toFixed(1)}; P ${(sn.P * 100).toFixed(1)} vs ${(ref.performance * 100).toFixed(1)}`); }
const s45 = sum(scen('wk45'), N), w = L3.week45;
{ check('6. Week 45 scenario clearly below normal, same direction as data', s45.good < sn.good * 0.95, `sim ${f(s45.good)} vs normal ${f(sn.good)} (${((s45.good / sn.good - 1) * 100).toFixed(1)}%); data ${f(w.good_per_shift)} vs ${f(ref.good_per_shift)} (${((w.good_per_shift / ref.good_per_shift - 1) * 100).toFixed(1)}%); labeler stops/shift sim ${s45.mStops[2].toFixed(2)} vs data ${w.labeler_stops_per_shift}, avg ${s45.mAvgMin[2].toFixed(1)} vs ${scen('wk45').machines[2].stop_mean_min.toFixed(1)} min`);
  const c = clone(scen('wk45')); [0, 1, 3].forEach(i => c.machines[i].stops_per_hour = 0); delete c.conveyor_stops; c.line_stops = c.line_stops.filter(l => l.kind === 'shift_start'); c.run_speed_factor = w.performance;
  const sl = sum(C.normalize(c), N);
  check('6b. Week 45 "as logged" (only labeler + changeovers, run speed 66.3%) reproduces the week', Math.abs(sl.good / w.good_per_shift - 1) < 0.03, `good/shift sim ${f(sl.good)} vs data ${f(w.good_per_shift)}; downtime/shift sim ${sl.loggedMin.toFixed(1)} vs data ${w.downtime_min_per_shift}; OEE sim ${(sl.OEE * 100).toFixed(1)}% vs data ${(w.oee * 100).toFixed(1)}%`); }

console.log('\n--- Any serial line ---');
const line3 = C.normalize({ name: 'Three machines', unit: 'parts', shift_min: 480, machines: [{ name: 'Press', rated_speed: 42 }, { name: 'Weld', rated_speed: 30 }, { name: 'Pack', rated_speed: 55 }], buffers: [{ capacity: 400 }, { capacity: 400 }] });
{ const r = C.runShift(line3, 3), e = noFail(line3, r, 30);
  check('7. 3-machine line, 480 min, no failures: output = slowest (30/min) x 480 less start-up', e.ok && r.bottleneck === 1, `${e.txt}; bottleneck: ${line3.machines[r.bottleneck].name}; OEE ${(r.OEE * 100).toFixed(1)}% against the default nameplate of ${line3.ideal_rate}/min`); }
const speeds8 = [600, 640, 520, 700, 650, 610, 720, 800];
const line8 = C.normalize({ name: 'Eight machines', unit: 'cans', shift_min: 720, machines: speeds8.map((s, i) => ({ name: 'M' + (i + 1), rated_speed: s })), buffers: speeds8.slice(1).map(() => ({ capacity: 3000 })) });
{ const r = C.runShift(line8, 3), e = noFail(line8, r, 520);
  check('8. 8-machine line, 720 min, no failures: output = slowest (520/min) x 720 less start-up', e.ok && r.bottleneck === 2, `${e.txt}; bottleneck: ${line8.machines[r.bottleneck].name}`);
  const c = C.normalize(Object.assign(clone(line8), { run_speed_factor: 0.8 })), r2 = C.runShift(c, 3), e2 = noFail(c, r2, 416);
  check('8b. Same line at run-speed factor 80%: output = 0.8 x 520 x 720 less start-up', e2.ok, e2.txt);
  // the shortfall is start-up only: it does not grow with the length of the shift
  const d = [60, 240, 720, 1440].map(m => { const k = C.normalize(Object.assign(clone(line8), { shift_min: m })); return C.runShift(k, 3).out - 520 * m; });
  check('8d. The start-up shortfall is the same for a 1 h, 4 h, 12 h and 24 h shift (it is not a rate error)', d.every(x => Math.abs(x - d[0]) <= 1), `out minus 520 x minutes: ${d.join(', ')}`); }
{ const slow = C.normalize({ shift_min: 600, unit: 'pallets', machines: [{ name: 'A', rated_speed: 0.5 }, { name: 'B', rated_speed: 0.4 }], buffers: [{ capacity: 3 }] }); const r = C.runShift(slow, 1);
  check('8c. Slow 2-machine line (0.4 per min, buffer of 3): output = 0.4 x 600', Math.abs(r.out - 240) <= 1, `out ${r.out} vs 240`); }
{ const fail = (base, k) => { const c = clone(base); c.machines.forEach((m, i) => { m.stops_per_hour = 0.8 + 0.1 * i; m.stop_mean_min = 4 + i; m.stop_spread = 0.7; }); c.buffers.forEach((b, i) => b.capacity = k[i % k.length]);
    c.conveyor_stops = { stops_per_hour: 0.6, stop_mean_min: 5, stop_spread: 0.6 }; c.line_stops = [{ name: 'Changeover', kind: 'shift_start', prob_per_shift: 0.7, stop_mean_min: 20, stop_spread: 0.3 }, { name: 'Meeting', kind: 'shift_start', prob_per_shift: 0.5, stop_mean_min: 10, stop_spread: 0.1 }, { name: 'Material', kind: 'random', stops_per_hour: 0.3, stop_mean_min: 12, stop_spread: 0.9 }]; return C.normalize(c); };
  conservation([fail(line3, [5, 900]), fail(line8, [40, 3000, 15, 700]), C.normalize({ machines: Array.from({ length: 10 }, (_, i) => ({ name: 'S' + i, rated_speed: 60 + 7 * ((i * 5) % 4), stops_per_hour: 1, stop_mean_min: 3 })), buffers: Array.from({ length: 9 }, (_, i) => ({ capacity: 20 + 30 * i })) })], 12,
    '9. Conservation and buffer bounds on 3-, 8- and 10-machine lines with heavy failures, conveyor and line stops'); }

console.log('\n--- Config, share link, scenarios ---');
{ const once = C.normalize(L3), twice = C.normalize(once);
  check('10. normalize() is idempotent and leaves the presets unchanged', JSON.stringify(once) === JSON.stringify(twice) && PRE.every((p, i) => JSON.stringify(p) === JSON.stringify(JSON.parse(block('presets'))[i])), `${PRE.length} presets compared byte for byte`);
  const files = PRE.map(p => JSON.parse(fs.readFileSync(path.join(dir, 'presets', p.id + '.json'), 'utf8')));
  check('10b. presets/*.json match the presets embedded in index.html', files.every((x, i) => JSON.stringify(x) === JSON.stringify(PRE[i])), PRE.map(p => p.id).join(', '));
  const custom = C.normalize({ name: 'Ünïcode line → test', unit: 'jars', shift_min: 480, machines: [{ name: 'Filler', rated_speed: 200, mtbs_min: 90, stop_mean_min: 4 }, { name: 'Seamer', rated_speed: 230, stops_per_hour: 0.5, stop_mean_min: 6, stop_spread: 0.9 }], buffers: [150] });
  const exported = JSON.stringify(custom, null, 1), back = JSON.stringify(C.normalize(JSON.parse(exported)), null, 1);
  check('11. Export -> import -> export gives an identical file', exported === back && JSON.stringify(C.normalize(JSON.parse(JSON.stringify(L3, null, 1)))) === JSON.stringify(L3), `custom line ${exported.length} bytes, Line 3 preset ${JSON.stringify(L3).length} bytes`);
  check('11b. mtbs_min is accepted as an alias (90 min between stops = 0.667 stops per hour); a bare number is accepted as a buffer', Math.abs(custom.machines[0].stops_per_hour - 60 / 90) < 1e-12 && custom.buffers[0].capacity === 150);
  const enc = T.encodeShare(custom), dec = T.decodeShare(enc), a = C.runShift(custom, 5), b = C.runShift(dec, 5);
  check('12. Share link: encode -> decode gives the same config and the same results', JSON.stringify(dec) === JSON.stringify(custom) && a.out === b.out && a.loggedMin === b.loggedMin && /^[A-Za-z0-9_-]+$/.test(enc), `hash ${enc.length} chars; seed 5 output ${a.out} = ${b.out}; Line 3 preset link ${T.encodeShare(L3).length} chars`);
  const g = T.scenariosFor(custom);
  check('13. A line with no scenarios of its own gets the generic what-ifs', g.length === 6 && g[1].cfg.buffers[0].capacity === 300 && g[3].cfg.machines[1].stops_per_hour === 0 && Math.abs(g[4].cfg.machines[0].rated_speed - 220) < 1e-9 && g[5].cfg.machines.every(m => m.stops_per_hour === 0), g.map(s => s.name).join(' | ')); }

console.log('\n--- CSV import maths vs derive_params.py ---');
const csvPath = path.join(dir, '..', 'plant2-dataset', 'data', 'production', 'downtime_events.csv');
if (fs.existsSync(csvPath)) {
  const data = T.parseCSV(fs.readFileSync(csvPath, 'utf8'));
  const d = T.deriveStops(data.rows, { causeCol: 'cause', minutesCol: 'minutes', dateCol: 'date', shiftCol: 'shift', filterCol: 'line', filterVal: 'Line 3', from: '2026-08-10', to: '2026-11-01', shifts: 177, shiftMin: 450 });
  const pairs = [['Filler', ['Filler faults'], L3.machines[0]], ['Capper', ['Capper faults'], L3.machines[1]], ['Labeler', ['Labeler jams'], L3.machines[2]], ['Case packer', ['Case packer faults'], L3.machines[3]],
    ['Conveyors', ['Conveyor'], L3.conveyor_stops], ['Changeover', ['Changeovers'], L3.line_stops[0]], ['Other line stops', ['Material short', 'Other', 'Waiting on maintenance'], L3.line_stops[1]]];
  let ok = Math.abs(d.runMin - L3.source.run_min) < 1e-9, lines = [];
  for (const [name, causes, p] of pairs) { const s = d.stats(causes);
    const same = s.n_stops === p.data.n_stops && Math.abs(s.stops_per_hour - p.stops_per_hour) < 1e-12 && Math.abs(s.stop_mean_min - p.stop_mean_min) < 1e-12 && Math.abs(s.stop_spread - p.stop_spread) < 1e-12;
    if (!same) ok = false; lines.push(`${name}: ${s.n_stops} stops, ${s.stops_per_hour}/h, mean ${s.stop_mean_min}, spread ${s.stop_spread}${same ? '' : '  <-- differs from ' + JSON.stringify([p.stops_per_hour, p.stop_mean_min, p.stop_spread])}`); }
  check('14. In-browser CSV maths = derive_params.py for Plant 2 Line 3, weeks 33-44 (all 7 sources, exact)', ok, `run minutes ${d.runMin} vs ${L3.source.run_min}; ${data.rows.length} rows parsed\n      ` + lines.join('\n      '));
  const g = ['Filler faults', 'Capper faults', 'Labeler jams', 'Case packer faults', 'Conveyor', 'Changeovers', 'Material short'].map(c => T.guessTarget(c, L3.machines.map(m => m.name)));
  check('14b. Causes are auto-matched to machines', g.join(',') === 'm0,m1,m2,m3,conv,start,line', g.join(','));
  const q = T.parseCSV('a;b;c\r\n"x;1";2,5;"say ""hi"""\r\n\r\nlast;3;z');
  check('14c. CSV parser: semicolons, quotes, escaped quotes, CRLF, blank lines', q.rows.length === 2 && q.rows[0].a === 'x;1' && q.rows[0].c === 'say "hi"' && q.rows[1].b === '3', JSON.stringify(q.rows));
} else console.log('SKIP  14. dataset not found at ' + csvPath);

console.log('\n--- Page story ---');
{ const g = id => sum(scen(id), 200).good, n = g('normal'), w = g('wk45'), b = g('wk45buf'), x = g('wk45fix'), loss = n - w;
  const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8'), fmtn = v => Math.round(v).toLocaleString('en-US');
  const want = [fmtn(n), '−' + fmtn(loss), Math.round((b - w) / loss * 100) + '%', '+' + fmtn(b - w), Math.round((x - w) / loss * 100) + '%', '+' + fmtn(x - w)];
  const miss = want.filter(t => !html.includes('>' + t + '<') && !html.includes('(' + t + ')'));
  check('16. The 4-step story on the page quotes the 200-shift results', miss.length === 0, `normal ${fmtn(n)}, loss ${fmtn(loss)}, buffer ${want[2]} (${want[3]}), fix ${want[4]}${miss.length ? '; missing on page: ' + miss.join(', ') : ''}`); }

console.log('\n--- Scenario tables ---');
for (const k of [200, N]) { console.log(`\n   Plant 2 Line 3, ${k} shifts each (seeds 45000+)`);
  console.log('   scenario                                   good/shift      P10      P90    OEE   vs normal  first m/c lost min  bottleneck');
  let b0; for (const s of T.scenariosFor(L3)) { const r = sum(s.cfg, k); b0 ??= r.good;
    console.log(`   ${s.name.padEnd(42)} ${f(r.good).padStart(10)} ${f(r.p10).padStart(8)} ${f(r.p90).padStart(8)}  ${(r.OEE * 100).toFixed(1)}%  ${((r.good - b0 >= 0 ? '+' : '') + f(r.good - b0)).padStart(8)}  ${r.firstLost.toFixed(1).padStart(12)}        ${s.cfg.machines[r.bottleneck].name} (${(r.bnShare * 100).toFixed(0)}%)`); } }
for (const p of PRE.filter(p => p !== L3)) { console.log(`\n   ${p.name} (${p.product}), 200 shifts each. Data: ${f(p.reference.good_per_shift)} good/shift, OEE ${(p.reference.oee * 100).toFixed(1)}%`);
  let b0; for (const s of T.scenariosFor(p)) { const r = sum(s.cfg, 200); b0 ??= r.good;
    console.log(`   ${s.name.padEnd(42)} ${f(r.good).padStart(10)} ${f(r.p10).padStart(8)} ${f(r.p90).padStart(8)}  ${(r.OEE * 100).toFixed(1)}%  ${((r.good - b0 >= 0 ? '+' : '') + f(r.good - b0)).padStart(8)}`); } }
const t0 = performance.now(); C.runMany(scen('normal'), 1, 200); console.log(`\n   200 shifts of Line 3 in ${(performance.now() - t0).toFixed(0)} ms`);
console.log(fails ? `\n${fails} of ${n} CHECKS FAILED` : `\nAll ${n} checks passed`);
process.exit(fails ? 1 : 0);
