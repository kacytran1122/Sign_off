import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const access = '00000000-0000-4000-8000-000000000031';
const editKey = '00000000-0000-4000-8000-000000000032';
const workOrder = `/work-orders/${access}`;
const api = `/api${workOrder}`;
const photoUrl = `${api}/photos/21`;
const markerUrl = `${photoUrl}/damage-point`;
const photo = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVx8AAAAASUVORK5CYII=',
  'base64',
);
const anchor = { x: 2, y: 3, z: 4 };
const damagePoint = { anchor, stem: { x: 0, y: -.22, z: 0 }, sweep: 'review-uuid', confirmed: true };
const sdkEvents = (page: Page) => page.evaluate(() => (window as Window & { sdkEvents?: unknown[][] }).sdkEvents ?? []);

async function stubMatterport(page: Page, waitForViewer = false) {
  // Exercise the shipped SDK bootstrap through the same iframe boundary as a real model.
  await page.route('https://my.matterport.com/show/**', (route) => route.fulfill({
    contentType: 'text/html',
    body: `<script>
      addEventListener('message', (event) => {
        if (event.data?.type !== 'postmessage.connect' || event.source !== parent) return;
        parent.postMessage({
          type: 'postmessage.accept',
          payload: {
            sourceId: 'fixture-client',
            targetId: 'fixture-showcase',
            targetOrigin: location.origin,
            scriptUrl: event.origin + '/matterport-sdk-fixture.js',
            interface: {},
          },
        }, event.origin);
      });
    </script>`,
  }));
  await page.route('**/matterport-sdk-fixture.js', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: `
      const record = (...event) => (window.sdkEvents ??= []).push(event);
      let rays = 0;
      let tags = 0;
      export class SdkBuilder {
        build() {
          return {
            App: {
              Phase: { PLAYING: 'playing' },
              state: { waitUntil: async (predicate) => {
                record('app-waiting');
                if (${waitForViewer}) await new Promise((resolve) => window.addEventListener('fixture-player-ready', resolve, { once: true }));
                if (predicate({ phase: 'loading' }) || !predicate({ phase: 'playing' })) throw new Error('Invalid readiness condition');
                return { phase: 'playing' };
              } },
            },
            Camera: {
              pose: { subscribe: (callback) => {
                callback({ position: { x: 2, y: 2, z: 4 }, sweep: 'review-uuid' });
                return { cancel() {} };
              } },
              lookAt: async (point) => record('lookAt', point),
            },
            Model: { getData: async () => ({ sweeps: [{ sid: 'review-sid', uuid: 'review-uuid' }] }) },
            Sweep: { moveTo: async (id) => record('sweep', id) },
            Renderer: { getWorldPositionData: async (screen) => {
              record('ray', screen);
              if (++rays === 1) return { position: null, floor: -1 };
              return { position: {x: 2, y: 3, z: 4}, floor: 0 };
            } },
            Tag: {
              add: async (descriptors) => {
                record('tags', descriptors);
                return descriptors.map(() => String(++tags));
              },
              remove: async (...ids) => record('remove', ids),
            },
          };
        }
      }
    `,
  }));
}

async function stubWorkOrder(page: Page, alreadyConfirmed = false) {
  let saved = alreadyConfirmed ? damagePoint : undefined;
  const requests: { authorization: string | null; payload: unknown }[] = [];
  await page.route(`**${api}`, (route) => route.fulfill({ json: {
    id: '31', demo: false, status: 'open', zoneId: 'room', matterportKey: 'fixture',
    repair: { issue: 'damage', address: '123 Fixture Street', guidance: 'Keep clear.', effects: 'Inspect damage.', aid: 'clear' },
    property: {
      name: 'Fixture building', address: '123 Fixture Street', timeZone: 'America/Chicago',
      matterportModel: 'fixtureModel', roof: { attributes: [] }, zones: [],
      landmarks: [{
        id: 'room', suite: '1', label: 'Living room', anchor: { x: 0, y: 0, z: 0 },
        stem: { x: 0, y: .2, z: 0 }, views: [{ sweep: 'room-sweep', rotation: { x: 0, y: 0 } }],
      }],
    },
    reports: [{ id: '21', landmark_id: 'room', has_photo: true, description: 'Damage above the door.', damagePoint: saved }],
    timeline: [],
  } }));
  await page.route(`**${photoUrl}`, (route) => route.fulfill({ contentType: 'image/png', body: photo }));
  await page.route(`**${markerUrl}`, async (route) => {
    const request = route.request();
    expect(request.method()).toBe('PUT');
    requests.push({ authorization: await request.headerValue('authorization'), payload: request.postDataJSON() });
    saved = damagePoint;
    return route.fulfill({ json: { damagePoint: saved } });
  });
  return requests;
}

test('the manager reviews the tenant photo and confirms only a model surface', async ({ page }) => {
  await stubMatterport(page, true);
  const requests = await stubWorkOrder(page);
  const workOrderPage = await page.goto(`${workOrder}#inspect=${editKey}`);
  expect(await workOrderPage?.headerValue('referrer-policy')).toBe('no-referrer');
  await expect(page.getByText('Room location. Damage spot awaiting photo review.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Suggested inspection area' })).toHaveCount(0);
  const matchPhoto = page.getByRole('button', { name: 'Match photo to model' });
  await expect(matchPhoto).toBeDisabled();
  await expect.poll(() => sdkEvents(page)).toContainEqual(['app-waiting']);
  expect((await sdkEvents(page)).some(([kind]) => kind === 'tags')).toBe(false);
  await page.evaluate(() => window.dispatchEvent(new Event('fixture-player-ready')));
  await matchPhoto.click();
  await expect(page.getByRole('img', { name: 'Tenant photo for matching the damage spot' })).toHaveAttribute('src', photoUrl);

  const picker = page.getByRole('button', { name: 'Select a surface on the Matterport model' });
  await picker.click({ position: { x: 25, y: 45 } });
  await expect(page.getByRole('status').filter({ hasText: 'Choose a visible surface in the model.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm damage spot' })).toHaveCount(0);
  expect(requests).toHaveLength(0);

  await picker.click({ position: { x: 90, y: 120 } });
  const confirm = page.getByRole('button', { name: 'Confirm damage spot' });
  await expect(confirm).toBeVisible();
  await expect.poll(() => sdkEvents(page)).toEqual(expect.arrayContaining([
    ['tags', [expect.objectContaining({ label: 'Damage spot preview', anchorPosition: anchor })]],
  ]));
  const hit = (await sdkEvents(page)).filter(([kind]) => kind === 'ray').at(-1)?.[1] as { x: number; y: number };
  expect(Math.abs(hit.x - 90)).toBeLessThan(1);
  expect(Math.abs(hit.y - 120)).toBeLessThan(1);
  expect(requests).toHaveLength(0);
  await confirm.click();

  await expect(page.getByText('Damage spot confirmed against the tenant photo.')).toBeVisible();
  expect(requests).toEqual([{
    authorization: `Bearer ${editKey}`, payload: {
      anchor, stem: { x: 0, y: -.22, z: 0 }, sweep: 'review-uuid', modelId: 'fixtureModel',
    },
  }]);
  await expect.poll(() => sdkEvents(page)).toEqual(expect.arrayContaining([
    ['tags', [expect.objectContaining({ label: 'Confirmed damage spot', anchorPosition: anchor })]],
  ]));
});

test('the confirmed spot survives reload without allowing edits from the work order key', async ({ page }) => {
  await stubMatterport(page);
  await stubWorkOrder(page, true);
  await page.goto(workOrder);
  await page.reload();

  await expect(page.getByText('Damage spot confirmed against the tenant photo.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Adjust damage spot' })).toHaveCount(0);
  await page.getByRole('button', { name: 'View confirmed spot' }).click();
  await expect.poll(() => sdkEvents(page)).toEqual(expect.arrayContaining([
    ['tags', [expect.objectContaining({ label: 'Confirmed damage spot', anchorPosition: anchor })]],
    ['sweep', 'review-sid'],
    ['lookAt', anchor],
  ]));
});
