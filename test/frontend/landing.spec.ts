import { expect, test } from '@playwright/test';

test('the landing page introduces Signoff and leads to the repair workspace', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.ok()).toBe(true);
  await expect(page.getByRole('heading', {
    level: 1, name: 'The repair isn’t done until the tenant says so.',
  })).toBeVisible();

  await expect(page.getByRole('link', { name: /how it works/i })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Explore the repair' })).toHaveAttribute('href', '/repair-example');
  await expect(page.getByRole('heading', { name: 'From photo to signoff.' })).toBeVisible();

  await page.getByRole('banner').getByRole('link', { name: 'Tenant signoff', exact: true }).click();
  await expect(page).toHaveURL(/#verification$/);
  await expect(page.locator('#verification')).toBeInViewport();
  const proof = page.getByRole('region', { name: 'Tenants get the final say.' });
  await expect(proof.getByRole('img')).toHaveCount(3);
  for (const name of [/water damage on the kitchen ceiling/i, /leaking PVC drain trap/i, /crack in the glass/i]) {
    const image = proof.getByRole('img', { name });
    await image.scrollIntoViewIfNeeded();
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
  }

  await expect(proof.getByRole('link', { name: 'Lance Cheung / USDA' })).toHaveAttribute('href', /flickr\.com\/photos\/usdagov/);
  await expect(proof.getByRole('link', { name: 'Tony Webster' })).toHaveAttribute('href', /commons\.wikimedia\.org/);
  await expect(proof.getByRole('link', { name: 'Santeri Viinamäki' })).toHaveAttribute('href', /commons\.wikimedia\.org/);
  await expect(page.getByText('Text a photo. Get updates. Confirm the fix.')).toHaveCount(0);
  await expect(page.getByText('Product screens captured in Signoff with sample data.')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Book a call' })).toHaveCount(0);
  const closing = page.getByRole('region', { name: 'Keep every repair on record.' });
  await expect(closing.getByRole('link', { name: 'Open Signoff' })).toHaveAttribute('href', '/app');

  await page.getByRole('link', { name: 'Get started', exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('heading', { name: 'From report to repair.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tenant', exact: true })).toBeVisible();
});

test('the standalone example renders the production report layout without loading a live work order', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.route('https://www.arcgis.com/apps/Embed/**', (route) => route.fulfill({ body: '' }));
  const privateRequests: string[] = [];
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (/^\/(?:app|api|reports|internal|work-orders)(?:\/|$)/.test(path)) privateRequests.push(path);
  });
  await page.goto('/');
  const example = page.getByRole('link', { name: 'Explore the repair', exact: true });
  await expect(example).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await example.click();
  await expect(page).toHaveURL(/\/repair-example$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Ceiling leak' })).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://signoffon.us/repair-example');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);

  const report = page.getByRole('main');
  await expect(report.getByRole('heading', { name: 'Contain a small drip safely' })).toBeVisible();
  await expect(report.getByText('Blender rendered', { exact: true })).toBeVisible();
  const model = report.getByRole('img', { name: /3D model: Bucket below a drip/ });
  await expect(model).toHaveAttribute('src', '/repair-example-model.webp');
  await expect.poll(() => model.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
  await expect(report.locator('.chart-line')).toHaveCount(2);
  await expect(report.locator('iframe[title="Neighborhood satellite map"]')).toHaveAttribute('src', /center=-95\.370%2C29\.760/);
  await expect(page.getByRole('tab')).toHaveCount(0);
  expect(privateRequests).toEqual([]);

  const alternate = await page.goto('/repair-ecxample');
  expect(alternate?.ok()).toBe(true);
  await expect(page.getByRole('heading', { level: 1, name: 'Ceiling leak' })).toBeVisible();
  await page.getByRole('link', { name: 'Back to Signoff' }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('the phone previews a Signoff mention and repeats the conversation automatically', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.clock.install();
  await page.goto('/');

  const phone = page.getByRole('figure', { name: 'Example repair conversation' });
  const pause = phone.getByRole('button', { name: 'Pause conversation' });
  const resume = phone.getByRole('button', { name: 'Resume conversation' });
  const report = phone.getByText('@signoff Water stain above the living room window.', { exact: true });
  const scheduling = phone.getByText(/I’ve sent the photo to your manager/);
  const repair = phone.getByText(/Your manager marked it fixed/);
  const confirmation = phone.getByText(/Resolved\. It’s dry now\./);
  const signoff = phone.getByText(/Signed off by tenant/);

  await phone.scrollIntoViewIfNeeded();
  await expect(pause).toBeVisible();
  await expect(report).toBeVisible();
  const hero = page.getByRole('region', { name: 'The repair isn’t done until the tenant says so.' });
  await expect(hero.getByRole('figure')).toHaveCount(1);
  await expect(phone.locator('figcaption')).toHaveCount(0);
  await expect(pause).toHaveText('');
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

  await page.clock.runFor(3000);
  await expect(report).toBeVisible();
  await expect(signoff).toBeHidden();
  await page.clock.runFor(1700);
  await expect(scheduling).toBeVisible();
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
