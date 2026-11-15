import { expect, test } from '@playwright/test';

test('the landing page introduces Signoff and leads to the repair workspace', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.ok()).toBe(true);
  await expect(page.getByRole('heading', {
    level: 1, name: 'The repair isn’t done until the tenant says so.',
  })).toBeVisible();

  await page.getByRole('link', { name: 'See how it works', exact: true }).click();
  await expect(page).toHaveURL(/#how$/);
  await expect(page.getByRole('heading', { name: 'From photo to signoff.' })).toBeVisible();

  const showcase = page.getByRole('region', { name: 'From photo to signoff.' });
  const report = showcase.getByRole('tab', { name: 'Tenant report' });
  await report.click();
  await expect(report).toHaveAttribute('aria-selected', 'true');
  const photo = showcase.getByRole('tabpanel', { name: 'Tenant report' }).getByRole('img');
  await expect.poll(() => photo.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
  const review = showcase.getByRole('tab', { name: 'Manager review' });
  await review.click();
  const order = showcase.getByRole('tabpanel', { name: 'Manager review' });
  const reviewCapture = order.getByRole('img', { name: /Signoff repair report/ });
  await expect.poll(() => reviewCapture.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
  const fullCapture = order.getByRole('link', { name: 'Enlarge report capture' });
  const captureHref = await fullCapture.getAttribute('href');
  expect(captureHref).toBeTruthy();
  expect((await page.request.get(captureHref!)).ok()).toBe(true);
  await review.press('ArrowRight');
  const verification = showcase.getByRole('tab', { name: 'Tenant confirmation' });
  await expect(verification).toHaveAttribute('aria-selected', 'true');
  await expect(verification).toBeFocused();
  const timeline = showcase.getByRole('tabpanel', { name: 'Tenant confirmation' }).getByRole('img');
  await expect.poll(() => timeline.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);

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

test('the landing page opens the repair workspace without horizontal overflow on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('/');
  const demo = page.getByRole('link', { name: 'Open Signoff', exact: true }).first();
  await expect(demo).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await expect(demo).toHaveAttribute('href', '/app');
  await demo.click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('heading', { name: 'From report to repair.' })).toBeVisible();
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
