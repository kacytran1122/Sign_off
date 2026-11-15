import { expect, test } from '@playwright/test';

const key = '00000000-0000-4000-8000-000000000021';
const photo = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVx8AAAAASUVORK5CYII=',
  'base64',
);
const tenantApi = `/api/reports/${key}`;
const workOrderApi = `/api/work-orders/${key}`;

test('a missing report link shows the app’s unavailable state', async ({ page }) => {
  await page.goto('/reports/invalid-key');
  await expect(page).toHaveTitle('Repair report | Signoff');
  await expect(page.getByRole('status')).toHaveText('This page is unavailable.');
  await expect(page.getByRole('heading', { name: 'Temporary protection' })).toHaveCount(0);
});

test('a tenant report moves from generating to a visible guide without a reload', async ({ page }) => {
  let ready = false;
  await page.route('https://www.arcgis.com/apps/Embed/**', (route) => route.fulfill({ body: '' }));
  await page.route(`**${tenantApi}`, (route) => route.fulfill({ json: {
    id: '21', status: 'open', issue: 'damage', guidance: 'Keep the landing clear.',
    effects: 'A broken step increases fall risk.', renderStatus: ready ? 'ready' : 'queued',
    area: { city: 'Los Angeles', latitude: 34.1234567, longitude: -118.2345678 },
  } }));
  await page.route(`**${tenantApi}/render`, (route) => route.fulfill({ contentType: 'image/png', body: photo }));
  await page.goto(`/reports/${key}`);

  await expect(page.getByRole('heading', { name: 'Building damage' })).toBeVisible();
  const map = page.locator('iframe[title="Neighborhood satellite map"]');
  await expect(map).toHaveAttribute('referrerpolicy', 'no-referrer');
  await expect(map).toHaveAttribute('src', /arcgis\.com\/apps\/Embed\/index\.html\?.*&center=-118\.235%2C34\.123&level=18&/);
  await expect(page.getByRole('link', { name: 'Esri World Imagery' })).toBeVisible();
  await expect(page.getByText('Generating the 3D diagram…')).toBeVisible();
  const guide = page.getByRole('img', { name: /^3D guide/ });
  await expect(guide).toHaveCount(0);
  ready = true;
  await expect(guide).toBeVisible();
  await expect(page.getByText('Blender rendered', { exact: true })).toBeVisible();
  await expect.poll(() => guide.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
  await expect(page.getByText('Generating the 3D diagram…')).toHaveCount(0);
});

test('the manager’s work order displays the tenant photo and timeline', async ({ page }) => {
  await page.route(`**${workOrderApi}`, (route) => route.fulfill({ json: {
    id: '21', status: 'awaiting_confirmation', zoneId: 'reported', demo: false,
    property: { name: 'Reported property', address: '100 Fixture Ave', timeZone: 'America/Los_Angeles', landmarks: [], zones: [], roof: { attributes: [] } },
    repair: { address: '100 Fixture Ave', guidance: 'Set a bucket below the drip.', effects: 'Water can damage floors.', issue: 'leak', aid: 'bucket' },
    renderStatus: 'ready',
    reports: [{ id: '9', landmark_id: 'reported-location', has_photo: true, description: 'Water dripping above the kitchen sink.' }],
    timeline: [{ action: 'repair_reported', detail: 'Waiting for the tenant to confirm.', created_at: '2026-11-15T18:30:00Z' }],
  } }));
  await page.route(`**${workOrderApi}/photos/9`, (route) => route.fulfill({ contentType: 'image/png', body: photo }));
  await page.goto(`/work-orders/${key}`);

  await expect(page.getByText('Awaiting tenant', { exact: true })).toBeVisible();
  await expect(page.getByText('Water dripping above the kitchen sink.')).toBeVisible();
  const tenantImage = page.getByRole('img', { name: 'Photo submitted with the tenant’s report' });
  await expect(tenantImage).toHaveAttribute('src', `${workOrderApi}/photos/9`);
  await expect.poll(() => tenantImage.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
  await expect(page.getByText('Repair reported', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '3D inspection schematic' })).toHaveCount(0);
});

test('the mobile report distinguishes outdoor forecast and city counts from site evidence', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(`**${tenantApi}`, (route) => route.fulfill({ json: {
    id: '21', status: 'open', issue: 'leak', guidance: 'Keep the walkway clear.', effects: 'Wet materials can develop mold.',
    area: {
      city: 'LOS ANGELES', store: 'TigerData',
      weather: {
        current: { temperature_2m: 71.6, apparent_temperature: 75.1, relative_humidity_2m: 49.6 },
        daily: { time: ['2026-11-15', '2026-11-16', '2026-11-17'], apparent_temperature_max: [78, null, 80] },
      },
      heat: { typicalHighF: 76, validationMaeF: 4.1 },
      history: [{ time: '2026-11-15T08:00:00Z', feelsLikeF: 67 }, { time: '2026-11-15T09:00:00Z', feelsLikeF: 73 }],
      coverage: { indicators: { water: 8, waste: 12 }, start_date: '2026-08-17', through_date: '2026-11-15' },
    },
  } }));
  await page.goto(`/reports/${key}`);

  await expect(page.getByText('feels like 75°F', { exact: false })).toBeVisible();
  const forecast = page.getByRole('list', { name: 'Forecast daily highs for feels-like temperature' });
  await expect(forecast.getByRole('listitem')).toHaveCount(2);
  await expect(forecast).toContainText('80°F');
  await expect(page.getByRole('img', { name: 'Hourly feels-like temperatures from 67 to 73 degrees Fahrenheit' })).toBeVisible();
  await expect(page.getByText('8 water-related and 12 waste-related 311 reports', { exact: false })).toBeVisible();
  await expect(page.getByText('These records do not establish whether mice or rats are at the building.', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('the manager sees a confirmed photo projection on the outlined roof', async ({ page }) => {
  let confirmed = false;
  const roofProjection = { point: [.54, .63], inInspectionZone: false };
  await page.route(`**${workOrderApi}`, (route) => route.fulfill({ json: {
    id: '21', status: 'open', zoneId: 'roof-lobby', demo: false,
    property: {
      name: 'Fixture building', address: '100 Fixture Ave', timeZone: 'America/Chicago',
      costar: { storiesAboveGrade: 1, buildingType: 'Industrial', buildingAreaSqFt: 60000 },
      landmarks: [{ id: 'lobby', label: 'Lobby ceiling', suite: 'Ground floor', views: [] }],
      zones: [{ id: 'roof-lobby', label: 'Lobby roof area', polygon: [[.2, .2], [.3, .2], [.3, .3], [.2, .3]] }],
      roof: { imageUrl: '/assets/fixture-roof.png', outline: [[.1, .1], [.8, .1], [.8, 1.4], [.1, 1.4]], attributes: [] },
    },
    reports: [{
      id: '9', landmark_id: 'lobby', has_photo: confirmed, description: 'Water dripping in the lobby.',
      damagePoint: confirmed ? { anchor: { x: 1, y: 2, z: 3 }, stem: { x: 0, y: -.22, z: 0 }, confirmed: true } : undefined,
      roofProjection,
    }],
    timeline: [],
    plans: [{ landmarkId: 'lobby', steps: ['Check the lobby ceiling.', 'If moisture points overhead, check the highlighted roof area.'] }],
  } }));
  await page.route('**/assets/fixture-roof.png', (route) => route.fulfill({ contentType: 'image/png', body: photo }));
  await page.route(`**${workOrderApi}/photos/9`, (route) => route.fulfill({ contentType: 'image/png', body: photo }));
  await page.goto(`/work-orders/${key}`);

  const plan = page.getByRole('region', { name: 'Inspection plan' });
  await expect(plan).toContainText('CoStar · single-story building · Industrial · 60,000 sq ft');
  await expect(plan.getByRole('listitem')).toHaveText([
    'Check the lobby ceiling.', 'If moisture points overhead, check the highlighted roof area.',
  ]);
  await expect(page.getByRole('img', { name: 'Vexcel aerial view of the property roof' })).toBeVisible();
  const zone = page.getByRole('img', { name: 'Highlighted zone: Lobby roof area' });
  await expect(zone.locator('polygon')).toHaveCount(2);
  const marker = page.locator('.roof-photo-pin');
  await expect(marker).toHaveCount(0);

  confirmed = true;
  await expect(page.getByText('Estimated roof position above the confirmed photo pin')).toBeVisible();
  await expect(page.getByText(/outside the starting inspection area/)).toBeVisible();
  await expect(marker).toHaveAttribute('style', /left: 54%; top: 63%;/);
  await expect(zone.locator('polygon')).toHaveCount(2);
});
