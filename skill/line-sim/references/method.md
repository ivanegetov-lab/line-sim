# Method

## From a downtime log to stop rates (`derive_params.py`, and the page's CSV import)

For the rows that pass the filters:

1. **Running minutes** = shifts covered × planned minutes per shift − all downtime minutes in the file. Use the real number of production shifts. If it is not given it is counted from the file, which misses shifts with no stops and makes every stop rate too high; the script prints a note when it does this.
2. Each cause is mapped to a machine, to the conveyors, to a whole-line stop, or left out. Per stop source:
   - **stops per hour** = number of stops ÷ running minutes × 60
   - **mean stop** = average logged minutes
   - **spread** = standard deviation of ln(minutes), the maximum-likelihood sigma of a lognormal
3. Stops at the start of a shift (changeovers) get a probability per shift = stops ÷ shifts, capped at 1.
4. With a production log: **run-speed factor** = units made ÷ Σ(ideal rate × running minutes); **reject rate** = 1 − good ÷ made; reference OEE = good ÷ Σ(ideal rate × planned minutes).

Zero-minute and blank rows are ignored. Numbers are rounded to 6 significant figures (spread to 4).

## What the engine does with them

- One-second time steps, whole units. Machines are processed from the end of the line backwards, so space freed downstream can be used in the same second.
- A machine makes `rated_speed × run_speed_factor` per minute, limited by what is in the buffer before it and the space in the buffer after it. Capacity it cannot use is lost, not saved up.
- **Starved** = it wanted to make more and the buffer before it ran out. **Blocked** = the buffer after it was full. **Down** = in a stop.
- Time to the next stop is exponential with mean 1 ÷ stop rate, and the clock only runs while the machine is working (a starved or blocked machine does not wear towards its next stop). Stop length is lognormal with the given mean and spread, at least one second.
- Buffers have a capacity and no travel time. Machines hold no product. The line starts empty, so the first unit needs (machines − 1) seconds to reach the end.
- Line stops halt every machine. Repairs already under way carry on during a line stop.
- Rejects are a fixed share of finished units.
- **Bottleneck** = the machine with the least time starved or blocked over the shift. Machines within 0.5% of the shift of each other count as tied and the one furthest downstream is named.
- **OEE** = good units ÷ (ideal rate × planned minutes). Availability = 1 − logged stop minutes ÷ planned minutes. Performance = units made ÷ (ideal rate × minutes not in a logged stop).
- Each stop source has its own random stream, so changing a buffer does not reshuffle another machine's stops: scenarios are compared on the same stops.

## What it leaves out

Parallel machines, rework loops, batch processes, speed that changes with buffer level, conveyor travel time, operators shared between machines, repairs that depend on each other, planned maintenance, and learning effects. Stop lengths are assumed independent of each other and of the time of day.
