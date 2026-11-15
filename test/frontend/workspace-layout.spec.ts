import { expect, test } from '@playwright/test';

test('work orders and both sender views fit a narrow workspace', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  const accessKey = '00000000-0000-4000-8000-000000000042';
  const tenantReply = `Your repair summary: https://example.invalid/reports/${'a'.repeat(140)}`;
  const managerReply = 'The visit is confirmed for Tuesday.';
  await page.route('**/api/demo', (route) => route.fulfill({ json: {
    orders: [{ id: '42', access_key: accessKey, status: 'scheduled' }],
    messages: [
      { target: 'tenant@demo.invalid', body: tenantReply, created_at: '2026-11-15T14:00:00Z' },
      { target: 'manager@demo.invalid', body: managerReply, created_at: '2026-11-15T14:10:00Z' },
    ],
  } }));
  await page.goto('/app');

  const conversation = page.getByRole('log');
  const reply = conversation.getByText(tenantReply, { exact: true });
  await expect(reply).toBeVisible();
  await expect.poll(() => reply.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  const attachment = page.getByLabel('Attach a photo');
  await expect(attachment).toBeVisible();
  await expect(page.getByRole('link', { name: /L-42 · Ceiling leak/ })).toHaveAttribute('href', `/work-orders/${accessKey}`);

  await attachment.setInputFiles({ name: 'tenant-photo.png', mimeType: 'image/png', buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVx8AAAAASUVORK5CYII=',
    'base64',
  ) });
  const send = page.getByRole('button', { name: 'Send', exact: true });
  await expect(attachment).toHaveValue(/tenant-photo\.png$/);
  await expect(send).toBeEnabled();
  await page.getByRole('button', { name: 'Manager', exact: true }).click();
  await expect(attachment).toHaveValue('');
  await expect(send).toBeDisabled();
  await expect(conversation).toContainText(managerReply);
  await expect(conversation).not.toContainText(tenantReply);
  await page.getByRole('button', { name: 'Tuesday 2 to 4 PM', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Message' })).toHaveValue('Tuesday 2 to 4 PM');
  await expect(send).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
});
