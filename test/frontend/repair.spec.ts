import { test, expect } from '@playwright/test';

const photo = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVx8AAAAASUVORK5CYII=',
  'base64',
);

test('a tenant photo opens a work order that can be scheduled and reopened', async ({ page }) => {
  await page.goto('/app');
  await expect(page).toHaveTitle('Repair workspace | Signoff');
  await expect(page.getByRole('heading', { name: 'From report to repair.' })).toBeVisible();
  const send = page.getByRole('button', { name: 'Send', exact: true });
  await expect(send).toBeDisabled();

  const message = page.getByRole('textbox', { name: 'Message' });
  await message.fill('Water dripping by the conference room window');
  await page.getByLabel('Attach a photo').setInputFiles({ name: 'leak.png', mimeType: 'image/png', buffer: photo });
  await send.click();

  const order = page.getByRole('link', { name: /L-\d+ · Ceiling leak/ });
  await expect(order).toBeVisible();
  const orderPath = await order.getAttribute('href');
  await order.click();
  await expect(page.getByRole('heading', { name: 'Ceiling leak' })).toBeVisible();
  const submittedPhoto = page.getByRole('img', { name: 'Photo submitted with the tenant’s report' });
  await expect(submittedPhoto).toBeVisible();
  await expect.poll(() => submittedPhoto.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);

  await page.goto('/app');
  await page.getByRole('button', { name: 'Manager', exact: true }).click();
  await message.fill('Tomorrow 2 to 4 PM');
  await send.click();
  const thread = page.getByRole('log');
  await expect(thread).toContainText('Reply YES');
  await message.fill('YES');
  await send.click();
  await expect(thread).toContainText('I texted the affected tenants.');
  await page.goto(orderPath!);
  await expect(page.getByText('Scheduled', { exact: true })).toBeVisible();

  await page.goto('/app');
  await page.getByRole('button', { name: 'Manager', exact: true }).click();
  await message.fill('FIXED');
  await send.click();
  await expect(thread).toContainText('I asked the affected tenants to verify');
  await page.getByRole('button', { name: 'Tenant', exact: true }).click();
  await expect(thread).toContainText('Your manager marked');
  await message.fill('Still leaking');
  await send.click();
  await expect(thread).toContainText('is open again');
  await page.goto(orderPath!);
  await expect(page.getByText('Open', { exact: true })).toBeVisible();
  await expect(page.getByText('Work order reopened', { exact: true })).toBeVisible();
});

test('tenant report links open directly and display the 3D guide', async ({ page }) => {
  const key = '00000000-0000-4000-8000-000000000001';
  await page.route(`**/api/reports/${key}`, async (route) => {
    await route.fulfill({ json: {
      id: '7', status: 'open', issue: 'leak', guidance: 'Set a bucket below the drip.',
      effects: 'Water can damage nearby finishes.', renderStatus: 'ready',
    } });
  });
  await page.route(`**/api/reports/${key}/render`, async (route) => {
    await route.fulfill({ contentType: 'image/png', body: photo });
  });
  const reportPage = await page.goto(`/reports/${key}`);
  expect(await reportPage?.headerValue('referrer-policy')).toBe('no-referrer');
  await expect(page).toHaveTitle('Repair report | Signoff');
  await expect(page.getByRole('heading', { name: 'Water leak' })).toBeVisible();
  await expect(page.getByText('Set a bucket below the drip.')).toBeVisible();
  await expect(page.getByRole('img', { name: '3D guide showing temporary protection and what maintenance should repair' })).toBeVisible();
});
