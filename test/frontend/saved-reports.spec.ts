import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

const workspace = '/saved-reports';
const api = '/api/saved-reports';

async function signIn(page: Page, password: string) {
  await page.getByLabel('Username').fill('signoff');
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

test('a saved tenant report survives sign-out and shows the landlord’s update on another device', async ({ page, browser, baseURL }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const title = `Ceiling stain ${randomUUID()}`;
  const description = 'A stain appeared above the living room window after the rain.';

  await page.goto(workspace);
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  expect((await page.request.get(api)).status()).toBe(401);
  const headers = { Origin: new URL(page.url()).origin };
  await signIn(page, 'invalid password');
  await expect(page.getByRole('alert')).toBeVisible();
  expect((await page.request.get(api)).status()).toBe(401);
  await signIn(page, 'signoff');
  await expect(page.getByText('Tenant account', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Saved reports' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);

  await page.getByLabel('Report title').fill(title);
  await page.getByLabel('Description').fill(description);
  const savedResponse = page.waitForResponse(response =>
    new URL(response.url()).pathname === api && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Save report' }).click();
  const saved = await savedResponse;
  expect(saved.ok()).toBe(true);
  const { report } = await saved.json();
  const reportPath = `${api}/${report.id}`;

  await page.getByText(title, { exact: true }).click();
  await expect(page.getByText(description, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Update status' })).toHaveCount(0);
  expect((await page.request.patch(reportPath, { headers, data: { status: 'fixed' } })).status()).toBe(403);

  await page.reload();
  await expect(page.getByText('Tenant account', { exact: true })).toBeVisible();
  await expect(page.getByText(title, { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByText(title, { exact: true })).toHaveCount(0);
  expect((await page.request.get(api)).status()).toBe(401);

  await signIn(page, 'landyord');
  await expect(page.getByText('Landlord account', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save report' })).toHaveCount(0);
  expect((await page.request.post(api, { headers, data: { title, description } })).status()).toBe(403);
  await page.getByText(title, { exact: true }).click();
  await expect(page.getByText(description, { exact: true })).toBeVisible();
  await page.getByLabel('Report status').selectOption('scheduled');
  const updatedResponse = page.waitForResponse(response =>
    new URL(response.url()).pathname === reportPath && response.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: 'Update status' }).click();
  const updated = await updatedResponse;
  expect(updated.ok()).toBe(true);
  expect((await updated.json()).report.status).toBe('scheduled');

  const tenantContext = await browser.newContext({ baseURL });
  try {
    const tenantPage = await tenantContext.newPage();
    await tenantPage.goto(workspace);
    await expect(tenantPage.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await signIn(tenantPage, 'signoff');
    const reportSummary = tenantPage.locator('summary').filter({ hasText: title });
    await expect(reportSummary).toContainText('Scheduled');
    await reportSummary.click();
    await expect(tenantPage.getByText(description, { exact: true })).toBeVisible();
  } finally {
    await tenantContext.close();
  }
});

for (const account of [
  { role: 'Tenant account', password: 'signoff', tag: '@signoff ' },
  { role: 'Landlord account', password: 'landyord', tag: '' },
]) {
  test(`${account.role} can link texting and open verified reports`, async ({ page }) => {
    const code = '3E118209777AF573B5E11BFBB6167A02';
    const reportPath = '/reports/ab123456-7890-4321-8000-123456789012';
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    let stage: 'unlinked' | 'pending' | 'linked' = 'unlinked';
    await page.route(`**${api}/photon`, route => {
      if (route.request().method() === 'POST') stage = 'pending';
      return route.fulfill({ json: stage === 'pending'
        ? { state: stage, code, expiresAt, reports: [] }
        : { state: stage, reports: stage === 'linked'
          ? [{ id: '16', title: 'Ceiling leak', status: 'scheduled', createdAt: '2026-11-15T12:00:00Z', url: reportPath }]
          : [] } });
    });

    await page.goto(workspace);
    await signIn(page, account.password);
    await expect(page.getByText(account.role, { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Reports from texting' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open repair report' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Link messaging account' }).click();
    await expect(page.getByLabel('Verification message')).toHaveValue(`${account.tag}LINK ${code}`);
    stage = 'linked';
    const report = page.getByRole('link', { name: 'Open repair report' });
    await expect(report).toHaveAttribute('href', new URL(reportPath, page.url()).href, { timeout: 15_000 });
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(report).toHaveCount(0);
  });
}
