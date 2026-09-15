/**
 * Nudge Teamarr to regenerate right after a measure-only pass, instead of
 * waiting for Teamarr's own schedule.
 *
 * A `measure_only` group (see `eligibility.ts`) exists because Teamarr, not
 * Podium, writes the order a viewer gets. That is the right split of
 * ownership, but it leaves a gap: a probe that just cleared `grace_minutes`
 * on an after-kickoff channel produces a fresh verdict that sits unused until
 * Teamarr's own EPG job next runs, which was not timed around any particular
 * kickoff. `PODIUM_TEAMARR_SYNC` closes the same kind of gap for the rules
 * Teamarr scores with; this closes it for the trigger to act on them.
 *
 * Deliberately coarse. Teamarr's generate endpoint has no per-channel or
 * per-event scope beyond `team_ids`, which is not attempted here -- resolving
 * it would mean a second Teamarr read per measured channel, for a saving that
 * only matters on an install already busy enough for the debounce below to
 * bind. One full regeneration per pass that measured something is the whole
 * mechanism.
 */

import type { Config } from './config';
import type { RunSummary } from './runner';
import type { Store } from './store';
import { TeamarrClient } from './teamarr-client';

export interface GenerateTrigger {
  /** Whether this call actually asked Teamarr to regenerate. */
  fired: boolean;
  /** Why it did not, when it did not. */
  reason?: string;
}

/**
 * Fire a Teamarr regeneration if this pass measured something under a
 * measure-only policy, the feature is on, and the debounce floor has passed.
 *
 * Reads and writes `store.teamarrGenerate()` itself, so a caller only needs
 * to run this once per pass -- see `worker/loop.ts`.
 */
export async function triggerGenerateAfterMeasure(
  store: Store,
  config: Config,
  summary: Pick<RunSummary, 'measured'>,
): Promise<GenerateTrigger> {
  if (!config.PODIUM_TEAMARR_GENERATE_AFTER_MEASURE) {
    return { fired: false, reason: 'PODIUM_TEAMARR_GENERATE_AFTER_MEASURE is off' };
  }
  if (!config.PODIUM_TEAMARR_URL.trim()) {
    return { fired: false, reason: 'no Teamarr URL is configured' };
  }
  if (summary.measured <= 0) {
    return { fired: false, reason: 'nothing was measured this pass' };
  }
  const lastAt = store.teamarrGenerate() ?? 0;
  const sinceLast = Date.now() - lastAt;
  if (sinceLast < config.PODIUM_TEAMARR_GENERATE_MIN_INTERVAL_MS) {
    return {
      fired: false,
      reason:
        `within the ${config.PODIUM_TEAMARR_GENERATE_MIN_INTERVAL_MS / 1000}s floor ` +
        `(last fired ${Math.round(sinceLast / 1000)}s ago)`,
    };
  }

  // Recorded before the call resolves, not after: a call this pass starts is
  // a call the next pass must not repeat, whether Teamarr answers in time or
  // not. A generate request already in flight is not helped by a second one.
  store.saveTeamarrGenerate();
  const client = new TeamarrClient(config.PODIUM_TEAMARR_URL);
  await client.generate();
  return { fired: true };
}
