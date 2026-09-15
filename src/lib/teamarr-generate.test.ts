import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from './config';
import { Store } from './store';
import { triggerGenerateAfterMeasure } from './teamarr-generate';

/** A stub for global fetch that records every call it receives. */
function stubFetch() {
  const calls: string[] = [];
  const fn = vi.fn(async () => {
    calls.push('called');
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

const cfg = (over: Record<string, string> = {}) =>
  loadConfig({
    DISPATCHARR_API_KEY: 'k',
    PODIUM_TEAMARR_URL: 'http://teamarr.local',
    PODIUM_TEAMARR_GENERATE_AFTER_MEASURE: 'true',
    ...over,
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('triggerGenerateAfterMeasure', () => {
  it('does nothing when the feature is off', async () => {
    const calls = stubFetch();
    const store = new Store(':memory:');
    const result = await triggerGenerateAfterMeasure(
      store,
      cfg({ PODIUM_TEAMARR_GENERATE_AFTER_MEASURE: 'false' }),
      { measured: 3 },
    );
    expect(result.fired).toBe(false);
    expect(result.reason).toContain('off');
    expect(calls).toHaveLength(0);
  });

  it('does nothing without a Teamarr URL', async () => {
    const calls = stubFetch();
    const store = new Store(':memory:');
    const result = await triggerGenerateAfterMeasure(store, cfg({ PODIUM_TEAMARR_URL: '' }), {
      measured: 3,
    });
    expect(result.fired).toBe(false);
    expect(result.reason).toContain('URL');
    expect(calls).toHaveLength(0);
  });

  it('does nothing when the pass measured nothing', async () => {
    const calls = stubFetch();
    const store = new Store(':memory:');
    const result = await triggerGenerateAfterMeasure(store, cfg(), { measured: 0 });
    expect(result.fired).toBe(false);
    expect(result.reason).toContain('nothing was measured');
    expect(calls).toHaveLength(0);
  });

  it('fires on the first measured pass, and records it', async () => {
    stubFetch();
    const store = new Store(':memory:');
    expect(store.teamarrGenerate()).toBeNull();
    const result = await triggerGenerateAfterMeasure(store, cfg(), { measured: 1 });
    expect(result.fired).toBe(true);
    expect(store.teamarrGenerate()).not.toBeNull();
  });

  it('does not fire twice within the debounce floor', async () => {
    const calls = stubFetch();
    const store = new Store(':memory:');
    const first = await triggerGenerateAfterMeasure(
      store,
      cfg({ PODIUM_TEAMARR_GENERATE_MIN_INTERVAL_MS: '300000' }),
      { measured: 1 },
    );
    expect(first.fired).toBe(true);
    expect(calls).toHaveLength(1);

    // A second pass measures something too, moments later -- the floor must
    // collapse this into the one call the first pass already earned.
    const second = await triggerGenerateAfterMeasure(
      store,
      cfg({ PODIUM_TEAMARR_GENERATE_MIN_INTERVAL_MS: '300000' }),
      { measured: 5 },
    );
    expect(second.fired).toBe(false);
    expect(second.reason).toContain('floor');
    expect(calls).toHaveLength(1);
  });

  it('fires again once the floor has passed', async () => {
    const calls = stubFetch();
    const store = new Store(':memory:');
    // A floor of 0 is the same test without a real clock wait.
    const zeroFloor = cfg({ PODIUM_TEAMARR_GENERATE_MIN_INTERVAL_MS: '0' });
    await triggerGenerateAfterMeasure(store, zeroFloor, { measured: 1 });
    const second = await triggerGenerateAfterMeasure(store, zeroFloor, { measured: 1 });
    expect(second.fired).toBe(true);
    expect(calls).toHaveLength(2);
  });
});
