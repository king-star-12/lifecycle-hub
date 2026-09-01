# Synthetic dataset

Everything in this directory is **simulated**. It is not utility data and must
never be presented as such. The city geography, street names and pressure-zone
names are real Pittsburgh references so that the external-context layer can
search for genuine municipal notices; the pipes, sensors, telemetry, failures,
complaints and inspection reports are all generated.

## Files

| File | Contents | Application may read |
|---|---|---|
| `network.json` | Assets, zones, neighbours, weather, failures, repairs, complaints, findings | yes |
| `telemetry.json` | Per-asset daily pressure/flow/transient series | yes |
| `documents.json` | Inspection report prose, as it would appear in a PDF | yes |
| `zone-series.json` | Zone-wide operating conditions | yes |
| `_ground-truth.json` | **Latent condition and failure archetype per asset** | **no** |

## Why ground truth is separated

`_ground-truth.json` holds the hidden state the simulator used to decide when
each pipe failed. The risk engine never sees it. Telemetry is only a noisy,
partial observation of it, and 38% of segments have no sensor at all.

If the engine could read this file, the backtest would be scoring it on
recovering a signal it had been handed — which measures nothing. Only
`scripts/backtest.ts` may open it, and only to grade predictions after they
have been made.

The leading underscore is the convention that marks the boundary.
