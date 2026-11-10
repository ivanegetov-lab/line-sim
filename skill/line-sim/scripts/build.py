#!/usr/bin/env python3
"""Embed a line config into a copy of the simulator page.

    python3 build.py config.json --out my-line.html

The result is one self-contained HTML file that opens on the user's line. It works offline
(the optional 3D view loads three.js from a CDN; without it the page shows the 2D view).
Standard library only. The config is checked first; problems are printed and nothing is written.
"""
import argparse, json, re, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
TEMPLATE = HERE.parent / "assets" / "simulator.html"
MAX_MACHINES = 10
SLOT = re.compile(r'(<script id="userconfig" type="application/json">).*?(</script>)', re.S)


def is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and abs(v) != float("inf")


def check(cfg):
    """Returns (errors, warnings). Mirrors what the page's normalize() would otherwise fix silently."""
    err, warn = [], []
    if not isinstance(cfg, dict):
        return ["The config must be a JSON object."], warn
    ms = cfg.get("machines")
    if not isinstance(ms, list) or not 2 <= len(ms) <= MAX_MACHINES:
        return [f"machines: need 2 to {MAX_MACHINES} machines in line order, got {len(ms) if isinstance(ms, list) else 'none'}."], warn

    def stops(o, where, start=False):
        if "stops_per_hour" in o and "mtbs_min" in o:
            warn.append(f"{where}: both stops_per_hour and mtbs_min are set; stops_per_hour is used.")
        for k in ("stops_per_hour", "mtbs_min", "stop_mean_min", "stop_spread", "prob_per_shift"):
            if k in o and o[k] is not None and (not is_num(o[k]) or o[k] < 0):
                err.append(f"{where}.{k}: must be a number of 0 or more, got {o[k]!r}.")
        rate = o.get("stops_per_hour") or (60 / o["mtbs_min"] if is_num(o.get("mtbs_min")) and o["mtbs_min"] > 0 else 0)
        freq = o.get("prob_per_shift") if start else rate
        if is_num(freq) and freq > 0 and not (is_num(o.get("stop_mean_min")) and o["stop_mean_min"] > 0):
            warn.append(f"{where}: it stops but stop_mean_min is 0 or missing, so the stops have no effect.")
        if is_num(o.get("stop_spread")) and o["stop_spread"] > 3:
            err.append(f"{where}.stop_spread: {o['stop_spread']} is out of range (0 to 3; 0.6 is typical).")
        if start and is_num(o.get("prob_per_shift")) and o["prob_per_shift"] > 1:
            err.append(f"{where}.prob_per_shift: must be between 0 and 1.")

    for i, m in enumerate(ms):
        w = f"machines[{i}]"
        if not isinstance(m, dict):
            err.append(f"{w}: must be an object.")
            continue
        if not str(m.get("name") or "").strip():
            warn.append(f"{w}: no name, the page will call it Machine {i + 1}.")
        if not is_num(m.get("rated_speed")) or m["rated_speed"] <= 0:
            err.append(f"{w}.rated_speed: must be a number above 0 (units per minute), got {m.get('rated_speed')!r}.")
        stops(m, w)
    bs = cfg.get("buffers")
    if not isinstance(bs, list) or len(bs) != len(ms) - 1:
        err.append(f"buffers: need {len(ms) - 1} entries (one conveyor between each pair of machines), got {len(bs) if isinstance(bs, list) else 'none'}.")
    else:
        for i, b in enumerate(bs):
            cap = b.get("capacity") if isinstance(b, dict) else b
            if not is_num(cap) or cap < 1:
                err.append(f"buffers[{i}].capacity: must be 1 or more units, got {cap!r}.")
    if not is_num(cfg.get("shift_min")) or not 10 <= cfg["shift_min"] <= 1440:
        err.append(f"shift_min: planned minutes per shift, 10 to 1440, got {cfg.get('shift_min')!r}.")
    f = cfg.get("run_speed_factor", 1)
    if not is_num(f) or f <= 0:
        err.append(f"run_speed_factor: must be above 0 (1 = rated speed), got {f!r}.")
    elif f > 1:
        warn.append(f"run_speed_factor {f} is above 1: the page reads it as a percentage ({min(100.0, f):g}%).")
    q = cfg.get("reject_rate", 0)
    if not is_num(q) or q < 0:
        err.append(f"reject_rate: must be 0 or more, got {q!r}.")
    elif q >= 1:
        warn.append(f"reject_rate {q} is 1 or more: the page reads it as a percentage ({q:g}%).")
    if "ideal_rate" in cfg and (not is_num(cfg["ideal_rate"]) or cfg["ideal_rate"] <= 0):
        err.append(f"ideal_rate: must be above 0, got {cfg['ideal_rate']!r}.")
    ls = cfg.get("line_stops", [])
    if not isinstance(ls, list):
        err.append("line_stops: must be a list.")
    else:
        for i, s in enumerate(ls):
            if not isinstance(s, dict):
                err.append(f"line_stops[{i}]: must be an object.")
                continue
            if s.get("kind", "random") not in ("random", "shift_start"):
                err.append(f"line_stops[{i}].kind: must be \"random\" or \"shift_start\", got {s.get('kind')!r}.")
            stops(s, f"line_stops[{i}]", s.get("kind") == "shift_start")
    if isinstance(cfg.get("conveyor_stops"), dict):
        stops(cfg["conveyor_stops"], "conveyor_stops")
    if not err:
        speeds = [m["rated_speed"] for m in ms]
        if is_num(cfg.get("ideal_rate")) and cfg["ideal_rate"] > min(speeds) * 1.0001:
            warn.append(f"ideal_rate {cfg['ideal_rate']:g} is above the slowest machine ({min(speeds):g}): the line can never reach 100% performance.")
    return err, warn


def summary(cfg):
    ms, hrs = cfg["machines"], cfg["shift_min"] / 60
    caps = [b.get("capacity") if isinstance(b, dict) else b for b in cfg["buffers"]]
    rate = lambda o: o.get("stops_per_hour") or (60 / o["mtbs_min"] if o.get("mtbs_min") else 0)
    out = [f"{cfg.get('name', 'My line')}: {len(ms)} machines, {cfg['shift_min']:g}-minute shift, "
           f"run-speed factor {cfg.get('run_speed_factor', 1):g}, rejects {cfg.get('reject_rate', 0):g}"]
    for i, m in enumerate(ms):
        r = rate(m)
        out.append(f"  {i + 1}. {str(m.get('name', ''))[:22]:<22} {m['rated_speed']:>8g}/min  "
                   + (f"{r * hrs:5.2f} stops/shift x {m.get('stop_mean_min', 0):.1f} min" if r else "never stops")
                   + (f"   -> buffer {caps[i]:g}" if i < len(caps) else ""))
    for s in cfg.get("line_stops", []):
        per = s.get("prob_per_shift", 0) if s.get("kind") == "shift_start" else rate(s) * hrs
        out.append(f"  line stop: {str(s.get('name', ''))[:22]:<22} {per:5.2f} per shift x {s.get('stop_mean_min', 0):.1f} min ({s.get('kind', 'random')})")
    cv = cfg.get("conveyor_stops")
    if isinstance(cv, dict) and rate(cv):
        out.append(f"  conveyors: {rate(cv) * hrs:5.2f} stops/shift x {cv.get('stop_mean_min', 0):.1f} min")
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("config", help="config.json written by derive_params.py, exported from the page, or written by hand")
    ap.add_argument("--out", default="my-line.html")
    ap.add_argument("--template", default=str(TEMPLATE), help="simulator page to copy (default: ../assets/simulator.html)")
    a = ap.parse_args()

    try:
        cfg = json.loads(Path(a.config).read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as e:
        sys.exit(f"Could not read {a.config}: {e}")
    err, warn = check(cfg)
    for w in warn:
        print("WARNING:", w)
    if err:
        for e in err:
            print("ERROR:", e)
        sys.exit(f"{a.config} has {len(err)} problem(s); nothing written.")
    try:
        page = Path(a.template).read_text(encoding="utf-8")
    except OSError as e:
        sys.exit(f"Could not read the simulator template: {e}")
    blob = json.dumps(cfg, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    new, k = SLOT.subn(lambda m: m.group(1) + blob + m.group(2), page, count=1)
    if k != 1:
        sys.exit("The template has no <script id=\"userconfig\"> slot: is it the line-sim simulator page?")
    Path(a.out).write_text(new, encoding="utf-8")
    print(f"{a.out} written ({len(new) / 1024:.0f} KB). Open it in a browser; it starts on this line:")
    for line in summary(cfg):
        print(line)
    for t in cfg.get("assumptions", []):
        print("ASSUMPTION:", t)
    for t in cfg.get("notes", []):
        print("NOTE:", t)


if __name__ == "__main__":
    main()
