import { readFile } from 'node:fs/promises';
import { z } from 'zod';

const vec3 = z.object({ x: z.number(), y: z.number(), z: z.number() });
const point = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]);
const view = z.object({
  sweep: z.string().min(1),
  rotation: z.object({ x: z.number(), y: z.number() }),
});

const propertySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  address: z.string().min(1),
  timeZone: z.string().refine((zone) => {
    try { new Intl.DateTimeFormat('en', { timeZone: zone }); return true; }
    catch { return false; }
  }, 'Use an IANA time zone'),
  matterportModel: z.string().regex(/^[a-zA-Z0-9]+$/).optional(),
  costar: z.object({
    storiesAboveGrade: z.number().int().positive(),
    buildingType: z.string().min(1).optional(),
    buildingAreaSqFt: z.number().positive().optional(),
  }).optional(),
  roof: z.object({
    imageUrl: z.url({ protocol: /^https$/ }).optional(),
    imageFile: z.string().regex(/^backend\/config\/roof-assets\/[A-Za-z0-9_-]+\.jpg$/).optional(),
    captureDate: z.string().optional(),
    outline: z.array(z.tuple([z.number(), z.number()])).min(3).optional(),
    attributes: z.array(z.object({
      label: z.string(),
      value: z.string(),
      confidence: z.number().min(0).max(1).optional(),
    })).default([]),
  }),
  zones: z.array(z.object({ id: z.string(), label: z.string(), polygon: z.array(point).min(3) })).min(1),
  landmarks: z.array(z.object({
    id: z.string(),
    suite: z.string(),
    label: z.string(),
    aliases: z.array(z.string().min(1)).default([]),
    zoneId: z.string(),
    matterportRoomId: z.string().min(1).optional(),
    anchor: vec3.optional(),
    stem: vec3.optional(),
    views: z.array(view).default([]),
    diagramPoint: point.optional(),
  })).min(1),
}).superRefine((property, ctx) => {
  const zoneIds = new Set(property.zones.map((zone) => zone.id));
  const landmarkIds = new Set(property.landmarks.map((landmark) => landmark.id));
  if (zoneIds.size !== property.zones.length || landmarkIds.size !== property.landmarks.length) {
    ctx.addIssue({ code: 'custom', message: 'Zone and landmark IDs must be unique' });
  }
  for (const landmark of property.landmarks) {
    if (!zoneIds.has(landmark.zoneId)) {
      ctx.addIssue({ code: 'custom', message: `Unknown roof zone for ${landmark.id}` });
    }
  }
});

export type Property = z.infer<typeof propertySchema>;
export type Landmark = Property['landmarks'][number];
export type Role = 'tenant' | 'manager';
export type Participant = { role: Role; suite?: string };

export function normalizeHandle(handle: string) {
  return handle.trim().toLowerCase();
}

export async function loadConfig(env = process.env) {
  const demo = env.DEMO_MODE === 'true';
  const photonTest = env.PHOTON_TEST_MODE === 'true';
  const sponsorRehearsal = env.PHOTON_SPONSOR_REHEARSAL === 'true';
  if (demo && photonTest) throw new Error('Choose either DEMO_MODE or PHOTON_TEST_MODE');
  const photonPollSince = env.PHOTON_POLL_SINCE ? z.iso.datetime({ offset: true }).parse(env.PHOTON_POLL_SINCE) : undefined;
  if (photonPollSince && !photonTest) throw new Error('PHOTON_POLL_SINCE requires PHOTON_TEST_MODE');
  const managerPhoton = env.PHOTON_MANAGER_PROJECT_ID || env.PHOTON_MANAGER_API_KEY
    ? {
      photonProject: z.string().startsWith('pho_prj_').parse(env.PHOTON_MANAGER_PROJECT_ID),
      photonKey: z.string().startsWith('pho_sk_').parse(env.PHOTON_MANAGER_API_KEY),
    }
    : undefined;
  if (managerPhoton && (!photonPollSince || demo || managerPhoton.photonProject === env.PHOTON_PROJECT_ID)) {
    throw new Error('A distinct manager Photon project requires local polling mode');
  }
  if (sponsorRehearsal && (!photonTest || !photonPollSince)) {
    throw new Error('Sponsor rehearsal requires local Photon polling');
  }
  const fictionalProperty = demo || (photonTest && !sponsorRehearsal);
  const path = photonTest && fictionalProperty
    ? 'backend/config/property.demo.json'
    : (env.PROPERTY_CONFIG ?? (demo ? 'backend/config/property.demo.json' : 'backend/config/property.local.json'));
  const property = propertySchema.parse(JSON.parse(await readFile(path, 'utf8')));
  const participants = new Map<string, Participant>();
  const manager = normalizeHandle(demo ? 'manager@demo.invalid' : env.MANAGER_HANDLE ?? '');
  const tenantEntries = z.record(z.string(), z.string().min(1)).parse(
    demo ? { 'tenant@demo.invalid': '402', 'tenant2@demo.invalid': '403' }
      : JSON.parse(env.TENANT_SUITES_JSON ?? '{}'),
  );
  for (const [rawHandle, suite] of Object.entries(tenantEntries)) {
    const handle = normalizeHandle(rawHandle);
    if (!handle || participants.has(handle) || !property.landmarks.some((point) => point.suite === suite)) {
      throw new Error(`Invalid or duplicate tenant assignment for suite ${suite}`);
    }
    participants.set(handle, { role: 'tenant', suite });
  }
  if (!manager || participants.has(manager) || participants.size === 0) {
    throw new Error('Set a distinct manager and at least one tenant mapped to a configured suite');
  }
  participants.set(manager, { role: 'manager' });

  const rawOrigin = env.PUBLIC_BASE_URL ?? 'http://localhost:4310';
  const baseUrl = new URL(rawOrigin).origin;
  if (sponsorRehearsal && !['localhost', '127.0.0.1'].includes(new URL(baseUrl).hostname)) {
    throw new Error('Sponsor rehearsal must run on the local Mac');
  }
  if (property.roof.imageFile && !sponsorRehearsal) {
    throw new Error('Private roof images require sponsor rehearsal mode');
  }
  if (!demo) {
    const required = ['DATABASE_URL', 'PHOTON_PROJECT_ID', 'PHOTON_API_KEY'];
    if (!photonPollSince) required.push('PHOTON_WEBHOOK_SECRET', 'PUBLIC_BASE_URL');
    if (!fictionalProperty) required.push('MATTERPORT_SDK_KEY');
    const missing = required.filter((key) => !env[key]);
    if (missing.length) throw new Error(`Live configuration needs: ${missing.join(', ')}`);
    if ((!photonPollSince && !baseUrl.startsWith('https://')) || !env.PHOTON_PROJECT_ID?.startsWith('pho_prj_')) {
      throw new Error('Live configuration requires HTTPS and a Photon 2.0 Beta project ID');
    }
    if (!fictionalProperty && (!property.matterportModel ||
      !(sponsorRehearsal ? property.roof.imageFile : property.roof.imageUrl) ||
      property.landmarks.some((landmark) => !landmark.anchor || !landmark.stem || !landmark.views.length))) {
      throw new Error('Live property requires a Matterport model, landmark anchors and views, and a Vexcel roof image');
    }
  }
  return {
    demo, photonTest, sponsorRehearsal, photonPollSince, property, participants, manager, managerPhoton, baseUrl,
    port: z.coerce.number().int().min(1).max(65535).parse(env.PORT ?? '4310'),
    databaseUrl: z.string().min(1).parse(env.DATABASE_URL),
    matterportKey: fictionalProperty ? undefined : env.MATTERPORT_SDK_KEY,
    photonProject: env.PHOTON_PROJECT_ID,
    photonKey: env.PHOTON_API_KEY,
    webhookSecret: env.PHOTON_WEBHOOK_SECRET,
    blenderRenderer: env.BLENDER_RENDERER,
    repairContext: env.REPAIR_CONTEXT === 'true',
    reportShareOrigin: env.REPORT_SHARE_ORIGIN ? new URL(z.url({ protocol: /^https$/ }).parse(env.REPORT_SHARE_ORIGIN)).origin : undefined,
    tigerDatabaseUrl: env.TIGER_DATABASE_URL || undefined,
    nudgeSeconds: z.coerce.number().int().positive().parse(env.NUDGE_SECONDS ?? (demo ? 120 : 3600)),
  };
}

export type Config = Awaited<ReturnType<typeof loadConfig>>;
