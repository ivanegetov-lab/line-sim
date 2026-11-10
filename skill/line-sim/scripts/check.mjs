#!/usr/bin/env node
// Simulate a config without a browser, using the engine inside the simulator page.
//   node check.mjs config.json [--shifts 200] [--seed 45000]
// Prints output, OEE, logged downtime, stops per source and the bottleneck, next to the
// reference figures when the config has them. Same seeds as the page's scenario comparison.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? +args[i + 1] : d; };
const file = args.find(a => !a.startsWith('--') && a.endsWith('.json'));
if (!file) { console.error('usage: node check.mjs config.json [--shifts 200] [--seed 45000]'); process.exit(2); }
const page = fs.readFileSync(path.join(here, '..', 'assets', 'simulator.html'), 'utf8');
const C = new Function('module', page.match(/<script id="engine"[^>]*>([\s\S]*?)<\/script>/)[1] + '; return SimCore;')(undefined);
const cfg = C.normalize(JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')));
const n = opt('--shifts', 200), s = C.summarize(C.runMany(cfg, opt('--seed', 45000), n)), r = cfg.reference;
const f = (v, d = 0) => v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
const vs = (sim, real) => { if (!real) return ''; const x = parseFloat(String(real).replace(/,/g, '')), d = (sim / x - 1) * 100; return `   data ${real}   (simulated is ${Math.abs(d).toFixed(1)}% ${d >= 0 ? 'above' : 'below'})`; };
console.log(`${cfg.name}: ${n} simulated shifts of ${cfg.shift_min} min` + (r ? `, against ${r.shifts} real shifts (${r.label})` : ' (no reference figures in the config)'));
console.log(`  good ${cfg.unit} per shift   ${f(s.good)}   (P10 ${f(s.p10)}, P90 ${f(s.p90)})` + vs(s.good, r && f(r.good_per_shift)));
console.log(`  OEE                     ${(s.OEE * 100).toFixed(1)}%` + (r ? `   data ${(r.oee * 100).toFixed(1)}%` : ''));
console.log(`  logged stop min/shift   ${s.loggedMin.toFixed(1)}` + vs(s.loggedMin, r && r.downtime_min_per_shift));
console.log(`  bottleneck              ${cfg.machines[s.bottleneck].name} in ${(s.bnShare * 100).toFixed(0)}% of shifts (least time starved or blocked)`);
console.log(`  ceiling with no stops   ${f(Math.min(...cfg.machines.map(m => m.rated_speed)) * cfg.run_speed_factor * cfg.shift_min * (1 - cfg.reject_rate))} good ${cfg.unit} per shift`);
console.log('  source                    stops/shift in data   simulated   mean min set   simulated');
const row = (name, o, a, m) => console.log(`  ${name.slice(0, 24).padEnd(24)} ${(o.data && o.data.stops_per_shift != null ? o.data.stops_per_shift.toFixed(3) : '-').padStart(20)} ${a.toFixed(3).padStart(11)} ${(o.stop_mean_min ? o.stop_mean_min.toFixed(1) : '-').padStart(14)} ${(m == null ? '-' : m.toFixed(1)).padStart(11)}`);
cfg.machines.forEach((m, i) => row(m.name, m, s.mStops[i], s.mAvgMin[i]));
if (cfg.conveyor_stops) row('Conveyors', cfg.conveyor_stops, s.convStops, s.convAvgMin);
cfg.line_stops.forEach((l, i) => row('line: ' + l.name, l, s.lsStops[i], s.lsAvgMin[i]));
console.log('  Stops are rare events: per-source figures from 200 shifts scatter by 10-20%. Use --shifts 1000 to compare them closely.');
