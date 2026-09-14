/**
 * Setting how long an after-kickoff group waits, from the UI.
 *
 * `grace_minutes` had no control, so the only way to change it was editing the
 * rules file -- and the name-pattern route then wrote it back as 5 on the next
 * click of any chip on that row. These pin both halves: the value is accepted
 * and validated, and a save that is about something else leaves it alone.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AFTER_EPG_START, parseGroupPatterns, parsePolicies } from './eligibility';

// The pattern route answers with the groups a pattern would hit, which needs a
// Dispatcharr snapshot. Nothing here is about that answer, so only it is faked.
vi.mock('@/lib/server/state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/state')>();
  return {
    ...actual,
    snapshot: async () => ({ groups: [], channels: [], streams: [], providers: [] }),
    userGroups: () => [],
  };
});

let dir = '';
let rulesPath = '';

interface Doc {
  groups: Record<string, Record<string, unknown>>;
  group_patterns?: Array<Record<string, unknown>>;
}

const doc = () => JSON.parse(readFileSync(rulesPath, 'utf8')) as Doc;
const write = (value: unknown) => writeFileSync(rulesPath, JSON.stringify(value), 'utf8');

const request = (body: unknown) =>
  new Request('http://local/api', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'podium-grace-routes-'));
  rulesPath = join(dir, 'rules.json');
  process.env.PODIUM_DATA_DIR = dir;
  process.env.PODIUM_RULES = rulesPath;
});

beforeEach(() => {
  write({ schema: 2, channels: [], groups: {}, group_patterns: [] });
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.PODIUM_DATA_DIR;
  delete process.env.PODIUM_RULES;
});

describe('PUT /api/groups/[groupId] with graceMinutes', () => {
  const put = async (body: unknown) => {
    const { PUT } = await import('../app/api/groups/[groupId]/route');
    return PUT(request(body), { params: Promise.resolve({ groupId: '42' }) });
  };

  it('saves the wait, and the gate reads it back', async () => {
    const response = await put({ mode: AFTER_EPG_START, graceMinutes: 2 });
    expect(response.status).toBe(200);
    expect(doc().groups['42']!.grace_minutes).toBe(2);
    expect(parsePolicies(doc().groups).get(42)?.graceMinutes).toBe(2);
  });

  it('accepts 0, for a provider that is up on the minute', async () => {
    await put({ mode: AFTER_EPG_START, graceMinutes: 0 });
    expect(parsePolicies(doc().groups).get(42)?.graceMinutes).toBe(0);
  });

  it('refuses a wait the gate cannot use, and writes nothing', async () => {
    // 181 would outlast the default window, so the group would never open.
    for (const graceMinutes of [-1, 2.5, 181, '5', null]) {
      const response = await put({ mode: AFTER_EPG_START, graceMinutes });
      expect(response.status).toBe(400);
    }
    expect(doc().groups['42']).toBeUndefined();
  });
});

describe('PUT /api/group-patterns with graceMinutes', () => {
  const put = async (body: unknown) => {
    const { PUT } = await import('../app/api/group-patterns/route');
    return PUT(request(body));
  };

  it('saves the wait on a pattern', async () => {
    const response = await put({ pattern: 'NFL *', mode: AFTER_EPG_START, graceMinutes: 4 });
    expect(response.status).toBe(200);
    expect(parseGroupPatterns(doc().group_patterns)[0]?.graceMinutes).toBe(4);
  });

  it('keeps a wait and window when another control on the row saves', async () => {
    // The bug this route had: every save wrote 5 and 180, so flipping
    // measure-only quietly undid a hand-tuned wait.
    write({
      schema: 2,
      channels: [],
      groups: {},
      group_patterns: [
        { pattern: 'NFL *', mode: AFTER_EPG_START, grace_minutes: 2, window_minutes: 90 },
      ],
    });
    await put({ pattern: 'NFL *', mode: AFTER_EPG_START, measureOnly: true });

    const row = doc().group_patterns![0]!;
    expect(row.grace_minutes).toBe(2);
    expect(row.window_minutes).toBe(90);
    expect(row.measure_only).toBe(true);
  });

  it('refuses a wait the gate cannot use', async () => {
    const response = await put({ pattern: 'NFL *', mode: AFTER_EPG_START, graceMinutes: 999 });
    expect(response.status).toBe(400);
    expect(doc().group_patterns).toEqual([]);
  });
});
