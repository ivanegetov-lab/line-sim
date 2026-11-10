// End-to-end check of the Claude skill, run the way a user's Claude would run it:
//   downtime + production exports -> derive_params.py -> config.json -> build.py -> my-line.html
// on Plant 2 Line 1 and Line 2, then compared with the presets (which are built by a separate script).
// Usage: node test_skill.mjs [--keep]     (needs python3 and ../plant2-dataset; writes only to a temp folder)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const dir = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.join(dir, 'skill', 'line-sim', 'scripts');
const data = path.join(dir, '..', 'plant2-dataset', 'data', 'production');
if (!fs.existsSync(data)) { console.log('SKIP: dataset not found at ' + data); process.exit(0); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'line-sim-skill-'));
for (const f of ['downtime_events.csv', 'production_log.csv']) fs.copyFileSync(path.join(data, f), path.join(tmp, f));
const py = (script, args, ok = true) => { try { return execFileSync('python3', ['-B', path.join(scripts, script), ...args], { cwd: tmp, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { if (ok) throw e; return 'EXIT ' + e.status + '\n' + e.stdout + e.stderr; } };
const html = fs.readFileSync(path.join(dir, 'skill', 'line-sim', 'assets', 'simulator.html'), 'utf8');
const block = (h, id) => h.match(new RegExp(`<script id="${id}"[^>]*>([\\s\\S]*?)</script>`))[1];
const C = new Function('module', block(html, 'engine') + '; return SimCore;')(undefined);
const f = (n, d = 0) => n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
let fails = 0, n = 0;
const check = (name, ok, detail) => { n++; if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '\n      ' + detail : ''}`); };
const mean = (cfg, k = 200) => C.summarize(C.runMany(C.normalize(cfg), 45000, k));

const common = ['--downtime', 'downtime_events.csv', '--cause-col', 'cause', '--minutes-col', 'minutes', '--detail-col', 'asset_id', '--date-col', 'date', '--shift-col', 'shift'];
const prodCols = ['--production', 'production_log.csv', '--planned-col', 'planned_min', '--run-col', 'run_min', '--total-col', 'total_count', '--good-col', 'good_count', '--rate-col', 'ideal_rate_per_min'];
const lineArgs = (L, speeds, buffers) => { const k = L.slice(-1), wm = t => `Waiting on maintenance [${t}-${k}]`; return [
  '--machine', `Filler=Filler faults|${wm('FIL')}:${speeds[0]}`, '--machine', `Capper=Capper faults|${wm('CAP')}:${speeds[1]}`, '--machine', `Labeler=Labeler jams|${wm('LAB')}:${speeds[2]}`,
  '--machine', `Case packer=Case packer faults|${wm('CPK')}:${speeds[3]}`, '--machine', `Palletizer=${wm('PAL')}:${speeds[4]}`, '--buffers', buffers.join(','),
  '--line-stop', 'Changeover=Changeovers@start', '--line-stop', 'Other line stops=Material short|Other|Waiting on maintenance', '--conveyor', 'Conveyor', '--unit', 'bottles', '--units-per-case', '12',
  '--assume', `Rated speeds (${speeds.join(', ')} per minute) are a V-curve on the line rate. Not in the data.`, '--assume', `Buffer sizes (${buffers.join(', ')} bottles) are design assumptions. Not in the data.`]; };

function compare(label, cfg, preset) {
  const same = (a, b) => ['stops_per_hour', 'stop_mean_min', 'stop_spread'].every(k => a[k] === b[k]) && a.data.n_stops === b.data.n_stops;
  const rows = [...cfg.machines.map((m, i) => [m.name, m, preset.machines[i]]), ['Conveyors', cfg.conveyor_stops, preset.conveyor_stops], ...cfg.line_stops.map((l, i) => [l.name, l, preset.line_stops[i]])];
  const bad = rows.filter(([, a, b]) => !same(a, b)).map(r => r[0]);
  check(`${label}: stop rates, mean stop and spread identical to the preset for all ${rows.length} sources`, bad.length === 0 && cfg.line_stops[0].prob_per_shift === preset.line_stops[0].prob_per_shift,
    rows.map(([nm, a]) => `${nm} ${a.data.n_stops} stops, every ${a.stops_per_hour ? f(60 / a.stops_per_hour) : '-'} min, ${a.stop_mean_min.toFixed(1)} min`).join('; ') + (bad.length ? '\n      DIFFERENT: ' + bad.join(', ') : ''));
  check(`${label}: shift length, run-speed factor, reject rate, nameplate and reference figures identical to the preset`,
    cfg.shift_min === preset.shift_min && cfg.run_speed_factor === preset.run_speed_factor && cfg.reject_rate === preset.reject_rate && cfg.ideal_rate === preset.ideal_rate && cfg.source.shifts === preset.source.shifts
    && cfg.reference.oee === preset.reference.oee && Math.abs(cfg.reference.good_per_shift - preset.reference.good_per_shift) < 0.11 && cfg.reference.downtime_min_per_shift === preset.reference.downtime_min_per_shift,
    `shift ${cfg.shift_min} min, ${cfg.source.shifts} shifts, run-speed ${cfg.run_speed_factor} (preset ${preset.run_speed_factor}), rejects ${cfg.reject_rate} (${preset.reject_rate}), data ${f(cfg.reference.good_per_shift, 1)} good/shift (${f(preset.reference.good_per_shift, 1)}), OEE ${cfg.reference.oee} (${preset.reference.oee})`);
  const a = mean(cfg), b = mean(preset);
  check(`${label}: 200 simulated shifts give the same result as the preset`, a.good === b.good && a.loggedMin === b.loggedMin,
    `skill config ${f(a.good)} good/shift, OEE ${(a.OEE * 100).toFixed(1)}%, ${a.loggedMin.toFixed(1)} logged stop min/shift, bottleneck ${cfg.machines[a.bottleneck].name}; preset ${f(b.good)}; data ${f(cfg.reference.good_per_shift)} good/shift, OEE ${(cfg.reference.oee * 100).toFixed(1)}%, ${cfg.reference.downtime_min_per_shift} min/shift (sim vs data ${((a.good / cfg.reference.good_per_shift - 1) * 100).toFixed(1)}%)`);
}
function built(label, file, cfg) {
  const h = fs.readFileSync(path.join(tmp, file), 'utf8'), emb = JSON.parse(block(h, 'userconfig'));
  const strip = s => s.replace(/(<script id="userconfig" type="application\/json">)[\s\S]*?(<\/script>)/, '$1null$2');
  check(`${label}: build.py embeds the config unchanged and touches nothing else in the page`, JSON.stringify(emb) === JSON.stringify(cfg) && strip(h) === html, `${file}, ${f(h.length / 1024)} KB, engine and page byte-identical to assets/simulator.html`);
}
const P = id => JSON.parse(fs.readFileSync(path.join(dir, 'presets', id + '.json'), 'utf8'));

console.log('--- Line 1: downtime CSV + production CSV ---');
const causes = py('derive_params.py', [...common, '--filter', 'line=Line 1', '--list-causes']);
console.log(causes.trimEnd().split('\n').map(l => '   ' + l).join('\n'));
check('Line 1: --list-causes lists every cause with stops and minutes', /281 rows, 5230 downtime minutes/.test(causes) && /67 stops\s+1214 min\s+'Filler faults'/.test(causes));
const out1 = py('derive_params.py', [...common, '--filter', 'line=Line 1', ...prodCols, '--prod-filter', 'line=Line 1', ...lineArgs('Line 1', [100, 109, 107, 114, 123], [50, 180, 180, 110]),
  '--name', 'Plant 2 · Line 1', '--product', 'All-purpose cleaner 1 L', '--out', 'line1.json']);
console.log(out1.trimEnd().split('\n').map(l => '   ' + l).join('\n'));
const c1 = JSON.parse(fs.readFileSync(path.join(tmp, 'line1.json'), 'utf8'));
compare('Line 1', c1, P('plant2-line1'));
const b1 = py('build.py', ['line1.json', '--out', 'line1.html']);
built('Line 1', 'line1.html', c1);
check('Line 1: both assumptions are in the config, printed by derive_params.py and printed again by build.py', c1.assumptions.length === 2 && (out1.match(/^ASSUMPTION:/gm) || []).length === 2 && (b1.match(/^ASSUMPTION:/gm) || []).length === 2, c1.assumptions.join(' | '));

console.log('\n--- Line 2: two bottle sizes on one line ---');
const all2 = py('derive_params.py', [...common, '--filter', 'line=Line 2', ...prodCols, '--prod-filter', 'line=Line 2', ...lineArgs('Line 2', [140, 153, 150, 159, 172], [80, 250, 250, 150]), '--name', 'Line 2 all sizes', '--out', 'line2-all.json']);
const cAll = JSON.parse(fs.readFileSync(path.join(tmp, 'line2-all.json'), 'utf8'));
check('Line 2, first pass with every size: the script says the rows mix two ideal rates', /more than one ideal rate \(70, 140\)/.test(all2) && cAll.notes.some(t => /mix products/.test(t)), `${cAll.source.shifts} shifts in total; mixed run-speed factor ${cAll.run_speed_factor}`);
const out2 = py('derive_params.py', [...common, '--filter', 'line=Line 2', ...prodCols, '--prod-filter', 'line=Line 2', '--prod-filter', 'sku=FS-0500', '--shifts', String(cAll.source.shifts),
  ...lineArgs('Line 2', [140, 153, 150, 159, 172], [80, 250, 250, 150]), '--name', 'Plant 2 · Line 2', '--product', 'Fabric softener 500 ml', '--out', 'line2.json']);
console.log(out2.trimEnd().split('\n').map(l => '   ' + l).join('\n'));
const c2 = JSON.parse(fs.readFileSync(path.join(tmp, 'line2.json'), 'utf8'));
compare('Line 2 (500 ml)', c2, P('plant2-line2'));
py('build.py', ['line2.json', '--out', 'line2.html']);
built('Line 2', 'line2.html', c2);

console.log('\n--- Other ways in ---');
{ // Excel export instead of CSV
  const mk = `import csv, sys, openpyxl
for src in ("downtime_events", "production_log"):
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Export"
    for i, r in enumerate(csv.reader(open(src + ".csv", newline="", encoding="utf-8"))):
        ws.append(r if i == 0 else [float(v) if v.replace(".", "", 1).isdigit() else v for v in r])
    wb.save(src + ".xlsx")`;
  let have = true; try { execFileSync('python3', ['-B', '-c', mk], { cwd: tmp, stdio: 'pipe' }); } catch (e) { have = false; }
  if (!have) console.log('SKIP  Excel input: openpyxl is not installed');
  else { py('derive_params.py', [...common.map(a => a === 'downtime_events.csv' ? 'downtime_events.xlsx' : a), '--sheet', 'Export', '--filter', 'line=Line 1', ...prodCols.map(a => a === 'production_log.csv' ? 'production_log.xlsx' : a), '--prod-filter', 'line=Line 1',
      ...lineArgs('Line 1', [100, 109, 107, 114, 123], [50, 180, 180, 110]), '--name', 'Plant 2 · Line 1', '--product', 'All-purpose cleaner 1 L', '--out', 'line1-xlsx.json']);
    const x = JSON.parse(fs.readFileSync(path.join(tmp, 'line1-xlsx.json'), 'utf8')); x.source.file = c1.source.file; x.reference.label = c1.reference.label;
    check('Excel (.xlsx) exports give exactly the same config as the CSV files', JSON.stringify(x) === JSON.stringify(c1)); } }
{ // downtime file only, nothing else known
  const o = py('derive_params.py', ['--downtime', 'downtime_events.csv', '--cause-col', 'cause', '--minutes-col', 'minutes', '--date-col', 'date', '--shift-col', 'shift', '--filter', 'line=Line 1',
    '--machine', 'Filler=Filler faults', '--machine', 'Capper=Capper faults', '--machine', 'Labeler=Labeler jams', '--machine', 'Case packer=Case packer faults', '--conveyor', 'Conveyor', '--line-stop', 'Changeover=Changeovers@start', '--out', 'bare.json']);
  const c = JSON.parse(fs.readFileSync(path.join(tmp, 'bare.json'), 'utf8'));
  check('Downtime file only: every gap is filled with a default that is flagged as an assumption, and unmapped causes are named', c.assumptions.length >= 7 && c.notes.some(t => /Shifts covered was not given/.test(t)) && c.notes.filter(t => /not mapped/.test(t)).length === 3,
    `${(o.match(/^ASSUMPTION:/gm) || []).length} assumptions, ${(o.match(/^NOTE:/gm) || []).length} notes printed:\n      ` + [...c.assumptions, ...c.notes].join('\n      '));
  py('build.py', ['bare.json', '--out', 'bare.html']); }
{ // interview only: Claude writes the config by hand from the user's answers
  const hand = { name: 'Jar line B', product: 'Pasta sauce 500 g', unit: 'jars', shift_min: 480, run_speed_factor: 0.85, machines: [{ name: 'Filler', rated_speed: 200, mtbs_min: 90, stop_mean_min: 4 },
    { name: 'Capper', rated_speed: 220, mtbs_min: 240, stop_mean_min: 6 }, { name: 'Labeler', rated_speed: 230, stops_per_hour: 1, stop_mean_min: 3, stop_spread: 0.8 }], buffers: [{ capacity: 150 }, { capacity: 400 }],
    assumptions: ['Every number is the supervisor\'s estimate from an interview. No downtime log was used.'] };
  fs.writeFileSync(path.join(tmp, 'hand.json'), JSON.stringify(hand));
  const o = py('build.py', ['hand.json', '--out', 'hand.html']), r = mean(hand);
  built('Interview only (hand-written config)', 'hand.html', hand);
  check('Interview only: the hand-written config runs', r.good > 60000 && r.good < 0.85 * 200 * 480, `${f(r.good)} good jars per shift (ceiling 0.85 x 200 x 480 = ${f(0.85 * 200 * 480)}), OEE ${(r.OEE * 100).toFixed(1)}%\n      ` + o.trimEnd().split('\n').join('\n      '));
  const bad = { name: 'Broken', shift_min: 480, machines: [{ name: 'A', rated_speed: 0 }, { name: 'B', rated_speed: 50, stop_spread: 9 }], buffers: [] };
  fs.writeFileSync(path.join(tmp, 'bad.json'), JSON.stringify(bad));
  const e = py('build.py', ['bad.json', '--out', 'bad.html'], false);
  check('build.py refuses a broken config and says what is wrong', /^EXIT 1/.test(e) && (e.match(/^ERROR:/gm) || []).length === 3 && !fs.existsSync(path.join(tmp, 'bad.html')), e.trim().split('\n').slice(1).join('\n      ')); }

if (process.argv.includes('--keep')) console.log('\nfiles kept in ' + tmp); else fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} of ${n} SKILL CHECKS FAILED` : `\nAll ${n} skill checks passed`);
process.exit(fails ? 1 : 0);
