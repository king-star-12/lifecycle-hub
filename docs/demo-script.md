# Three-minute demo

**CLUE — Connected Lifecycle Utility Engine**, a Clustral AI product.

One story, told once, with nothing improvised. Rehearse against the exact URLs
below — every one is deep-linkable, so nothing depends on finding a pipe on a map
while people watch.

**Setup**: `npx next dev --webpack -p 3100`. Have three tabs pre-opened:

1. `http://localhost:3100`
2. `http://localhost:3100/?asset=WM-1385`
3. `http://localhost:3100/metrics`

---

## 0:00–0:20 · The problem

> "Water mains don't usually fail because one sensor turns red. They fail after
> months of weak signals that were never in the same place at the same time —
> pressure in SCADA, corrosion in a PDF, three complaints in a call centre, a
> cold snap in a weather feed. Every one of them is individually ignorable."

Tab 1. Let the map sit. 1,892 segments across Pittsburgh, coloured by risk.

Point at the **SYNTHETIC DATA** badge and say it out loud:

> "This network is simulated — I'll come back to why that's defensible rather
> than a cop-out."

## 0:20–0:45 · Every asset has a state

Drag the risk threshold up to ~50. The map thins to the elevated segments.

> "Not a leak alarm. Every segment carries a live risk state, a trajectory, and
> a confidence — and 40% of them have no sensor at all, which the confidence
> reflects."

## 0:45–1:20 · Ask why

Click the top item in the priority queue.

> "Risk 80. But the number isn't the product — this is."

Scroll the decomposition.

> "Every point is attributable. Age and material, observed. Hydraulic regime
> change, inferred — and note *against zone*: a pump changeover moves every pipe
> in a pressure zone together, so we only count what diverges from its
> neighbours. Then inspection evidence, extracted from an actual PDF."

Expand **View source document**. Point at the line:

> "'No active leak was detected at the time of inspection.' That sentence is why
> this pipe got deprioritised for three years. It's an observation about one
> day, not a statement about condition."

Hit **Retrieve external context**.

> "And this is live. Real reports of water main breaks on this street, from
> PWSA's own site and local news — retrieved just now." *(Point at the amber
> caveat.)* "Those articles are real; the pipe is simulated. We say so, and web
> evidence is capped and needs corroboration — it can never elevate an asset on
> its own."

## 1:20–2:00 · Rewind — the centerpiece

Tab 2 (`?asset=WM-1385`) → **Reconstruct what the system knew before it broke**.

Let it play. Say nothing for the first few seconds.

> "Every frame here is a fresh evaluation against a dataset truncated at that
> date. This isn't a stored curve being replayed — where the line is flat, the
> engine genuinely had nothing."

As signals appear in the right rail:

> "Age was always there. Freeze-thaw at 200 days. Hydraulic regime change.
> Nearby breaks. Then pressure variance diverging from its zone."

At the reveal:

> "Seven independent signals. The score crossed the actionable threshold 44 days
> before the pipe failed. No single one of those would have justified a crew."

## 2:00–2:30 · Does it actually work

Tab 3, `/metrics`.

> "We backtested it walk-forward against the two methods utilities use today:
> pipe age, and age plus break history. 16.7× random versus 2.3×. Precision at
> ten: 18% against 1.6% — roughly one in five inspections finds a pipe that
> breaks within 90 days."

Then, deliberately:

> "Median warning 130 days. But only 29% of failures ever cross that threshold —
> the other 71% get no warning at all. We're showing you that number because a
> risk tool that hides its misses is worse than none."

Point at calibration.

> "And the bands mean what they say. 65–79 fails 26% of the time. Under 20,
> never."

## 2:30–2:50 · Act on it

Back to the asset panel → **Generate intelligence report**.

> "The operator gets this. Evidence, confidence, known gaps, recommended action —
> and a signature block, because the system proposes an inspection and
> authorises nothing. Recommendations land in Xano as 'proposed' with an audit
> trail attached."

## 2:50–3:00 · Close

> "CLUE isn't predicting the future from one signal. It's noticing when the
> system has already started telling us something — and showing its work."

---

## If asked

**"It's synthetic — why should I believe any of it?"**
Two reasons. The simulation is validated against NOAA normals and AWWA break
statistics — 19 checks, in the repo, they fail loudly. And the engine never sees
ground truth: telemetry is a noisy partial observation of a hidden condition, and
a truncation test proves no score changes when you delete everything after the
scoring date. The numbers describe behaviour on simulated data. We don't claim
more.

**"Why not deep learning?"**
Because the output has to survive an engineer asking why before they excavate a
street. The score is additive and decomposable by construction. A GNN is Stage 3,
after there's a utility's own break history to calibrate against.

**"What breaks first in a real deployment?"**
Sensor coverage and asset-registry quality. The hazard is calibrated to a
published break rate, not to any specific utility, so it would need recalibrating
against their history before the scores mean anything locally.
