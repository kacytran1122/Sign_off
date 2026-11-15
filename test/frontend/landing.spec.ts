import { expect, test } from '@playwright/test';

test('the landing page introduces Signoff and leads to the repair workspace', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.ok()).toBe(true);
  await expect(page.getByRole('heading', {
    level: 1, name: 'The repair isn’t done until the tenant says so.',
  })).toBeVisible();

  await page.getByRole('link', { name: 'See how it works', exact: true }).click();
  await expect(page).toHaveURL(/#how$/);
  await expect(page.getByRole('heading', { name: 'From your first text to a confirmed fix.' })).toBeVisible();

  const showcase = page.getByRole('region', { name: 'See the repair in Signoff.' });
  const screenshots = showcase.getByRole('img');
  await expect(screenshots).toHaveCount(2);
  for (const image of await screenshots.all()) {
    await image.scrollIntoViewIfNeeded();
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
  }

  await page.getByRole('banner').getByRole('link', { name: 'Who it’s for', exact: true }).click();
  await expect(page).toHaveURL(/#who$/);
  await expect(page.locator('#who')).toBeInViewport();

  const closing = page.getByRole('region', { name: 'See a repair through.' });
  await expect(closing.getByRole('link', { name: 'Try the demo' })).toHaveAttribute('href', '/app');

  await page.getByRole('link', { name: 'Get started', exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('heading', { name: 'From report to repair.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tenant', exact: true })).toBeVisible();
});

test('the landing page offers the demo without horizontal overflow on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('/');
  const demo = page.getByRole('link', { name: 'Try the demo', exact: true }).first();
  await expect(demo).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await expect(demo).toHaveAttribute('href', '/app');
  await demo.click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('heading', { name: 'From report to repair.' })).toBeVisible();
});

test('the phone preview reveals messages in order and replays the conversation', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.clock.install();
  await page.goto('/');

  const phone = page.getByRole('figure', { name: 'Example repair conversation' });
  const pause = phone.getByRole('button', { name: 'Pause conversation' });
  const resume = phone.getByRole('button', { name: 'Resume conversation' });
  const replay = phone.getByRole('button', { name: 'Replay conversation' });
  const report = phone.getByText('Water stain above the living room window.', { exact: true });
  const scheduling = phone.getByText(/I’ve sent the photo to your manager/);
  const repair = phone.getByText(/Your manager marked it fixed/);
  const confirmation = phone.getByText(/Resolved\. It’s dry now\./);
  const signoff = phone.getByText(/Signed off by tenant/);

  await phone.scrollIntoViewIfNeeded();
  await expect(pause).toBeVisible();
  await expect(report).toBeVisible();
  await expect(signoff).toBeHidden();

  await page.clock.runFor(1900);
  await expect(scheduling).toBeVisible();
  await expect(repair).toBeHidden();
  await pause.click();
  await page.clock.runFor(10_000);
  await expect(repair).toBeHidden();
  await resume.click();

  await page.clock.runFor(2700);
  await expect(repair).toBeVisible();
  await page.clock.runFor(2400);
  await expect(confirmation).toBeVisible();
  await page.clock.runFor(1600);
  await expect(signoff).toBeVisible();

  await replay.click();
  await expect(report).toBeVisible();
  await expect(signoff).toBeHidden();
});

test('the phone preview displays the whole conversation with reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');

  const phone = page.getByRole('figure', { name: 'Example repair conversation' });
  await expect(phone.getByText(/Water stain above the living room window/)).toBeVisible();
  await expect(phone.getByText(/Signed off by tenant/)).toBeVisible();
  await expect(phone.getByRole('button')).toHaveCount(0);
});

test('Signoff uses one wordmark across the landing page, workspace, and shared views', async ({ page }) => {
  await page.goto('/');
  const home = page.getByRole('banner').getByRole('link', { name: 'Signoff home', exact: true });
  const wordmark = home.getByText('Signoff', { exact: true });
  await expect(wordmark).toBeVisible();
  await expect(home.locator('svg')).toHaveCount(0);

  const icon = page.locator('link[rel="icon"]');
  await expect(icon).toHaveAttribute('href', /^\/icon\.svg(?:\?|$)/);
  const iconResponse = await page.request.get(await icon.evaluate((link: HTMLLinkElement) => link.href));
  expect(iconResponse.ok()).toBe(true);
  expect(iconResponse.headers()['content-type']).toContain('image/svg+xml');

  for (const route of ['/app', '/reports/invalid-key', '/work-orders/invalid-key']) {
    await page.goto(route);
    await expect(home).toHaveAttribute('href', '/');
    await expect(wordmark).toBeVisible();
    await expect(home.locator('svg')).toHaveCount(0);
  }

  await home.click();
  await expect(page).toHaveURL(/\/$/);
});
