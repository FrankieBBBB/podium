/**
 * Write routes given a body that is not JSON.
 *
 * Three of them parsed outside any try, so a truncated or empty body threw out
 * of the handler and Next answered with its own bare 500 -- a server error for
 * what was the client's mistake. They answer 400 now, and write nothing.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let dir = '';
let rulesPath = '';
const RULES = JSON.stringify({ schema: 2, channels: [] });

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'podium-malformed-json-'));
  rulesPath = join(dir, 'rules.json');
  writeFileSync(rulesPath, RULES, 'utf8');
  process.env.PODIUM_DATA_DIR = dir;
  process.env.PODIUM_RULES = rulesPath;
});

afterAll(() => {
  delete process.env.PODIUM_DATA_DIR;
  delete process.env.PODIUM_RULES;
  rmSync(dir, { recursive: true, force: true });
});

const put = (body: string) =>
  new Request('http://podium/api/x', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

describe('a body that is not JSON', () => {
  it('is a 400 from the channel rule route, and changes nothing', async () => {
    const { PUT } = await import('../app/api/rules/[channelId]/route');
    for (const body of ['{"aliases": [', '']) {
      const response = await PUT(put(body), { params: Promise.resolve({ channelId: '5' }) });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'body is not JSON' });
    }
    expect(readFileSync(rulesPath, 'utf8')).toBe(RULES);
  });

  it('is a 400 from the group policy route, and changes nothing', async () => {
    const { PUT } = await import('../app/api/groups/[groupId]/route');
    const response = await PUT(put('{"mode": '), { params: Promise.resolve({ groupId: '7' }) });
    expect(response.status).toBe(400);
    expect(readFileSync(rulesPath, 'utf8')).toBe(RULES);
  });

  it('is a 400 from the group pattern route, and changes nothing', async () => {
    const { PUT } = await import('../app/api/group-patterns/route');
    const response = await PUT(put('not json'));
    expect(response.status).toBe(400);
    expect(readFileSync(rulesPath, 'utf8')).toBe(RULES);
  });
});
