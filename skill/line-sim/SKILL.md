---
name: line-sim
description: Build an interactive simulator of the user's own production or packaging line (2 to 10 machines in series with conveyors or buffers between them) as one self-contained HTML file, from a downtime or production export (CSV or Excel) or from a short interview. Use when someone wants to simulate a line, find or confirm the bottleneck, test what a bigger buffer, a faster machine or fewer stops would be worth, compare what-if scenarios for a line, or turn a downtime log into something a team can play with.
---

# Line simulator for the user's own line

You produce `my-line.html`: a single page that runs the user's line second by second (machines running, starved, blocked or down, buffers filling), compares what-if scenarios over hundreds of shifts, and lets them edit every number. It opens offline in any browser. Nothing is uploaded anywhere.

The simulator models a **serial line**: 2 to 10 machines in order, one conveyor or buffer between each pair. Each machine has a rated speed and stops at random; the time between stops and the length of stops come from the user's data. If the line has parallel machines, rework loops or batch steps, say so before you start: model the main path, or treat a parallel group as one machine with the combined speed, and record that as an assumption.

## What you need from the user

| Needed | Best source | If they do not have it |
|---|---|---|
| Machines in line order | The user | Ask. Do not guess the order. |
| Rated speed of each machine, units per minute | Nameplate or line design sheet | Ask for the line rate and which machine is the slowest, and give at least that one its speed. For any speed left off, `derive_params.py` assumes the first machine runs at the line rate and each later one 12%, 16%, 20%... faster, and flags it. |
| How many units each conveyor or buffer holds | Line drawing, or "how long can the filler keep running when the labeler stops?" × speed | Leave it out: the script assumes 2 minutes of upstream output and flags it. |
| How often each machine stops and for how long | Downtime export: one row per stop, with a machine or cause column and a minutes column | Interview: "about how many times a shift does it stop, and for how long?" |
| Number of production shifts the file covers, and planned minutes per shift | Production log (one row per shift), or the user | Ask. Counting only shifts that appear in the downtime file overstates stop rates. |
| Real speed between stops and reject rate | Production log: units made, good units, running minutes, ideal rate | Without it the line is assumed to run at rated speed (it will read high). |

Ask only for what the files do not answer. Two or three questions at a time is plenty.

## Steps

### 1. Read the data, or interview

With files: look at the header and a few rows first. Work out which column is the cause or machine, which is the minutes, whether there is a date and a shift column, and whether the file holds more than one line (then filter). Then list the causes:

```bash
python3 scripts/derive_params.py --downtime downtime.csv --cause-col cause --minutes-col minutes \
    --date-col date --shift-col shift --filter line="Line 1" --list-causes
```

Add `--detail-col asset_id` if a vague cause such as "Waiting on maintenance" is booked to different machines in a second column. The listing then shows an "of which" row for each detail value under a cause that has them (no extra rows means that column is empty for those causes), and such rows can be mapped as `"Waiting on maintenance [FIL-1]"`.

Decide where every cause goes, and confirm the mapping with the user when it is not obvious:

- a machine fault → that machine
- conveyor or transport stops → `--conveyor`
- changeovers, start-up, cleaning at the start of a shift → a line stop with `@start`
- material shortage, waiting, "other", anything that stops everything → a line stop at a random time
- breaks, lunch, no orders, planned maintenance outside production time → leave unmapped (the script lists what was left out)

Every cause must end up either mapped or deliberately left out. If one cause plainly mixes different things (comments show breaks inside "Other"), tell the user rather than guess.

Excel works directly if `openpyxl` is installed (`--sheet` picks the sheet); otherwise ask for a CSV or convert it.

Without files: interview the user and write `config.json` by hand, following `references/config-schema.md`. Use `mtbs_min` (minutes of running between stops) and `stop_mean_min` straight from their answers. Put every estimate into `assumptions`. Then go to step 3.

### 2. Run `derive_params.py` to write `config.json`

```bash
python3 scripts/derive_params.py \
    --downtime downtime.csv --cause-col cause --minutes-col minutes --date-col date --shift-col shift \
    --filter line="Line 1" \
    --production production.csv --prod-filter line="Line 1" --planned-col planned_min --run-col run_min \
    --total-col total_count --good-col good_count --rate-col ideal_rate_per_min \
    --machine "Filler=Filler faults:100" --machine "Capper=Capper faults:109" \
    --machine "Labeler=Labeler jams:107" --machine "Case packer=Case packer faults:114" \
    --machine "Palletizer=:123" \
    --buffers 50,180,180,110 \
    --line-stop "Changeover=Changeovers@start" --line-stop "Other line stops=Material short|Other|Waiting on maintenance" \
    --conveyor "Conveyor" \
    --name "Line 1" --product "All-purpose cleaner 1 L" --unit bottles --units-per-case 12 \
    --assume "Rated speeds are from the 2019 line design sheet, not measured." \
    --out config.json
```

- `--machine "Name=cause|cause:speed"`, once per machine, in line order. An empty cause list means the machine has no logged stops. Leave the speed off if it is unknown.
- With no production log, give `--shifts` and `--shift-min` yourself, and `--run-speed-factor` and `--reject-rate` if the user knows them. `--ideal-rate` sets the nameplate line rate that OEE is measured against (default: the rate in the production log, else the slowest machine). `--units-per-case` is optional.
- If the line runs products at different rates, the script says so. Pick one product: run once with only the line filter and read the shift count from the first output line, then add a second `--prod-filter` for the product and pass that count as `--shifts`. Speed, rejects and the reference figures then describe the one product, while stop rates still use every stop on the line over every shift (a downtime file rarely says which product was running). The script prints a note about this; pass it on to the user.
- `--assume "..."` records an assumption in the config so that it shows on the page. Use it for every number the user estimated or you chose.
- `python3 scripts/derive_params.py --help` lists every option. The method is in `references/method.md`.

Read the table it prints. Check it against common sense before going on: stops per shift that look too high usually mean the shift count is too low; a run-speed factor above 100% means the ideal rate is wrong.

### 3. Run `build.py` to make the page

```bash
python3 scripts/build.py config.json --out my-line.html
```

It checks the config, copies `assets/simulator.html` and embeds the config. If it prints `ERROR`, fix `config.json` and run it again. Do not edit the HTML by hand.

### 4. Tell the user what they have, and what is assumed

Give them the file and say, in plain words:

1. **What came from their data**: which file, how many stops over how many shifts, which line.
2. **What is assumed**: every `ASSUMPTION:` and `NOTE:` line the two scripts printed, plus any choice you made (cause mapping, a parallel group merged into one machine, causes left out). Do not bury these. If speeds or buffer sizes are guesses, say that the bottleneck and the buffer results depend on them.
3. **How well it matches**: if `node` is available, run `node scripts/check.mjs config.json`. It simulates 200 shifts with the same engine as the page and prints output, OEE, logged downtime and the bottleneck, next to the real figures when the config has them. Within a few percent is good. If it is far off, say so and say which input you suspect. Without `node`, do not claim a match: tell the user the same comparison is on the page under "Data, method and assumptions".
4. **What to do with it**: press Run, switch scenarios, edit numbers under "Build your line", use "Copy share link" to send the exact line to a colleague.

A simulation shows how the line behaves under the numbers it was given. It is a way to compare options, not a forecast. Say this once, briefly.

## Files

- `scripts/derive_params.py`: downtime (and production) export → `config.json`. Standard library; Excel needs `openpyxl`.
- `scripts/build.py`: `config.json` → `my-line.html`. Standard library.
- `scripts/check.mjs`: optional, needs Node 18+. Runs 200 shifts of `config.json` without a browser and prints the result against the reference figures.
- `assets/simulator.html`: the simulator page that `build.py` copies. Do not edit.
- `references/config-schema.md`: every field of `config.json`, with an example to copy for interview-only lines.
- `references/method.md`: how stop rates are worked out and what the engine assumes. Read it when the user asks "how is this calculated?".
