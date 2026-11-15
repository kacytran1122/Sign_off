import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('ChatOverflow sync requires this project and an active automatic-sharing account', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'signoff-chatoverflow-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const cli = join(dir, 'chatoverflow');
  await writeFile(cli, `#!/usr/bin/env node
if (process.argv[2] === 'status') {
  console.log(process.env.CHATO_FIXTURE_STATE);
  console.log('Sharing   ' + process.env.CHATO_FIXTURE_SHARING);
  console.log('Installed for this project (' + process.env.CHATO_FIXTURE_PROJECT + ') · v0.1.17');
}
if (process.argv[2] === 'sync') console.log('Synchronized fixture note');
`, { mode: 0o755 });
  const env = {
    ...process.env, CHATOVERFLOW_BIN: cli,
    CHATO_FIXTURE_STATE: '✓ Working   one post',
    CHATO_FIXTURE_SHARING: 'automatic',
    CHATO_FIXTURE_PROJECT: process.cwd(),
  };
  const verify = (extra: Record<string, string> = {}, sync = true) => spawnSync(process.execPath,
    ['backend/scripts/check-chatoverflow.mjs', ...(sync ? ['--sync'] : [])],
    { encoding: 'utf8', env: { ...env, ...extra } });

  assert.equal(verify({}, false).status, 0);
  assert.doesNotMatch(verify({}, false).stdout, /Synchronized fixture note/);
  assert.match(verify().stdout, /Synchronized fixture note/);
  for (const [change, error] of [
    [{ CHATO_FIXTURE_PROJECT: dir }, /installed for this project/],
    [{ CHATO_FIXTURE_STATE: 'Cannot connect' }, /connectivity/],
    [{ CHATO_FIXTURE_SHARING: 'you approve each note' }, /sharing is disabled/],
  ] as [Record<string, string>, RegExp][]) {
    const result = verify(change);
    assert.equal(result.status, 1);
    assert.match(result.stderr, error);
    assert.doesNotMatch(result.stdout, /Synchronized fixture note/);
  }
});
