#!/usr/bin/env python3
"""Turn a downtime export into a line-sim config.json.

Standard library only (Excel input needs openpyxl; otherwise save the sheet as CSV first).

Method (same as the in-browser CSV import):
  run minutes      = shifts covered x shift minutes - all downtime minutes in the file (after filters)
  stops_per_hour   = number of stops of a source / run minutes x 60
  stop_mean_min    = average logged minutes of that source
  stop_spread      = standard deviation of ln(minutes)  (lognormal sigma, maximum likelihood)

Example:
  python3 derive_params.py --downtime downtime.csv --cause-col cause --minutes-col minutes \
      --date-col date --shift-col shift --filter line="Line 1" --shifts 194 --shift-min 450 \
      --machine "Filler=Filler faults:100" --machine "Capper=Capper faults:109" \
      --machine "Labeler=Labeler jams:107" --machine "Case packer=Case packer faults:114" \
      --machine "Palletizer=:123" --buffers 50,180,180,110 \
      --line-stop "Changeover=Changeovers@start" --line-stop "Other line stops=Material short|Other" \
      --conveyor "Conveyor" --name "Line 1" --unit bottles --ideal-rate 100 \
      --run-speed-factor 0.706 --reject-rate 0.008 --out config.json

--machine  "Name=cause value|another cause:rated speed"   (in line order; empty cause list = no logged stops)
--line-stop "Name=cause|cause"  add "@start" for stops that happen at the start of a shift (changeovers)
Run with --list-causes to see every value in the cause column with counts and minutes.

--detail-col COL splits a cause by a second column (for example the asset a "Waiting on maintenance"
stop was booked to). Rows are then also addressable as "cause [detail]", and a mapping to
"cause [detail]" wins over a mapping to the plain "cause".

With a production log (one row per shift) the script also works out the number of shifts, the shift
length, the run-speed factor, the reject rate and the reference numbers the page compares against:
  --production production.csv --prod-filter line="Line 1" --planned-col planned_min --run-col run_min \
      --total-col total_count --good-col good_count --rate-col ideal_rate_per_min
  run_speed_factor = units made / sum(ideal rate x running minutes)       reject_rate = 1 - good / made
Anything given explicitly (--shifts, --shift-min, --run-speed-factor, --reject-rate) wins over the log.
"""
import argparse, csv, json, math, sys
from collections import Counter
from pathlib import Path


def read_table(path, sheet=None):
    """Rows of a CSV or XLSX file as a list of dicts (all values as strings)."""
    p = Path(path)
    if p.suffix.lower() in (".xlsx", ".xlsm"):
        try:
            import openpyxl
        except ImportError:
            sys.exit("Excel input needs openpyxl (pip install openpyxl), or save the sheet as CSV.")
        wb = openpyxl.load_workbook(p, read_only=True, data_only=True)
        if sheet and sheet not in wb.sheetnames:
            sys.exit(f"Sheet '{sheet}' not found. Sheets: {', '.join(wb.sheetnames)}")
        ws = wb[sheet] if sheet else wb.worksheets[0]
        rows = [r for r in ws.iter_rows(values_only=True) if any(v is not None for v in r)]
        if not rows:
            return []
        head = [str(h).strip() if h is not None else "" for h in rows[0]]

        def cell(v):
            if v is None:
                return ""
            if hasattr(v, "isoformat"):  # dates and datetimes: ISO text, date-only when there is no time part
                t = v.isoformat()
                return t[:10] if t.endswith("T00:00:00") else t.replace("T", " ")
            if isinstance(v, float) and v.is_integer():
                return str(int(v))
            return str(v).strip()
        return [{h: cell(v) for h, v in zip(head, r)} for r in rows[1:]]
    with open(p, newline="", encoding="utf-8-sig") as f:
        sample = f.read(4096)
        f.seek(0)
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
        except csv.Error:
            dialect = csv.excel
        return [{(k or "").strip(): (v or "").strip() for k, v in r.items()} for r in csv.DictReader(f, dialect=dialect)]


def to_minutes(v):
    try:
        return float(str(v).replace(",", "."))
    except ValueError:
        return None


def sig(x, n=6):
    return 0.0 if x == 0 else round(x, n - 1 - int(math.floor(math.log10(abs(x)))))


def stop_stats(mins, run_min):
    """Stop frequency and duration fit for one stop source."""
    mins = [m for m in mins if m and m > 0]
    n = len(mins)
    if n == 0 or run_min <= 0:
        return {"n_stops": 0, "total_min": 0, "stops_per_hour": 0, "stop_mean_min": 0, "stop_spread": 0}
    mean = sum(mins) / n
    logs = [math.log(m) for m in mins]
    mu = sum(logs) / n
    sigma = math.sqrt(sum((x - mu) ** 2 for x in logs) / n)
    return {"n_stops": n, "total_min": round(sum(mins), 2),
            "stops_per_hour": sig(n / run_min * 60), "stop_mean_min": sig(mean), "stop_spread": sig(sigma, 4)}


def stop_fields(st):
    return {k: st[k] for k in ("stops_per_hour", "stop_mean_min", "stop_spread")}


def count_shifts(rows, date_col, shift_col):
    if not date_col:
        return None
    return len({(r.get(date_col, ""), r.get(shift_col, "") if shift_col else "") for r in rows})


def filter_rows(rows, filters=(), date_col=None, date_from=None, date_to=None):
    out = []
    for r in rows:
        if any(r.get(c, "") != v for c, v in filters):
            continue
        if date_col and (date_from or date_to):
            d = r.get(date_col, "")[:10]
            if (date_from and d < date_from) or (date_to and d > date_to):
                continue
        out.append(r)
    return out


def cause_key(row, cause_col, detail_col, wanted):
    """The key a row is filed under: "cause [detail]" if somebody mapped that, otherwise the plain cause."""
    c = row.get(cause_col, "")
    if detail_col and row.get(detail_col, ""):
        k = f"{c} [{row[detail_col]}]"
        if wanted is None or k in wanted:
            return k
    return c


def derive(rows, cause_col, minutes_col, run_min, machines, line_stops=(), conveyor=(), detail_col=None):
    """machines: [(name, [cause values], rated_speed)], line_stops: [(name, [causes], kind)].
    Returns (machines, line_stops, conveyor_stops or None, unmapped {cause: [n, minutes]})."""
    wanted = set(conveyor)
    for _, causes, _x in list(machines) + list(line_stops):
        wanted.update(causes)
    by = {}
    for r in rows:
        m = to_minutes(r.get(minutes_col))
        if m is None or m <= 0:
            continue
        by.setdefault(cause_key(r, cause_col, detail_col, wanted), []).append(m)
    used = set()

    def take(causes):
        mins = []
        for c in causes:
            mins += by.get(c, [])
            used.add(c)
        return mins

    ms = []
    for name, causes, speed in machines:
        st = stop_stats(take(causes), run_min)
        ms.append({"name": name, "rated_speed": speed, **stop_fields(st),
                   "data": {"n_stops": st["n_stops"], "total_min": st["total_min"], "causes": list(causes)}})
    ls = []
    for name, causes, kind in line_stops:
        mins = take(causes)
        st = stop_stats(mins, run_min)
        item = {"name": name, "kind": kind, **stop_fields(st),
                "data": {"n_stops": st["n_stops"], "total_min": st["total_min"], "causes": list(causes)}}
        ls.append(item)
    cv = None
    if conveyor:
        st = stop_stats(take(conveyor), run_min)
        cv = {**stop_fields(st), "data": {"n_stops": st["n_stops"], "total_min": st["total_min"], "causes": list(conveyor)}}
    unmapped = {c: [len(v), round(sum(v), 2)] for c, v in by.items() if c not in used}
    return ms, ls, cv, unmapped


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--downtime", required=True, help="downtime export (CSV, or XLSX with openpyxl)")
    ap.add_argument("--cause-col", required=True, help="column holding the machine or cause of each stop")
    ap.add_argument("--minutes-col", required=True, help="column holding the stop length in minutes")
    ap.add_argument("--detail-col", help='second column that splits a cause, addressed as "cause [detail]" (for example an asset id)')
    ap.add_argument("--sheet", help="sheet name for Excel input (default: first sheet)")
    ap.add_argument("--date-col"), ap.add_argument("--shift-col")
    ap.add_argument("--filter", action="append", default=[], metavar="COL=VALUE", help="keep only rows where COL equals VALUE (repeatable)")
    ap.add_argument("--date-from"), ap.add_argument("--date-to")
    ap.add_argument("--shifts", type=float, help="number of production shifts the file covers (include shifts with no stops)")
    ap.add_argument("--shift-min", type=float, help="planned production minutes per shift (default: from the production log, else 480)")
    ap.add_argument("--run-min", type=float, help="total running minutes, if you know it (overrides --shifts)")
    ap.add_argument("--machine", action="append", default=[], metavar='"Name=cause|cause:speed"')
    ap.add_argument("--line-stop", action="append", default=[], metavar='"Name=cause|cause[@start]"')
    ap.add_argument("--conveyor", default="", help="cause values that are conveyor stops, separated by |")
    ap.add_argument("--buffers", default="", help="capacity of each conveyor between machines, comma separated")
    ap.add_argument("--name", default="My line"), ap.add_argument("--product", default="")
    ap.add_argument("--unit", default="units")
    ap.add_argument("--ideal-rate", type=float, help="nameplate line rate per minute (default: slowest machine)")
    ap.add_argument("--run-speed-factor", type=float, help="share of rated speed the line really runs at between logged stops (0-1)")
    ap.add_argument("--reject-rate", type=float, help="share of units rejected (0-1)")
    ap.add_argument("--units-per-case", type=float, help="optional: the page then also shows cases packed")
    g = ap.add_argument_group("production log (optional, one row per shift)")
    g.add_argument("--production", help="production export (CSV or XLSX)")
    g.add_argument("--prod-sheet")
    g.add_argument("--prod-filter", action="append", default=[], metavar="COL=VALUE")
    g.add_argument("--prod-date-col", help="date column in the production log (default: same name as --date-col)")
    g.add_argument("--planned-col", help="planned production minutes of the shift")
    g.add_argument("--run-col", help="running minutes of the shift (planned minus downtime)")
    g.add_argument("--total-col", help="units made in the shift")
    g.add_argument("--good-col", help="good units in the shift")
    g.add_argument("--rate-col", help="ideal (nameplate) rate per minute for the shift")
    ap.add_argument("--assume", action="append", default=[], metavar="TEXT",
                    help="an assumption to record in the config and show on the page (repeatable), e.g. \"Rated speeds are the supervisor's estimate\"")
    ap.add_argument("--list-causes", action="store_true")
    ap.add_argument("--out", default="config.json")
    a = ap.parse_args()

    rows = read_table(a.downtime, a.sheet)
    if not rows:
        sys.exit("No rows found in " + a.downtime)
    for col in [a.cause_col, a.minutes_col] + [c for c in (a.detail_col, a.date_col, a.shift_col) if c]:
        if col not in rows[0]:
            sys.exit(f"Column '{col}' not found. Columns: {', '.join(rows[0].keys())}")
    filters = [tuple(f.split("=", 1)) for f in a.filter]
    for c, _v in filters:
        if c not in rows[0]:
            sys.exit(f"Filter column '{c}' not found. Columns: {', '.join(rows[0].keys())}")
    rows = filter_rows(rows, filters, a.date_col, a.date_from, a.date_to)
    if not rows:
        sys.exit("No rows left after the filters: check the --filter values and the date range.")
    total_down = sum(m for m in (to_minutes(r.get(a.minutes_col)) for r in rows) if m and m > 0)
    seen = count_shifts(rows, a.date_col, a.shift_col)

    if a.list_causes:
        by = {}
        for r in rows:
            m = to_minutes(r.get(a.minutes_col)) or 0
            d = by.setdefault(r.get(a.cause_col, ""), [0, 0.0, {}])
            d[0] += 1
            d[1] += m
            if a.detail_col and r.get(a.detail_col, ""):
                e = d[2].setdefault(r[a.detail_col], [0, 0.0])
                e[0] += 1
                e[1] += m
        print(f"{len(rows)} rows, {total_down:.0f} downtime minutes, {seen if seen is not None else '?'} shifts with at least one stop")
        for c, (n, m, det) in sorted(by.items(), key=lambda x: -x[1][1]):
            print(f"  {n:>5} stops {m:>9.0f} min  {c!r}")
            if len(det) > 1 or (det and sum(e[0] for e in det.values()) < n):
                for k, (n2, m2) in sorted(det.items(), key=lambda x: -x[1][1]):
                    print(f"      of which {n2:>3} stops {m2:>6.0f} min  '{c} [{k}]'")
        return

    # ---- optional production log: shifts, shift length, run-speed factor, reject rate, reference numbers
    prod, assumed_prod = None, []
    if a.production:
        prows = read_table(a.production, a.prod_sheet)
        if not prows:
            sys.exit("No rows found in " + a.production)
        pf = [tuple(f.split("=", 1)) for f in a.prod_filter]
        pdate = a.prod_date_col or (a.date_col if a.date_col in prows[0] else None)
        for col in [c for c, _v in pf] + [c for c in (pdate, a.planned_col, a.run_col, a.total_col, a.good_col, a.rate_col) if c]:
            if col not in prows[0]:
                sys.exit(f"Column '{col}' not found in the production log. Columns: {', '.join(prows[0].keys())}")
        prows = filter_rows(prows, pf, pdate, a.date_from, a.date_to)
        if not prows:
            sys.exit("No production rows left after --prod-filter and the date range.")
        num = lambda r, c: to_minutes(r.get(c)) or 0.0
        prod = {"shifts": len(prows)}
        if a.planned_col:
            prod["planned"] = sum(num(r, a.planned_col) for r in prows)
            prod["shift_min"] = round(prod["planned"] / len(prows), 2)
        if a.run_col:
            prod["run"] = sum(num(r, a.run_col) for r in prows)
        if a.total_col:
            prod["total"] = sum(num(r, a.total_col) for r in prows)
        if a.good_col:
            prod["good"] = sum(num(r, a.good_col) for r in prows)
        if a.rate_col:
            prod["rate"] = Counter(num(r, a.rate_col) for r in prows).most_common(1)[0][0]
            prod["rates"] = sorted({num(r, a.rate_col) for r in prows})
        prod["rows"] = prows

    notes = []
    shift_min = a.shift_min or (prod or {}).get("shift_min") or 480.0
    if not a.shift_min and not (prod or {}).get("shift_min"):
        assumed_prod.append("Shift length was not given: assumed 480 planned minutes per shift.")
    a.shift_min = shift_min
    if not a.shifts and prod:
        a.shifts = float(prod["shifts"])
    if a.run_min:
        run_min = a.run_min
    else:
        shifts = a.shifts
        if not shifts:
            if seen is None:
                sys.exit("Give --shifts (or --run-min), or --date-col so shifts can be counted.")
            shifts = seen
            notes.append(f"Shifts covered was not given: counted {seen} shifts that have at least one stop. "
                         "Shifts with no stops are missing from that count, so stop rates are overstated.")
        run_min = shifts * a.shift_min - total_down
    if run_min <= 0:
        sys.exit("Running minutes came out at zero or less: check --shifts and --shift-min.")

    machines = []
    for spec in a.machine:
        name, rest = spec.split("=", 1)
        causes, _, speed = rest.rpartition(":")
        if not _:
            causes, speed = rest, ""
        machines.append((name.strip(), [c for c in causes.split("|") if c], float(speed) if speed else None))
    if len(machines) < 2:
        sys.exit("Give at least two --machine entries, in line order.")
    line_stops = []
    for spec in a.line_stop:
        name, rest = spec.split("=", 1)
        kind = "shift_start" if rest.endswith("@start") else "random"
        rest = rest[:-6] if kind == "shift_start" else rest
        line_stops.append((name.strip(), [c for c in rest.split("|") if c], kind))

    ms, ls, cv, unmapped = derive(rows, a.cause_col, a.minutes_col, run_min, machines, line_stops,
                                  [c for c in a.conveyor.split("|") if c], a.detail_col)
    n_shifts = (a.shifts or seen or run_min / a.shift_min)
    for item in ls:
        if item["kind"] == "shift_start":
            item["prob_per_shift"] = sig(min(1.0, item["data"]["n_stops"] / n_shifts))
    for item in ms + ls + ([cv] if cv else []):
        item["data"]["stops_per_shift"] = round(item["data"]["n_stops"] / n_shifts, 4)
    assumed = list(assumed_prod)
    speeds = [m["rated_speed"] for m in ms]
    if any(s is None for s in speeds):
        base = a.ideal_rate or (prod or {}).get("rate") or next((s for s in speeds if s), 100.0)
        for i, m in enumerate(ms):
            if m["rated_speed"] is None:
                m["rated_speed"] = round(base * (1 if i == 0 else 1.08 + 0.04 * i), 1)
                assumed.append(f"Rated speed of {m['name']} was not given: assumed {m['rated_speed']}/min.")
    caps = [float(x) for x in a.buffers.split(",") if x.strip()] if a.buffers else []
    if len(caps) != len(ms) - 1:
        if caps:
            sys.exit(f"--buffers needs {len(ms) - 1} values, one per conveyor between machines.")
        caps = [round(2 * ms[i]["rated_speed"]) for i in range(len(ms) - 1)]
        assumed.append("Buffer sizes were not given: assumed 2 minutes of the upstream machine's rated output each.")
    ideal_rate = a.ideal_rate or (prod or {}).get("rate") or min(m["rated_speed"] for m in ms)
    reference = None
    if prod and "total" in prod:
        num = lambda r, c: to_minutes(r.get(c)) or 0.0
        rate = (lambda r: num(r, a.rate_col)) if a.rate_col else (lambda r: ideal_rate)
        prun = prod.get("run")
        if prun is None and "planned" in prod:
            prun = prod["planned"] - total_down
            notes.append("The production log has no running-minutes column: running time taken as planned minutes minus the downtime file total.")
        if prun and prun > 0:
            ideal_units = sum(rate(r) * num(r, a.run_col) for r in prod["rows"]) if a.run_col else rate(prod["rows"][0]) * prun
            perf = prod["total"] / ideal_units if ideal_units else None
            if perf and a.run_speed_factor is None:
                a.run_speed_factor = round(perf, 4)
                if perf > 1.02:
                    notes.append(f"The log shows {perf * 100:.0f}% of the ideal rate between stops: the ideal rate is probably set too low.")
        if "good" in prod and prod["total"] > 0 and a.reject_rate is None:
            a.reject_rate = round(max(0.0, 1 - prod["good"] / prod["total"]), 4)
        if abs(prod["shifts"] - n_shifts) > 0.5:
            notes.append(f"Stop rates use every stop in the downtime file over {n_shifts:g} shifts; the run-speed factor, reject rate and reference figures "
                         f"use the {prod['shifts']} production rows that passed --prod-filter. If those are one product of several, its own stop rates may differ.")
        if len(prod.get("rates", [])) > 1:
            notes.append(f"The production rows have more than one ideal rate ({', '.join(f'{x:g}' for x in prod['rates'])}): they mix products. "
                         "The run-speed factor is weighted across them. For one product, add a --prod-filter for it and give --shifts for the whole line.")
        if "good" in prod and "planned" in prod:
            ideal_planned = sum(rate(r) * num(r, a.planned_col) for r in prod["rows"])
            reference = {"label": ", ".join([Path(a.production).name] + [f"{c} = {v}" for c, v in pf]), "shifts": prod["shifts"],
                         "good_per_shift": round(prod["good"] / prod["shifts"], 1),
                         "oee": round(prod["good"] / ideal_planned, 4) if ideal_planned else 0,
                         "downtime_min_per_shift": round(total_down / n_shifts, 2)}
            if prun:
                reference["availability"] = round(prun / prod["planned"], 4)
            if a.run_speed_factor is not None:
                reference["performance"] = a.run_speed_factor
    if a.run_speed_factor is None:
        a.run_speed_factor = 1.0
        assumed.append("Run-speed factor is 100%: the line is assumed to run at rated speed whenever it is not in a logged stop. "
                       "Real lines rarely do, so output will read high.")
    if a.reject_rate is None:
        a.reject_rate = 0.0
        assumed.append("Reject rate was not given: assumed 0%.")
    if not a.ideal_rate and not (prod or {}).get("rate"):
        assumed.append(f"Nameplate line rate was not given: taken as the slowest machine ({ideal_rate:g}/min). OEE is measured against it.")
    for c, (n, m) in unmapped.items():
        notes.append(f"Cause '{c}' ({n} stops, {m:.0f} min) is not mapped to anything and was left out.")

    cfg = {
        "schema": "line-sim/1", "name": a.name, "product": a.product, "unit": a.unit,
        "shift_min": a.shift_min,
        "ideal_rate": ideal_rate,
        "run_speed_factor": a.run_speed_factor, "reject_rate": a.reject_rate,
        "machines": ms, "buffers": [{"capacity": c} for c in caps], "line_stops": ls,
        "source": {"file": Path(a.downtime).name, "rows": len(rows), "run_min": round(run_min, 1),
                   "shifts": n_shifts, "downtime_min": round(total_down, 1),
                   "filters": a.filter, "date_from": a.date_from, "date_to": a.date_to},
        "assumptions": list(a.assume) + assumed, "notes": notes,
    }
    if cv:
        cfg["conveyor_stops"] = cv
    if reference:
        cfg["reference"] = reference
    if a.units_per_case:
        cfg["units_per_case"] = a.units_per_case
    Path(a.out).write_text(json.dumps(cfg, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"{a.out}: {len(rows)} rows, {n_shifts:g} shifts x {a.shift_min:g} min, {total_down:.0f} min down, {run_min:.0f} min running")
    print(f"{'source':<30}{'stops':>6}{'per shift':>11}{'run min between':>17}{'mean min':>10}{'spread':>8}")
    for kind, items in (("", ms), ("line: ", ls), ("", [dict(cv, name="Conveyors")] if cv else [])):
        for m in items:
            sph, k = m["stops_per_hour"], m["data"]["n_stops"]
            if not k:
                print(f"{(kind + m['name'])[:29]:<30}{0:>6}{'-':>11}{'-':>17}{'-':>10}{'-':>8}   no stops in the file: never stops")
                continue
            between = "at shift start" if m.get("kind") == "shift_start" else f"{60 / sph:.0f}"
            print(f"{(kind + m['name'])[:29]:<30}{k:>6}{m['data']['stops_per_shift']:>11.3f}{between:>17}{m['stop_mean_min']:>10.1f}{m['stop_spread']:>8.2f}")
    print(f"run-speed factor {a.run_speed_factor:.4f}   reject rate {a.reject_rate:.4f}   nameplate {ideal_rate:g}/min   buffers {', '.join(f'{c:g}' for c in caps)}")
    if reference:
        print(f"reference from the production log: {reference['shifts']} shifts, {reference['good_per_shift']:.0f} good per shift, OEE {reference['oee']:.3f}")
    for t in list(a.assume) + assumed:
        print("ASSUMPTION:", t)
    for t in notes:
        print("NOTE:", t)


if __name__ == "__main__":
    main()
