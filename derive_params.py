#!/usr/bin/env python3
"""Build the three Plant 2 presets (Lines 1, 2, 3) from the Plant 2 open dataset.

Reads   ../plant2-dataset/data/production/{downtime_events,production_log}.csv
Writes  presets/plant2-line{1,2,3}.json, refreshes the copy embedded in index.html,
        and copies index.html to skill/line-sim/assets/simulator.html

The stop statistics come from the same functions the skill uses on anybody's data
(skill/line-sim/scripts/derive_params.py). Standard library only.

Usage:  python3 derive_params.py [path-to-plant2-dataset]
"""
import csv, json, re, shutil, sys, datetime as dt
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.dont_write_bytecode = True  # no __pycache__ inside the skill folder
sys.path.insert(0, str(HERE / "skill" / "line-sim" / "scripts"))
from derive_params import derive, stop_stats, stop_fields, sig  # noqa: E402  (the generic script)

DATA = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE.parent / "plant2-dataset"
V_CURVE = [("Filler", "FIL", 1.0), ("Capper", "CAP", 120 / 110), ("Labeler", "LAB", 118 / 110),
           ("Case packer", "CPK", 125 / 110), ("Palletizer", "PAL", 135 / 110)]
MACHINE_CAUSE = {"Filler": "Filler faults", "Capper": "Capper faults", "Labeler": "Labeler jams",
                 "Case packer": "Case packer faults", "Palletizer": None}
L3_BUFFERS = [60, 200, 200, 120]
LINES = {
    "Line 3": dict(id="plant2-line3", sku=None, rate=110, product="Dish soap 750 ml", per_case=12, weeks=range(33, 45)),
    "Line 1": dict(id="plant2-line1", sku=None, rate=100, product="All-purpose cleaner 1 L", per_case=12, weeks=range(33, 46)),
    "Line 2": dict(id="plant2-line2", sku="FS-0500", rate=140, product="Fabric softener 500 ml", per_case=12, weeks=range(33, 46)),
}


def week(d):
    return dt.date.fromisoformat(d).isocalendar()[1]


def read(rel):
    with open(DATA / "data" / rel, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def period(log_rows):
    n = len(log_rows)
    planned = sum(float(x["planned_min"]) for x in log_rows)
    down = sum(float(x["downtime_min"]) for x in log_rows)
    run = sum(float(x["run_min"]) for x in log_rows)
    total = sum(int(x["total_count"]) for x in log_rows)
    good = sum(int(x["good_count"]) for x in log_rows)
    ideal = sum(float(x["ideal_rate_per_min"]) * float(x["run_min"]) for x in log_rows)
    ideal_planned = sum(float(x["ideal_rate_per_min"]) * float(x["planned_min"]) for x in log_rows)
    return dict(shifts=n, planned_min=planned, downtime_min=down, run_min=run,
                downtime_min_per_shift=round(down / n, 2), total_per_shift=round(total / n, 1),
                good_per_shift=round(good / n, 1), availability=round(run / planned, 4),
                performance=round(total / ideal, 4), reject_rate=round(1 - good / total, 4),
                oee=round(good / ideal_planned, 4))


def build(line, spec, events, log):
    n = line[-1]
    ev = [e for e in events if e["line"] == line]
    lg = [x for x in log if x["line"] == line]
    for e in ev:
        # "Waiting on maintenance" booked to an asset belongs to that machine
        e["_cause"] = e["cause"] + (f" [{e['asset_id']}]" if e["cause"] == "Waiting on maintenance" and e["asset_id"] else "")
    weeks = set(spec["weeks"])
    ev_n = [e for e in ev if week(e["date"]) in weeks]
    lg_n = [x for x in lg if week(x["date"]) in weeks]
    p = period(lg_n)
    p_sku = period([x for x in lg_n if x["sku"] == spec["sku"]]) if spec["sku"] else p
    rate = spec["rate"]

    def machines_spec():
        out = []
        for name, tag, ratio in V_CURVE:
            causes = [MACHINE_CAUSE[name]] if MACHINE_CAUSE[name] else []
            causes.append(f"Waiting on maintenance [{tag}-{n}]")
            out.append((name, causes, round(rate * ratio)))
        return out

    line_stops = [("Changeover", ["Changeovers"], "shift_start"),
                  ("Other line stops", ["Material short", "Other", "Waiting on maintenance"], "random")]
    ms, ls, cv, unmapped = derive(ev_n, "_cause", "minutes", p["run_min"], machines_spec(), line_stops, ["Conveyor"])
    assert not unmapped, unmapped
    for item in ls:
        if item["kind"] == "shift_start":
            item["prob_per_shift"] = sig(item["data"]["n_stops"] / p["shifts"])
    for m in ms + ls + [cv]:
        m["data"]["causes"] = [c for c in m["data"]["causes"] if any(e["_cause"] == c for e in ev)] or ["none logged"]
        m["data"]["stops_per_shift"] = round(m["data"]["n_stops"] / p["shifts"], 4)
    buffers = [int(round(b * rate / 110, -1)) for b in L3_BUFFERS]
    wk = f"ISO weeks {min(weeks)}–{max(weeks)}"
    cfg = {
        "schema": "line-sim/1", "id": spec["id"], "name": f"Plant 2 · {line}", "product": spec["product"],
        "unit": "bottles", "units_per_case": spec["per_case"], "shift_min": 450, "ideal_rate": rate,
        "run_speed_factor": p_sku["performance"], "reject_rate": p_sku["reject_rate"],
        "machines": ms, "buffers": [{"capacity": b} for b in buffers], "line_stops": ls, "conveyor_stops": cv,
        "source": {"dataset": "Plant 2 open dataset by Ivan Getov (fictional plant), CC BY 4.0", "line": line,
                   "period": wk, "shifts": p["shifts"], "run_min": p["run_min"], "downtime_min": p["downtime_min"]},
        "reference": {"label": f"{line}, {wk}" + (f", {spec['sku']} shifts" if spec["sku"] else ""),
                      "shifts": p_sku["shifts"], "good_per_shift": p_sku["good_per_shift"], "oee": p_sku["oee"],
                      "availability": p_sku["availability"], "performance": p_sku["performance"],
                      "downtime_min_per_shift": p["downtime_min_per_shift"], "target_oee": 0.70},
        "assumptions": [
            f"Rated speeds follow a standard V-curve on the {rate}/min line rate: "
            + ", ".join(f"{m['name'].lower()} {m['rated_speed']:g}" for m in ms) + " per minute. Not in the dataset.",
            "Buffer sizes (" + ", ".join(str(b) for b in buffers) + " bottles) are design assumptions. Not in the dataset.",
            f"Run-speed factor {p_sku['performance'] * 100:.1f}%: between logged stops the real line makes that share of {rate}/min. "
            "The log does not say where the loss sits, so every machine is slowed by the same factor.",
            "Conveyor stops are logged against the whole conveyor system, so each one lands on one conveyor at random.",
            "Changeovers happen at the start of a shift. Material short, Other and Waiting on maintenance with no asset stop the whole line at a random time.",
            "The palletizer has no logged stops in 13 weeks.",
        ],
    }
    if spec["sku"]:
        cfg["assumptions"].append(f"Line 2 runs two sizes. This preset is the 500 ml size (140/min, {p_sku['shifts']} shifts); "
                                  "stop rates come from all Line 2 shifts.")
    return cfg, ev, lg


def main():
    events, log = read("production/downtime_events.csv"), read("production/production_log.csv")
    presets = []
    for line, spec in LINES.items():
        cfg, ev, lg = build(line, spec, events, log)
        if line == "Line 3":
            # week 45: new label stock. Only the labeler has stops that week.
            lg45 = [x for x in lg if week(x["date"]) == 45]
            p45 = period(lg45)
            mins = [float(e["minutes"]) for e in ev if week(e["date"]) == 45
                    and e["_cause"] in ("Labeler jams", "Waiting on maintenance [LAB-3]")]
            st = stop_stats(mins, p45["run_min"])
            lab = next(m for m in cfg["machines"] if m["name"] == "Labeler")
            w45 = {f"machines.Labeler.{k}": v for k, v in stop_fields(st).items()}
            w45["reject_rate"] = p45["reject_rate"]
            caps = [b["capacity"] for b in cfg["buffers"]]
            dbl = {f"buffers.{i}.capacity": c * 2 for i, c in enumerate(caps)}
            ratio = st["stops_per_hour"] / lab["stops_per_hour"]
            cfg["scenarios"] = [
                {"id": "normal", "name": "Normal week", "short": "Normal week", "note": "Stops as logged in weeks 33–44", "color": "ink", "set": {}},
                {"id": "wk45", "name": "Week 45 (label stock)", "short": "Week 45",
                 "note": f"Labeler stops {ratio:.0f}× as often, {st['stop_mean_min']:.0f} min each", "color": "red", "set": w45,
                 "reference_good_per_shift": p45["good_per_shift"]},
                {"id": "wk45buf", "name": "Week 45 + 10× buffer before the labeler", "short": "Wk 45 + big buffer",
                 "note": f"Capper → labeler: {caps[1]:,} → {caps[1] * 10:,} bottles", "color": "amb",
                 "set": {**w45, "buffers.1.capacity": caps[1] * 10}},
                {"id": "wk45dbl", "name": "Week 45 + double every buffer", "short": "Wk 45 + 2× buffers",
                 "note": "All four conveyors hold twice as much", "color": "amb", "set": {**w45, **dbl}},
                {"id": "wk45fix", "name": "Week 45 + labeler fixed", "short": "Wk 45 + labeler fixed",
                 "note": "Old label stock back: jams and rejects at normal levels", "color": "grn", "set": {}},
                {"id": "dbl", "name": "Normal week + double every buffer", "short": "2× buffers",
                 "note": "All four conveyors hold twice as much", "color": "", "set": dbl},
            ]
            cfg["week45"] = {"shifts": p45["shifts"], "labeler_stops": st["n_stops"],
                             "labeler_stops_per_shift": round(st["n_stops"] / p45["shifts"], 4),
                             "good_per_shift": p45["good_per_shift"], "oee": p45["oee"], "performance": p45["performance"],
                             "reject_rate": p45["reject_rate"], "downtime_min_per_shift": p45["downtime_min_per_shift"]}
            cfg["assumptions"] += [
                "Week 45 scenarios change only the labeler (stops and reject rate). The other machines logged no stops that week, "
                "so they stay at their normal-week level.",
                f"The real week 45 also ran slower between stops ({p45['performance'] * 100:.1f}% of rated speed). "
                "That drop was already there before the first jam, so the simulator does not blame the labeler for it.",
            ]
        presets.append(cfg)
        (HERE / "presets").mkdir(exist_ok=True)
        (HERE / "presets" / f"{cfg['id']}.json").write_text(json.dumps(cfg, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"\n{cfg['name']} ({cfg['source']['period']}, {cfg['source']['shifts']} shifts)  run-speed {cfg['run_speed_factor']:.3f}  rejects {cfg['reject_rate']:.4f}")
        print(f"  {'source':<18}{'stops':>6}{'/shift':>8}{'min between':>13}{'mean min':>10}{'spread':>8}")
        for m in cfg["machines"] + cfg["line_stops"] + [dict(cfg["conveyor_stops"], name="Conveyors")]:
            sph = m["stops_per_hour"]
            print(f"  {m['name']:<18}{m['data']['n_stops']:>6}{m['data']['stops_per_shift']:>8.3f}{(60 / sph if sph else 0):>13.0f}{m['stop_mean_min']:>10.1f}{m['stop_spread']:>8.3f}")
        r = cfg["reference"]
        print(f"  data: good/shift {r['good_per_shift']:.0f}, OEE {r['oee']:.3f}, downtime/shift {r['downtime_min_per_shift']}")
    w = presets[0]["week45"]
    print(f"\nLine 3 week 45: labeler {w['labeler_stops']} stops ({w['labeler_stops_per_shift']}/shift), good/shift {w['good_per_shift']:.0f}, OEE {w['oee']:.3f}")

    html = HERE / "index.html"
    if html.exists():
        src = html.read_text(encoding="utf-8")
        blob = json.dumps(presets, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
        new, k = re.subn(r'(<script id="presets" type="application/json">).*?(</script>)',
                         lambda m: m.group(1) + blob + m.group(2), src, flags=re.S)
        if k:
            html.write_text(new, encoding="utf-8")
            asset = HERE / "skill" / "line-sim" / "assets"
            asset.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(html, asset / "simulator.html")
            print("\nindex.html: presets embedded; copied to skill/line-sim/assets/simulator.html")


if __name__ == "__main__":
    main()
