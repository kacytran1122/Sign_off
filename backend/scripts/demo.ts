import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

const photonTest = process.argv.includes('--photon');
const sponsorRehearsal = process.argv.includes('--sponsor');
const temporary = process.argv.includes('--ephemeral');
if (temporary && photonTest) throw new Error('An ephemeral database is only available for the local demo.');
const path = temporary ? await mkdtemp(join(tmpdir(), 'signoff-demo-')) : resolve(sponsorRehearsal ? '.fix-this-spot/photon-sponsor-db' : photonTest ? '.fix-this-spot/photon-test-db' : '.fix-this-spot/db');
const databasePort = Number(process.env.LOCAL_DATABASE_PORT ?? (sponsorRehearsal ? '55441' : photonTest ? '55440' : '55439'));
const appPort = process.env.PORT ?? (sponsorRehearsal ? '4312' : photonTest ? '4311' : '4310');
if (!temporary) await mkdir(resolve('.fix-this-spot'), { recursive: true });
const postgres = new EmbeddedPostgres({
  databaseDir: path, port: databasePort, user: 'postgres', password: 'local-demo',
  persistent: true, autoRehydrateSymlinks: true, onLog: () => {}, onError: (e) => console.error(e),
});
if (!await stat(resolve(path, 'PG_VERSION')).catch(() => undefined)) await postgres.initialise();
await postgres.start();
const child = spawn(process.execPath, ['build/backend/index.js'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    DEMO_MODE: String(!photonTest),
    PHOTON_TEST_MODE: String(photonTest),
    PHOTON_SPONSOR_REHEARSAL: String(sponsorRehearsal),
    PORT: appPort,
    PUBLIC_BASE_URL: (!sponsorRehearsal && photonTest ? process.env.PUBLIC_BASE_URL : undefined) || `http://localhost:${appPort}`,
    DATABASE_URL: `postgres://postgres:local-demo@127.0.0.1:${databasePort}/postgres`,
  },
});
process.once('SIGINT', () => child.kill('SIGTERM'));
process.once('SIGTERM', () => child.kill('SIGTERM'));
try {
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => { process.exitCode = code ?? 1; resolve(); });
  });
} finally {
  await postgres.stop();
  if (temporary) await rm(path, { recursive: true, force: true });
}
