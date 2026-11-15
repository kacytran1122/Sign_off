import { strict as assert } from 'node:assert';
import { mock, test } from 'node:test';
import type { Pool } from 'pg';
import { loadConfig } from '../../backend/config.js';
import { managerWorkOrderLink, managerWorkspaceUrl } from '../../backend/reports.js';

const order = { id: '5', access_key: 'a230bace-2afa-4bbf-a34d-25cdfd72a871' };
const local = { demo: false, baseUrl: 'http://localhost:4312' };
const reportShareOrigin = 'https://report.example.test';
const reportsHost = { ...local, reportShareOrigin, reportPublish: { origin: reportShareOrigin, token: 'fixture' } };

function publication(rowCount: number) {
  const query = mock.fn(async (_sql: string, _args: string[]) => ({ rowCount }));
  return { db: { query: query as unknown as Pool['query'] }, query };
}

test('manager notices link to a published HTTPS report', async () => {
  const { db, query } = publication(1);
  assert.equal(await managerWorkOrderLink(db, reportsHost, order), `${reportShareOrigin}/reports/${order.access_key}`);
  assert.deepEqual(query.mock.calls[0].arguments[1], [order.id]);
  assert.match(query.mock.calls[0].arguments[0], /revision IS NOT NULL/);
});

test('manager notices omit unavailable reports and keep configured HTTPS workspaces', async () => {
  const { db } = publication(0);
  assert.equal(await managerWorkOrderLink(db, reportsHost, order), undefined);
  for (const baseUrl of ['https://localhost:4312', 'https://127.0.0.1:4312', 'https://[::1]:4312', 'http://workspace.example.test']) {
    assert.equal(managerWorkspaceUrl({ ...local, baseUrl }, order.access_key), undefined, baseUrl);
  }
  const baseUrl = 'https://workspace.example.test';
  assert.equal(await managerWorkOrderLink(db, { ...reportsHost, baseUrl }, order), `${baseUrl}/work-orders/${order.access_key}`);
  assert.equal(managerWorkspaceUrl({ ...local, demo: true }, order.access_key), `${local.baseUrl}/work-orders/${order.access_key}`);
});

test('outgoing report links use the configured domain independently of publishing', async () => {
  const env = {
    DEMO_MODE: 'true', DATABASE_URL: 'fixture-db', REPORT_PUBLISH_TOKEN: 'fixture-token-with-at-least-32-characters',
    REPORT_SHARE_ORIGIN: 'https://reports.example.test',
  };
  const config = await loadConfig({ ...env, REPORT_PUBLISH_ORIGIN: 'https://publisher.example.test/upload' });
  const { db } = publication(1);
  assert.equal(config.reportPublish?.origin, 'https://publisher.example.test');
  assert.equal(await managerWorkOrderLink(db, config, order), `https://reports.example.test/reports/${order.access_key}`);
  assert.equal((await loadConfig(env)).reportPublish?.origin, env.REPORT_SHARE_ORIGIN);
  await assert.rejects(loadConfig({ ...env, REPORT_PUBLISH_ORIGIN: 'http://publisher.example.test' }));
});
