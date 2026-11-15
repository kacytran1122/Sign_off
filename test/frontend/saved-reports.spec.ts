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
