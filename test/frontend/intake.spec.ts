import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/demo', (route) => route.fulfill({ json: { orders: [], messages: [] } }));
});

test('the composer rejects an oversized photo before submitting', async ({ page }) => {
  let posts = 0;
  await page.route('**/api/demo', (route) => {
    if (route.request().method() === 'POST') {
      posts++;
      return route.fulfill({ status: 202 });
    }
    return route.fallback();
  });
  await page.goto('/app');
  const attach = page.getByLabel('Attach a photo');
  await attach.setInputFiles({ name: 'large.png', mimeType: 'image/png', buffer: Buffer.alloc(4 * 1024 * 1024 + 1) });

  await expect(page.getByRole('status')).toHaveText('Choose a photo under 4 MB.');
  await expect(attach).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  expect(posts).toBe(0);
});

test('a failed submission preserves the message and allows a retry', async ({ page }) => {
  const submissions: { role: string; text: string }[] = [];
  await page.route('**/api/demo', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    submissions.push(route.request().postDataJSON());
    return route.fulfill({ status: submissions.length === 1 ? 503 : 202 });
  });
  await page.goto('/app');
  const message = page.getByRole('textbox', { name: 'Message' });
  const send = page.getByRole('button', { name: 'Send', exact: true });
  const body = 'The reception window is dripping';
  await message.fill(body);
  await send.click();

  await expect(page.getByRole('status')).toContainText('Message could not be accepted.');
  await expect(message).toHaveValue(body);
  await expect(page.getByRole('log')).not.toContainText(body);
  await send.click();

  await expect(page.getByRole('log')).toContainText(body);
  await expect(message).toHaveValue('');
  await expect(send).toBeDisabled();
  expect(submissions).toHaveLength(2);
  expect(submissions).toMatchObject([{ role: 'tenant', text: body }, { role: 'tenant', text: body }]);
});

test('changing roles clears the text draft and sends under the selected identity', async ({ page }) => {
  await page.route('**/api/demo', (route) =>
    route.request().method() === 'POST' ? route.fulfill({ status: 202 }) : route.fallback(),
  );
  await page.goto('/app');
  const message = page.getByRole('textbox', { name: 'Message' });
  await message.fill('Unsent tenant draft');
  const manager = page.getByRole('button', { name: 'Manager', exact: true });
  await manager.click();
  await expect(manager).toHaveAttribute('aria-pressed', 'true');
  await expect(message).toHaveValue('');
  await page.getByRole('button', { name: 'Tuesday 2 to 4 PM', exact: true }).click();
  await expect(message).toHaveValue('Tuesday 2 to 4 PM');
  const request = page.waitForRequest((candidate) =>
    candidate.method() === 'POST' && new URL(candidate.url()).pathname === '/api/demo',
  );
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  expect((await request).postDataJSON()).toMatchObject({ role: 'manager', text: 'Tuesday 2 to 4 PM' });
  await expect(page.getByRole('log')).toContainText('Tuesday 2 to 4 PM');
  await page.getByRole('button', { name: 'Tenant', exact: true }).click();
  await expect(page.getByRole('log')).not.toContainText('Tuesday 2 to 4 PM');
});
