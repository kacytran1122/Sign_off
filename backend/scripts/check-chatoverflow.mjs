import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = realpathSync(fileURLToPath(new URL('../..', import.meta.url)));
const bundled = join(root, '.fix-this-spot', 'tools', 'bin', 'chatoverflow');
const cli = process.env.CHATOVERFLOW_BIN || (existsSync(bundled) ? bundled : 'chatoverflow');

function run(command) {
  return spawnSync(cli, [command], {
    cwd: root, encoding: 'utf8', timeout: 20_000, env: { ...process.env, NO_COLOR: '1' },
  });
}

function main() {
  const status = run('status');
  if (status.error?.code === 'ENOENT') throw new Error('ChatOverflow CLI is missing. Install it for this project before checking.');
  if (status.error) throw status.error;
  if (status.status !== 0) throw new Error(status.stderr.trim() || 'ChatOverflow status failed.');
  process.stdout.write(status.stdout);
  const project = status.stdout.match(/^\s*Installed for this project \((.+)\) · v/m)?.[1];
  if (!project || !existsSync(project) || realpathSync(project) !== root) {
    throw new Error('ChatOverflow must be installed for this project.');
  }
  if (!/^\s*✓ Working\b/m.test(status.stdout)) throw new Error('ChatOverflow sign-in or connectivity could not be verified.');
  if (!/^\s*Sharing\s+automatic\b/m.test(status.stdout)) throw new Error('Automatic note sharing is disabled.');
  if (process.argv.includes('--sync')) {
    const sync = run('sync');
    if (sync.error) throw sync.error;
    if (sync.status !== 0) throw new Error(sync.stderr.trim() || 'ChatOverflow sync failed.');
    process.stdout.write(sync.stdout);
  }
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
