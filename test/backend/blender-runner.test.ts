import { strict as assert } from 'node:assert';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVx8AAAAASUVORK5CYII=', 'base64');

test('Blender routes each aid to its own scene and returns only the PNG', async (t) => {
  const temp = await mkdtemp(join(tmpdir(), 'signoff-renderer-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const renderer = resolve('backend/blender/render.sh');
  const fixturePng = join(temp, 'fixture.png');
  await writeFile(fixturePng, png);
  await writeFile(join(temp, 'blender-headless'), `#!/bin/sh
set -eu
printf '%s\n' "$@"
for argument in "$@"; do
  case "$argument" in
    *.png) cp "$SIGNOFF_FIXTURE_PNG" "$argument" ;;
  esac
done
`, { mode: 0o755 });
  const run = (args: string[]) => exec('/bin/sh', [renderer, ...args], {
    cwd: temp,
    env: { PATH: `${temp}:${process.env.PATH}`, SIGNOFF_FIXTURE_PNG: fixturePng },
    encoding: 'buffer',
  });
  const cases = [
    { args: ['inspection', 'bucket'], expected: ['--python', 'render-leak.py', '--', 'output', 'bucket'] },
    { args: ['inspection', 'towel'], expected: ['--python', 'render-leak.py', '--', 'output', 'towel'] },
    { args: ['inspection', 'stair-sign'], expected: ['--python', 'render-stairs.py', '--', 'output'] },
    { args: ['warehouse', 'clear'], expected: ['scene.blend', '--python', 'script.py', '--', 'warehouse', 'output', 'clear'] },
    { args: ['lobby'], expected: ['scene.blend', '--python', 'script.py', '--', 'lobby', 'output', 'none'] },
  ];
  for (const { args, expected } of cases) {
    const { stdout, stderr } = await run(args);
    assert.deepEqual(stdout, png);
    assert.deepEqual(stderr.toString().trim().split('\n').map((arg) =>
      arg.endsWith('/inspection.png') ? 'output' : arg), expected);
  }
  await assert.rejects(run(['inspection', 'unknown']), { code: 2 });
});
