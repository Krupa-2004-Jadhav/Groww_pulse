import { SplitEvent } from "@/lib/providers";

/**
 * Computes a per-bar adjustment factor so historical closes, multiplied by
 * this factor, form a continuous series across any split — no fake cliff on
 * the split date. Bars on/after the most recent split get 1.0; bars before
 * a split accumulate that split's (and any later splits') price ratio.
 *
 * `dates` and the returned factors are positionally aligned.
 */
export function computeAdjustmentFactors(dates: Date[], splits: SplitEvent[]): number[] {
  const sorted = [...splits].sort((a, b) => a.date.getTime() - b.date.getTime());

  return dates.map((date) => {
    let factor = 1;
    for (const split of sorted) {
      if (date.getTime() < split.date.getTime()) {
        factor *= split.toFactor / split.fromFactor;
      }
    }
    return factor;
  });
}
