import { expect, test } from '@playwright/test';

test('the landing page introduces Signoff and leads to the repair workspace', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.ok()).toBe(true);
  await expect(page.getByRole('heading', {
    level: 1, name: 'The repair isn’t done until the tenant says so.',
  })).toBeVisible();

  await page.getByRole('link', { name: 'See how it works', exact: true }).click();
  await expect(page).toHaveURL(/#how$/);
  await expect(page.getByRole('heading', { name: 'Three steps. No phone tag.' })).toBeVisible();

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
});
