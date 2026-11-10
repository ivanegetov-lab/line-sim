# config.json (schema `line-sim/1`)

One JSON object describes one serial line. The same format is used by the page's Import / Export JSON buttons, by share links and by `build.py`. Unknown keys are kept and ignored, so you can add your own notes.

## Minimal example (copy this for an interview-only line)

```json
{
  "name": "Jar line B",
  "product": "Pasta sauce 500 g",
  "unit": "jars",
  "shift_min": 480,
  "run_speed_factor": 0.85,
  "reject_rate": 0.01,
  "machines": [
    { "name": "Filler",  "rated_speed": 200, "mtbs_min": 90,  "stop_mean_min": 4 },
    { "name": "Capper",  "rated_speed": 220, "mtbs_min": 240, "stop_mean_min": 6 },
    { "name": "Labeler", "rated_speed": 230, "stops_per_hour": 1, "stop_mean_min": 3, "stop_spread": 0.8 }
  ],
  "buffers": [ { "capacity": 150 }, { "capacity": 400 } ],
  "line_stops": [
    { "name": "Changeover", "kind": "shift_start", "prob_per_shift": 0.3, "stop_mean_min": 35, "stop_spread": 0.2 },
    { "name": "Material short", "kind": "random", "mtbs_min": 1500, "stop_mean_min": 20 }
  ],
  "assumptions": [ "Every number is the supervisor's estimate from an interview. No downtime log was used." ]
}
```

## Line fields

| Field | Type | Default | Meaning |
|---|---|---|---|
| `name` | text | "My line" | Shown in the header and the line picker. |
| `product` | text | "" | Shown next to the name. |
| `unit` | text | "units" | What the line makes: bottles, cans, jars, cases, parts. |
| `shift_min` | number, 10–1440 | 480 | Planned production minutes in one shift. One simulation run is one shift. |
| `ideal_rate` | number > 0 | slowest machine | Nameplate line rate per minute. OEE and performance are measured against it. |
| `run_speed_factor` | 0.05–1 | 1 | Share of rated speed the line really achieves between logged stops. Applied to every machine. A value above 1 is read as a percentage (70.9 → 0.709). |
| `reject_rate` | 0–0.9 | 0 | Share of finished units rejected. A value of 1 or more is read as a percentage. |
| `units_per_case` | number | none | Optional. The page then also shows cases packed. |
| `machines` | list of 2–10 | required | In line order. See below. |
| `buffers` | list, one fewer than machines | 2 min of upstream output | `buffers[i]` sits between machine `i` and machine `i+1`. `{ "capacity": 200 }` or just `200`. |
| `line_stops` | list, up to 12 | [] | Stops that halt every machine at once. See below. |
| `conveyor_stops` | object | none | Stops of the conveyor system: `stops_per_hour` (or `mtbs_min`), `stop_mean_min`, `stop_spread`. Each stop lands on one conveyor chosen at random: the machine before it blocks, the machine after it starves. |
| `assumptions`, `notes` | lists of text | [] | Shown on the page under "Data, method and assumptions". |
| `reference` | object | none | Real figures to compare against: `label`, `shifts`, `good_per_shift`, `oee`, `downtime_min_per_shift`, optional `availability`, `performance`, `target_oee`. |
| `source` | object | none | Where the numbers came from (file, rows, shifts, run minutes). Informational. |
| `scenarios` | list | generic set | Optional what-ifs: `{ "id", "name", "short", "note", "color", "set": { "machines.Labeler.stops_per_hour": 0.17, "buffers.1.capacity": 2000 } }`. Paths address list items by index or by machine name. Without it the page offers: as set up, double every buffer, halve and remove the stops of the worst machine, slowest machine +10%, no stops. |

## Machine fields

| Field | Type | Default | Meaning |
|---|---|---|---|
| `name` | text | "Machine N" | The 3D view picks a shape from the name (filler, capper, labeler, packer, palletizer, other). |
| `rated_speed` | number > 0 | 100 | Units per minute at nameplate. |
| `stops_per_hour` | number ≥ 0 | 0 | Stops per hour of running. 0 = never stops. |
| `mtbs_min` | number > 0 | – | Alternative to `stops_per_hour`: mean running minutes between stops. Converted on load (`stops_per_hour = 60 / mtbs_min`). |
| `stop_mean_min` | number ≥ 0 | 0 | Average length of a stop, minutes. |
| `stop_spread` | 0–3 | 0.5 | How uneven stop lengths are (lognormal sigma). 0 = all stops the same length, 0.3 = most stops close to the average, 0.6 = typical, 1.0 = a few very long ones. |
| `data` | object | none | Optional record of the source data: `n_stops`, `total_min`, `causes`, `stops_per_shift`. Shown in the check table. |

## Line stop fields

| Field | Meaning |
|---|---|
| `name` | Shown in the stop log. |
| `kind` | `"random"`: happens at a random time, rate given by `stops_per_hour` or `mtbs_min` (per hour the line is not already in a line stop). `"shift_start"`: happens at the start of a shift with probability `prob_per_shift` (0–1). Use it for changeovers. |
| `stop_mean_min`, `stop_spread` | As for machines. |
