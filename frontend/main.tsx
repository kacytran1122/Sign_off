'use client';

import { useEffect, useRef, useState } from 'react';
import type { FormEvent, MouseEvent } from 'react';
import type { Showcase } from '@matterport/sdk';
import { SignoffLogo } from './brand/SignoffLogo';
import demoStyles from './workspace/demo.module.css';

type Vector = { x: number; y: number; z: number };
type DamagePlacement = { anchor: Vector; stem: Vector; sweep?: string };
type DamagePoint = DamagePlacement & { confirmed: true };
type RoofProjection = { point: [number, number]; inInspectionZone: boolean };
type TenantReport = {
  id: string; landmark_id: string; description: string; has_photo: boolean;
  damagePoint?: DamagePoint; roofProjection?: RoofProjection;
};
type Landmark = {
  id: string; label: string; suite: string;
  anchor?: Vector;
  stem?: Vector;
  diagramPoint?: [number, number];
  views: { sweep: string; rotation: { x: number; y: number } }[];
};
type Ticket = {
  id: string; status: Status; visitStart: string | null; visitEnd: string | null;
  demo: boolean; photonTest?: boolean; sponsorRehearsal?: boolean; zoneId: string; matterportKey?: string;
  renderStatus?: 'queued' | 'ready' | 'failed';
  plans?: { landmarkId: string; summary: string; steps: string[] }[];
  repair?: { issue: 'leak' | 'damage'; address: string; guidance: string; effects: string; aid: string; area?: Area | null };
  property: {
    name: string; address: string; timeZone: string; matterportModel?: string;
    costar?: { storiesAboveGrade: number; buildingType?: string; buildingAreaSqFt?: number };
    roof: { imageUrl?: string; captureDate?: string; outline?: [number, number][]; attributes: { label: string; value: string; confidence?: number }[] };
    landmarks: Landmark[]; zones: { id: string; label: string; polygon: [number, number][] }[];
  };
  reports: TenantReport[];
  timeline: { action: string; detail: string; created_at: string }[];
};
type BuildingEvidence = {
  storiesAboveGrade: number; buildingType?: string; propertySubtype?: string; buildingAreaSqFt?: number; yearBuilt?: number;
  roomLabel?: string; roomEvidence?: { areaSqFt?: number; widthFt?: number; depthFt?: number; heightFt?: number };
  matchedRooms?: number; matchedViewpoints?: number; hasMatterport?: boolean; hasVexcel?: boolean;
  captureDate?: string; analysisDate?: string;
};
type Area = {
  latitude?: number; longitude?: number; city?: string; error?: string; timeZone?: string; store?: string;
  weather?: { current: { temperature_2m: number; apparent_temperature: number; relative_humidity_2m: number };
    daily: { time: string[]; apparent_temperature_max: (number | null)[] } };
  coverage?: { start_date: string; through_date: string; indicators: { water: number; waste: number; rodentMentions?: number } };
  heat?: { typicalHighF: number; validationMaeF: number; trainedThrough: string };
  history?: { time: string; feelsLikeF: number }[];
};
type Status = 'open' | 'scheduled' | 'awaiting_confirmation' | 'closed';
const statuses: Record<Status, string> = {
  open: 'Open', scheduled: 'Scheduled', awaiting_confirmation: 'Awaiting tenant', closed: 'Closed',
};
const actions: Record<string, string> = {
  opened: 'Report received', inspection_planned: 'Inspection plan created', report_linked: 'Related report linked', reminder: 'Manager reminded',
  scheduled: 'Inspection scheduled', repair_reported: 'Repair reported', reopened: 'Work order reopened',
  closed: 'Work order closed', tenant_confirmed: 'Tenant confirmed', photo_added: 'Photo added', damage_point_confirmed: 'Damage spot confirmed',
  agent_trace: 'Agents involved', agent_triage: 'Safety triage', agent_brief: 'Evidence brief', agent_snooze: 'Follow-up scheduled',
};

function usePoll<T>(url?: string) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState('');
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    let fetching = false;
    const refresh = async () => {
      if (fetching) return;
      fetching = true;
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(response.status === 404 ? 'This page is unavailable.' : 'Could not load the latest update.');
        const result: T = await response.json();
        setData(result);
        setError('');
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Connection error');
      } finally {
        fetching = false;
      }
    };
    void refresh();
    const timer = setInterval(refresh, 1500);
    return () => { controller.abort(); clearInterval(timer); };
  }, [url]);
  return { data, error, setData };
}

function Header({ demo, workspace, multiAgent }: { demo?: boolean; workspace?: boolean; multiAgent?: boolean }) {
  return <header className={workspace ? demoStyles.header : 'topbar'}><div className={workspace ? demoStyles.headerInner : 'topbar-inner'}>
    <a className={workspace ? demoStyles.brand : 'brand'} href="/" aria-label="Signoff home">
      <SignoffLogo variant={workspace ? 'dark' : 'light'} />
    </a>
    {workspace ? <div className={demoStyles.headerLinks}>
      {(demo || multiAgent) && <span className={demoStyles.mode}>{multiAgent ? 'Multi-agent' : 'Repair workspace'}</span>}
      <a href="/#how">How it works</a>
    </div> : demo && <a className="demo-label" href="/app">Repair workspace</a>}
  </div></header>;
}
function Badge({ status }: { status: Status }) {
  return <span className={`badge ${status}`}>{statuses[status]}</span>;
}

type PinReview =
  | { reportId: string; stage: 'armed' | 'locating' }
  | { reportId: string; stage: 'preview' | 'saving'; point: DamagePlacement };

function useDamageMarker(sdk: Showcase | undefined, point: DamagePlacement | undefined, preview: boolean) {
  const { x, y, z } = point?.anchor ?? {};
  const { x: stemX, y: stemY, z: stemZ } = point?.stem ?? {};
  const [error, setError] = useState('');
  useEffect(() => {
    setError('');
    if (!sdk || x === undefined || y === undefined || z === undefined
        || stemX === undefined || stemY === undefined || stemZ === undefined) return;
    let active = true;
    const tags = sdk.Tag.add([{
      label: preview ? 'Damage spot preview' : 'Confirmed damage spot',
      description: preview ? 'Unsaved. Compare with the tenant photo.' : 'Location matched to the tenant photo by a reviewer.',
      anchorPosition: { x, y, z }, stemVector: { x: stemX, y: stemY, z: stemZ },
      color: preview ? { r: 1, g: .68, b: .19 } : { r: .92, g: .25, b: .2 },
    }]);
    void tags.catch(() => { if (active) setError('The damage marker could not be drawn.'); });
    return () => {
      active = false;
      void tags.then((ids) => sdk.Tag.remove(...ids)).catch(() => {});
    };
  }, [sdk, x, y, z, stemX, stemY, stemZ, preview]);
  return error;
}

function Interior({ ticket, active, report, access, inspectToken, onConfirm }: {
  ticket: Ticket; active: Landmark; report: TenantReport; access: string; inspectToken?: string;
  onConfirm: (reportId: string, point: DamagePoint) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const added = useRef(new Set<string>());
  const [sdk, setSdk] = useState<Showcase>();
  const [message, setMessage] = useState('');
  const [walking, setWalking] = useState(false);
  const [review, setReview] = useState<PinReview>();
  const camera = useRef<{ position: Vector; sweep: string } | undefined>(undefined);
  const { matterportKey } = ticket;
  const model = ticket.property.matterportModel;
  const showcaseUrl = model && matterportKey
    ? `https://my.matterport.com/show/?${new URLSearchParams({ m: model, play: '1', applicationKey: matterportKey })}`
    : undefined;
  const locationIds = [...new Set(ticket.reports.map((entry) => entry.landmark_id))].join(',');
  const canReview = !!inspectToken && !!showcaseUrl && report.has_photo;
  const photoUrl = `/api/work-orders/${encodeURIComponent(access)}/photos/${encodeURIComponent(report.id)}`;
  const currentReview = canReview && review?.reportId === report.id ? review : undefined;
  const draft = currentReview && 'point' in currentReview ? currentReview.point : undefined;
  const confirmed = report.damagePoint?.confirmed ? report.damagePoint : undefined;
  const confirmedError = useDamageMarker(sdk, confirmed, false);
  const previewError = useDamageMarker(sdk, draft, true);
  useEffect(() => {
    if (!model || !matterportKey || !frame.current) return;
    const iframe = frame.current;
    let live = true;
    setSdk(undefined);
    added.current.clear();
    const loadingNotice = setTimeout(() => {
      if (live) setMessage('The Matterport viewer is still loading.');
    }, 15_000);
    void import('@matterport/sdk').then(async ({ setupSdk }) => {
      const client = await setupSdk(matterportKey, { iframe });
      await client.App.state.waitUntil(({ phase }) => phase === client.App.Phase.PLAYING);
      if (!live) return;
      setMessage('');
      setSdk(client);
    }).catch(() => {
      if (live) setMessage('The interactive viewer could not connect. Check the model and allowed domain.');
    }).finally(() => clearTimeout(loadingNotice));
    return () => { live = false; clearTimeout(loadingNotice); };
  }, [model, matterportKey]);
  useEffect(() => {
    if (!sdk || !canReview) return;
    const pose = sdk.Camera.pose.subscribe((value) => { camera.current = value; });
    return () => { pose.cancel(); camera.current = undefined; };
  }, [sdk, canReview]);
  useEffect(() => {
    setReview(undefined);
    setMessage('');
  }, [report.id]);
  useEffect(() => {
    if (!sdk) return;
    const locations = ticket.property.landmarks.filter((point) =>
      locationIds.split(',').includes(point.id) && !added.current.has(point.id) && point.anchor && point.stem,
    );
    if (!locations.length) return;
    locations.forEach((point) => added.current.add(point.id));
    void sdk.Tag.add(locations.map((point) => ({
      label: point.label, anchorPosition: point.anchor!, stemVector: point.stem!,
    }))).catch(() => setMessage('The model loaded, but the inspection markers could not be drawn.'));
  }, [sdk, locationIds, ticket.property.landmarks]);
  async function walk() {
    if (!sdk || walking) return;
    setWalking(true);
    setMessage('');
    try {
      const sweeps = ticket.sponsorRehearsal || confirmed?.sweep ? (await sdk.Model.getData()).sweeps : [];
      const normalize = (id: string) => id.replaceAll('-', '');
      const views = confirmed?.sweep
        ? [{ sweep: confirmed.sweep, rotation: active.views[0]?.rotation ?? { x: 0, y: 0 } }]
        : active.views;
      for (const view of views) {
        const sweep = sweeps.find(({ sid, uuid }) =>
          [sid, uuid].some((id) => id && normalize(id) === normalize(view.sweep)),
        );
        await sdk.Sweep.moveTo(sweep?.sid ?? view.sweep, { rotation: view.rotation, transition: 'transition.fade' });
      }
      const target = confirmed?.anchor ?? (ticket.sponsorRehearsal ? active.anchor : undefined);
      if (target && sdk.Camera.lookAt) await sdk.Camera.lookAt(target);
    } catch { setMessage('This walkthrough could not reach its saved viewpoint.'); }
    finally { setWalking(false); }
  }
  async function selectSurface(event: MouseEvent<HTMLButtonElement>) {
    if (!sdk || !frame.current || currentReview?.stage !== 'armed') return;
    const pose = camera.current;
    if (!pose?.sweep) {
      setReview(undefined);
      setMessage('Open the room view before placing a damage marker.');
      return;
    }
    const bounds = frame.current.getBoundingClientRect();
    const screen = event.detail === 0
      ? { x: bounds.width / 2, y: bounds.height / 2 }
      : { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    setReview({ reportId: report.id, stage: 'locating' });
    try {
      const { position, floor } = await sdk.Renderer.getWorldPositionData(screen);
      if (!position || floor < 0) {
        setReview((current) => current?.reportId === report.id ? { reportId: report.id, stage: 'armed' } : current);
        setMessage('Choose a visible surface in the model.');
        return;
      }
      // Offset the marker toward the reviewer so it stays visible on walls and ceilings.
      const x = pose.position.x - position.x, y = pose.position.y - position.y, z = pose.position.z - position.z;
      const scale = .22 / Math.hypot(x, y, z);
      if (!Number.isFinite(scale) || ![x, y, z].every(Number.isFinite)) throw new Error('Invalid surface position');
      const point = { anchor: position, stem: { x: x * scale, y: y * scale, z: z * scale }, sweep: pose.sweep };
      setReview((current) => current?.reportId === report.id ? { reportId: report.id, stage: 'preview', point } : current);
      setMessage('');
    } catch {
      setReview((current) => current?.reportId === report.id ? { reportId: report.id, stage: 'armed' } : current);
      setMessage('Could not read that surface. Choose the spot again.');
    }
  }

  async function confirmSurface() {
    if (!canReview || !model || !draft || currentReview?.stage !== 'preview') return;
    setReview({ reportId: report.id, stage: 'saving', point: draft });
    setMessage('');
    try {
      const response = await fetch(`${photoUrl}/damage-point`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${inspectToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...draft, modelId: model }),
      });
      if (response.status === 401 || response.status === 403) throw new Error('This inspection link does not allow saving a marker.');
      if (!response.ok) throw new Error('Could not save the damage spot. Try again.');
      const { damagePoint }: { damagePoint: DamagePoint } = await response.json();
      if (!damagePoint?.confirmed) throw new Error('Could not verify the saved damage spot.');
      onConfirm(report.id, damagePoint);
      setReview((current) => current?.reportId === report.id ? undefined : current);
    } catch (error) {
      setReview((current) => current?.reportId === report.id ? { reportId: report.id, stage: 'preview', point: draft } : current);
      setMessage(error instanceof Error ? error.message : 'Could not save the damage spot. Try again.');
    }
  }

  const notice = message || previewError || confirmedError;
  const comparison = canReview && !!currentReview;
  const picking = currentReview?.stage === 'armed' || currentReview?.stage === 'locating';
  return <section className="panel evidence">
    <div className="panel-head"><div><h2>Reported location</h2><p>{ticket.sponsorRehearsal ? active.suite : `Suite ${active.suite}`} · {active.label}</p>
      {model && report.has_photo && <p>{confirmed ? 'Damage spot confirmed against the tenant photo.' : 'Room location. Damage spot awaiting photo review.'}</p>}</div>
      {model && <button className="small" disabled={!sdk || walking || !!currentReview} onClick={walk}>
        {walking ? 'Moving…' : confirmed ? 'View confirmed spot' : 'Walk to report'}
      </button>}</div>
    {model ? <div className={comparison ? 'model-comparison' : undefined}>
      <div className="model-surface"><iframe className="showcase" title="Matterport inspection model" src={showcaseUrl}
        allow="fullscreen; xr-spatial-tracking; autoplay" referrerPolicy="origin" ref={frame} />
        {picking && <button className="surface-picker" onClick={selectSurface} disabled={currentReview?.stage === 'locating'}
          aria-label="Select a surface on the Matterport model" />}
      </div>
      {comparison && <figure className="photo-reference"><img src={photoUrl} alt="Tenant photo for matching the damage spot" />
        <figcaption>{report.description}</figcaption></figure>}
    </div>
      : <div className="diagram interior" role="img" aria-label={`Floor plan diagram. Marker at ${active.label}`}>
        <div className="room west-north">Conference</div><div className="room east-north">Reception</div>
        <div className="room west-south">Studio</div><div className="room east-south">Office</div>
        <div className="hall">Hall</div>
        <span className="pin" style={{ left: `${(active.diagramPoint?.[0] ?? .5) * 100}%`, top: `${(active.diagramPoint?.[1] ?? .5) * 100}%` }} />
      </div>}
    {canReview && <div className="damage-controls">
      {currentReview ? <>
        <p aria-live="polite">{picking ? 'Click the surface in Matterport that matches the damage in the photo.'
          : 'Compare the preview marker with the tenant photo before saving.'}</p>
        {draft && <button className="primary" onClick={confirmSurface} disabled={currentReview.stage === 'saving' || !!previewError}>
          {currentReview.stage === 'saving' ? 'Saving…' : 'Confirm damage spot'}
        </button>}
        {draft && <button onClick={() => { setReview({ reportId: report.id, stage: 'armed' }); setMessage(''); }}
          disabled={currentReview.stage === 'saving'}>Pick again</button>}
        <button onClick={() => { setReview(undefined); setMessage(''); }}
          disabled={currentReview.stage === 'locating' || currentReview.stage === 'saving'}>Cancel</button>
      </> : <button className="small" disabled={!sdk || walking} onClick={() => {
        setReview({ reportId: report.id, stage: 'armed' });
        setMessage('');
      }}>{confirmed ? 'Adjust damage spot' : 'Match photo to model'}</button>}
    </div>}
    {notice && <p className="notice" role="status">{notice}</p>}
  </section>;
}

function Roof({ ticket, zone, projection, hasValidatedZone }: {
  ticket: Ticket; zone: Ticket['property']['zones'][number]; projection?: RoofProjection; hasValidatedZone: boolean;
}) {
  const { roof } = ticket.property;
  const showZone = !roof.outline || hasValidatedZone;
  const target = roof.imageUrl && projection?.point.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)
    ? projection : undefined;
  return <section className="panel evidence">
    <div className="panel-head"><div><h2>{showZone ? 'Suggested inspection area' : 'Property roof'}</h2><p>{showZone ? zone.label : 'Vexcel aerial image'}{roof.captureDate && ` · Captured ${roof.captureDate}`}</p></div></div>
    <div className={`roof-image ${roof.imageUrl ? '' : 'diagram roof-diagram'}`}>
      {roof.imageUrl ? <img src={roof.imageUrl} alt="Vexcel aerial view of the property roof" /> : <div className="roof-shape" />}
      <svg className="roof-zone" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label={showZone ? `Highlighted zone: ${zone.label}` : 'Building roof outline'} role="img">
        {roof.outline && <polygon className="roof-outline" points={roof.outline.map(([x, y]) => `${x * 100},${y * 100}`).join(' ')} />}
        {showZone && <polygon points={zone.polygon.map(([x, y]) => `${x * 100},${y * 100}`).join(' ')} />}
      </svg>
      {target && <span className="roof-photo-pin" aria-hidden="true"
        style={{ left: `${target.point[0] * 100}%`, top: `${target.point[1] * 100}%` }} />}
    </div>
    {target ? <div className="roof-photo-note">
      <p className="roof-photo-label">Estimated roof position above the confirmed photo pin</p>
      <p>Use this estimate as an inspection reference. Verify the source on site.
        {!target.inInspectionZone && ' This estimate falls outside the starting inspection area.'}</p>
    </div> : <p className="caption">{showZone
      ? 'The location gives the vendor a place to inspect. The cause is pending inspection.'
      : 'This roof image is available for reference. The inspection target could not be verified.'}</p>}
    {roof.attributes.length > 0 && <dl className="attributes">{roof.attributes.map((item) =>
      <div key={item.label}><dt>{item.label}</dt><dd>{item.value}{item.confidence != null && ` · ${Math.round(item.confidence * 100)}%`}</dd></div>,
    )}</dl>}
  </section>;
}
function InspectionPlan({ plan, property }: { plan: NonNullable<Ticket['plans']>[number]; property: Ticket['property'] }) {
  const building = property.costar;
  const facts = [
    building?.storiesAboveGrade === 1 && 'single-story building',
    building?.buildingType,
    building?.buildingAreaSqFt && `${building.buildingAreaSqFt.toLocaleString('en-US')} sq ft`,
  ].filter(Boolean);
  return <section className="panel inspection-plan" aria-labelledby="inspection-plan">
    <div className="panel-head"><div><h2 id="inspection-plan">Inspection plan</h2>
      <p>CoStar · {facts.join(' · ')}. The Matterport room lines up with the Vexcel roof footprint.</p>
    </div></div>
    <ol>{plan.steps.map((step) => <li key={step}>{step}</li>)}</ol>
  </section>;
}
function dateTime(value: string, zone: string) {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: zone }).format(new Date(value));
}
function Neighborhood({ area }: { area: Area | null | undefined }) {
  const { latitude, longitude } = area ?? {};
  const center = typeof longitude === 'number' && typeof latitude === 'number' && Number.isFinite(longitude) && Number.isFinite(latitude)
    ? encodeURIComponent(`${longitude.toFixed(3)},${latitude.toFixed(3)}`) : '';
  const weather = area?.weather;
  return <section className="panel evidence neighborhood">
    <div className="panel-head"><div><h2>Neighborhood conditions</h2><p>{area?.city || 'Location and outdoor conditions'}</p></div></div>
    {center && <div><iframe className="area-map" title="Neighborhood satellite map" loading="lazy" referrerPolicy="no-referrer"
      sandbox="allow-scripts allow-same-origin"
      src={`https://www.arcgis.com/apps/Embed/index.html?webmap=86265e5a4bbb4187a59719cf134e0018&center=${center}&level=18&scale=true&zoom=true&disable_scroll=true`} />
      <p className="caption">Approximate location · <a href="https://www.arcgis.com/home/item.html?id=86265e5a4bbb4187a59719cf134e0018" target="_blank" rel="noreferrer">Esri World Imagery</a></p></div>}
    {!area ? <p className="caption" role="status">Looking up the address and neighborhood data…</p> : area.error && <p className="caption">{area.error}</p>}
    {area && !area.error && <div className="area-stats">
      <div><h3>Outdoor heat and humidity</h3>
        {weather ? <>
          <p><strong>{Math.round(weather.current.temperature_2m)}°F</strong> outside · feels like {Math.round(weather.current.apparent_temperature)}°F · {Math.round(weather.current.relative_humidity_2m)}% humidity</p>
          <p className="caption">Indoor temperature and the cause of the damage need to be checked on site.</p>
          <ul className="heat-chart" aria-label="Forecast daily highs for feels-like temperature">{weather.daily.time.map((day, i) => {
            const value = weather.daily.apparent_temperature_max[i];
            return value == null ? null : <li key={day}><time dateTime={day}>{day.slice(5)}</time><span className="heat-bar" style={{ width: `${Math.max(8, Math.min(75, value * .7))}%` }} /><strong>{Math.round(value)}°F</strong></li>;
          })}</ul>
          <p className="caption"><a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Weather by Open-Meteo</a></p>
        </> : <p>Outdoor weather is unavailable.</p>}
        {area.heat && <p className="caption">Seasonal model · typical feels-like high {area.heat.typicalHighF}°F · holdout error {area.heat.validationMaeF.toFixed(1)}°F.</p>}
        {!!area.history?.length && <div>
          <p className="caption">Feels-like temperature over the past 24 hours · {area.store}</p>
          <div className="heat-history" role="img" aria-label={`Hourly feels-like temperatures from ${Math.min(...area.history.map(x => x.feelsLikeF))} to ${Math.max(...area.history.map(x => x.feelsLikeF))} degrees Fahrenheit`}>
            {area.history.map((x) => <span key={x.time} title={`${dateTime(x.time, area.timeZone ?? 'UTC')} · ${x.feelsLikeF}°F`}
              style={{ height: `${Math.min(100, Math.max(10, x.feelsLikeF))}%` }} />)}
          </div>
        </div>}
      </div>
      <div><h3>Rodents and nearby 311 reports</h3>
        {area.coverage && <p>{area.coverage.indicators.water} water-related and {area.coverage.indicators.waste} waste-related 311 reports within 1 km from {area.coverage.start_date} to {area.coverage.through_date}.</p>}
        {area.coverage?.indicators.rodentMentions !== undefined && <p>{area.coverage.indicators.rodentMentions} Houston 311 reports in the same area and dates mentioned mice or rats.</p>}
        <p>These records do not establish whether mice or rats are at the building. Tell maintenance if you see rodents, droppings or gnaw marks.</p>
        {area.coverage && <p className="caption"><a href={area.city === 'LOS ANGELES' ? 'https://data.lacity.org/d/2cy6-i7zn' : 'https://my311.houstontx.gov/servicerequestdata.html'} target="_blank" rel="noreferrer">City 311 records</a></p>}
      </div>
    </div>}
  </section>;
}
export function WorkOrder({ access }: { access: string }) {
  const { data, error, setData } = usePoll<Ticket>(`/api/work-orders/${encodeURIComponent(access)}`);
  const [inspectToken, setInspectToken] = useState<string>();
  useEffect(() => {
    function syncToken() {
      setInspectToken(new URLSearchParams(window.location.hash.slice(1)).get('inspect') ?? undefined);
    }
    syncToken();
    window.addEventListener('hashchange', syncToken);
    return () => window.removeEventListener('hashchange', syncToken);
  }, []);
  function confirmPoint(reportId: string, damagePoint: DamagePoint) {
    setData((current) => current && {
      ...current,
      reports: current.reports.map((entry) => entry.id === reportId ? { ...entry, damagePoint, roofProjection: undefined } : entry),
    });
  }
  const [selected, setSelected] = useState<string>();
  if (!data) return <><Header /><main className="page"><p role="status">{error || 'Loading work order…'}</p></main></>;
  const activeReport = data.reports.find((report) => report.id === selected) ?? data.reports[0];
  const active = data.property.landmarks.find((point) => point.id === activeReport?.landmark_id);
  const zone = data.property.zones.find((roof) => roof.id === data.zoneId);
  const plan = data.plans?.find((item) => item.landmarkId === active?.id);
  return <><Header demo={data.demo} /><main className="page">
    <section className="heading">
      <div><p className="eyebrow">Work order L-{data?.id}</p><h1>{data.repair?.issue === 'damage' ? 'Building damage' : data.repair ? 'Water leak' : 'Ceiling leak'}</h1>
        <p className="subtitle">{data.property.name} · {data.photonTest && !data.sponsorRehearsal ? 'Property address unavailable' : data.repair?.address ?? data.property.address}</p></div>
      <Badge status={data.status} />
    </section>
    {error && <p role="status" className="notice">{error}</p>}
    {data.visitStart && data.visitEnd && <p className="inspection"><strong>Inspection</strong> {dateTime(data.visitStart, data.property.timeZone)} to {dateTime(data.visitEnd, data.property.timeZone)} · {data.property.timeZone}</p>}
    {plan && <InspectionPlan plan={plan} property={data.property} />}
    {active && activeReport && (zone || data.property.matterportModel) && <div className="evidence-grid">
      <Interior key={data.property.matterportModel} ticket={data} active={active} report={activeReport}
        access={access} inspectToken={inspectToken} onConfirm={confirmPoint} />
      {zone && <Roof ticket={data} zone={zone} hasValidatedZone={!!plan}
        projection={activeReport.damagePoint?.confirmed ? activeReport.roofProjection : undefined} />}
    </div>}
    {data.repair && <Neighborhood area={data.repair.area} />}
    {data.repair && <p className="inspection"><strong>Possible effects</strong> {data.repair.effects}</p>}
    {data.renderStatus && !data.repair && <section className="panel evidence">
      <div className="panel-head"><div><h2>3D inspection schematic</h2><p>3D view of the reported ceiling and the suggested roof area.</p></div></div>
      {data.renderStatus === 'ready'
        ? <div className="roof-image"><img src={`/api/work-orders/${access}/render`} alt="Blender schematic of the reported ceiling and roof inspection area" /></div>
        : <p className="caption" role="status">{data.renderStatus === 'queued' ? 'Generating schematic…' : 'The schematic is unavailable.'}</p>}
    </section>}
    <div className="detail-grid">
      <section className="panel"><div className="panel-head"><h2>Tenant reports</h2></div>
        {data.reports.map((report) => {
          const point = data.property.landmarks.find((landmark) => landmark.id === report.landmark_id);
          return <article key={report.id} className="report">
            <button className="report-link" onClick={() => setSelected(report.id)} aria-pressed={activeReport?.id === report.id}>{point ? `${data.sponsorRehearsal ? point.suite : `Suite ${point.suite}`} · ${point.label}` : 'Reported area'}</button>
            <p>{report.description}</p>
            {report.has_photo && <img className="tenant-photo" src={`/api/work-orders/${access}/photos/${report.id}`} alt="Photo submitted with the tenant’s report" />}
          </article>;
        })}
      </section>
      <section className="panel"><div className="panel-head"><h2>Timeline</h2></div><ol className="timeline">
        {data.timeline.map((event, index) => <li key={index}><strong>{actions[event.action] ?? event.action}</strong>
          <p>{event.detail}</p><time dateTime={event.created_at}>{dateTime(event.created_at, data.property.timeZone)}</time></li>)}
      </ol></section>
    </div>
  </main></>;
}

type Role = 'tenant' | 'tenant2' | 'manager';
type Demo = {
  orders: { id: string; status: Status; access_key: string }[];
  messages: { target: string; body: string; created_at: string }[];
};
export function DemoPage() {
  const health = usePoll<{ mode: 'live' | 'photon-test' | 'photon-sponsor' | 'demo'; agentMode?: 'multi' | 'standard' }>('/healthz');
  const { data, error } = usePoll<Demo>(health.data?.mode === 'demo' ? '/api/demo' : undefined);
  const [role, setRole] = useState<Role>('tenant');
  const [text, setText] = useState('');
  const [image, setImage] = useState<File>();
  const [notice, setNotice] = useState('');
  const [sending, setSending] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const [sent, setSent] = useState<Record<string, { body: string; created_at: string }[]>>({});
  const choices = role === 'manager' ? ['Tuesday 2 to 4 PM', 'YES', 'FIXED']
    : role === 'tenant2' ? ['Water stain by the studio window', 'Still leaking', 'Resolved']
      : ['Ceiling stain by the window', '1', 'Still leaking', 'Resolved'];
  const handle = `${role}@demo.invalid`;
  const messages = [...(data?.messages.filter((m) => m.target === handle).map((m) => ({ ...m, outgoing: false })) ?? []),
    ...(sent[role]?.map((m) => ({ ...m, outgoing: true })) ?? [])]
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  function changeRole(nextRole: Role) {
    if (nextRole === role || sending) return;
    setRole(nextRole);
    setText('');
    setImage(undefined);
    setNotice('');
    if (photoInput.current) photoInput.current.value = '';
  }
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!text.trim() && !image) return;
    const form = event.currentTarget;
    setNotice('');
    setSending(true);
    try {
      const photo = image ? await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(image);
      }) : undefined;
      const response = await fetch('/api/demo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: crypto.randomUUID(), role, text, image: photo }),
      });
      if (!response.ok) throw new Error('Message could not be accepted. Check the photo size.');
      const latest = { body: text || 'Photo attached', created_at: new Date().toISOString() };
      setSent((current) => ({ ...current, [role]: [...(current[role] ?? []), latest] }));
      setText('');
      setImage(undefined);
      form.reset();
    } catch (err) { setNotice(err instanceof Error ? err.message : 'Message could not be sent.'); }
    finally { setSending(false); }
  }
  const mode = health.data?.mode;
  const live = mode && mode !== 'demo';
  return <div className={demoStyles.surface}>
    <Header workspace demo={mode === 'demo'} multiAgent={health.data?.agentMode === 'multi'} />
    <main>
      <section className={demoStyles.intro} aria-labelledby="workspace-title">
        <div className={demoStyles.container}>
          <p className={demoStyles.eyebrow}>Repair workspace</p>
          <h1 id="workspace-title">{live ? 'Signoff' : <>From report to <em>repair.</em></>}</h1>
          {live ? <p>{mode === 'photon-test'
            ? 'Text your assigned iMessage line to start.'
            : 'Text your building’s repair line to report a leak. Open a work-order link from your conversation to view its evidence.'}</p>
            : <p>{data ? 'Send a report as the tenant, then switch to the manager to schedule a visit.'
              : error || health.error || 'Loading workspace…'}</p>}
        </div>
      </section>
      {!live && data && <div className={`${demoStyles.container} ${demoStyles.grid}`}>
        <section className={demoStyles.card} aria-labelledby="conversations-title">
          <div className={demoStyles.cardHeader}>
            <h2 id="conversations-title">Conversations</h2>
            <div className={demoStyles.sender}>
              <span id="sender-title">Send as</span>
              <div className={demoStyles.roles} role="group" aria-labelledby="sender-title">
                {([['tenant', 'Tenant'], ['manager', 'Manager'], ['tenant2', 'Tenant 2']] as const).map(([id, label]) =>
                  <button key={id} type="button" aria-pressed={role === id} disabled={sending} onClick={() => changeRole(id)}>{label}</button>,
                )}
              </div>
            </div>
          </div>
          <div className={demoStyles.thread} role="log" aria-label="Repair messages" aria-live="polite" tabIndex={0}>{messages.length ? messages.map((msg, index) =>
            <p key={`${msg.created_at}-${index}`} className={msg.outgoing ? demoStyles.outgoing : demoStyles.incoming}>{msg.body}</p>,
          ) : <div className={demoStyles.threadEmpty}>
            <span className={demoStyles.conversationIcon} aria-hidden="true" />
            <p>Send a message to start the conversation.</p>
          </div>}</div>
          <form onSubmit={send} className={demoStyles.composer}>
            <div className={demoStyles.examples} role="group" aria-label="Example messages">{choices.map((choice) =>
              <button type="button" key={choice} onClick={() => setText(choice)}>{choice}</button>,
            )}</div>
            <label htmlFor="message" className="sr-only">Message</label>
            <textarea id="message" placeholder="Write a message…" value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={2000} />
            <div className={demoStyles.sendActions}>
              <label className={demoStyles.attachment}>
                <input ref={photoInput} id="photo" type="file" className="sr-only" aria-label="Attach a photo" accept="image/jpeg,image/png,image/webp" onChange={(e) => {
                  const chosen = e.target.files?.[0];
                  if (chosen && chosen.size > 4 * 1024 * 1024) { setNotice('Choose a photo under 4 MB.'); setImage(undefined); e.target.value = ''; return; }
                  setNotice(''); setImage(chosen);
                }} />
                <span title={image?.name}>{image?.name ?? 'Attach a photo'}</span>
              </label>
              <button className={demoStyles.send} disabled={sending || (!text.trim() && !image)}>Send</button>
            </div>
            {notice && <p className={demoStyles.notice} role="status">{notice}</p>}
          </form>
        </section>
        <section className={`${demoStyles.card} ${demoStyles.orders}`} aria-labelledby="orders-title">
          <div className={demoStyles.cardHeader}><h2 id="orders-title">Work orders</h2></div>
          {data.orders.length ? <ul className={demoStyles.orderList}>{data.orders.map((order) => <li key={order.id}>
            <a className={demoStyles.orderRow} href={`/work-orders/${order.access_key}`}>
              <span><strong>L-{order.id} · Ceiling leak</strong><small>View inspection evidence</small></span><Badge status={order.status} />
            </a>
          </li>)}</ul> : <div className={demoStyles.ordersEmpty}>
            <span className={demoStyles.documentIcon} aria-hidden="true" />
            <p><strong>No work orders yet</strong></p>
            <p>New reports appear here once the location is confirmed.</p>
          </div>}
        </section>
      </div>}
    </main>
  </div>;
}
export function SharedReport({ access }: { access: string }) {
  const url = `/api/reports/${encodeURIComponent(access)}`;
  const { data, error } = usePoll<{ id: string; status: Status; issue: string; guidance: string; effects: string;
    area?: Area; building?: BuildingEvidence; renderStatus?: string }>(url);
  const building = data?.building;
  return <><Header /><main className="page">{data ? <>
    <section className="heading"><div><p className="eyebrow">Work order L-{data.id}</p><h1>{data.issue === 'leak' ? 'Water leak' : 'Building damage'}</h1></div><Badge status={data.status} /></section>
    <section className="panel evidence"><div className="panel-head"><div><h2>Temporary protection</h2><p>{data.guidance}</p></div></div>
      {data.renderStatus === 'ready' ? <div className="roof-image"><img src={`${url}/render`} alt="3D guide showing temporary protection and what maintenance should repair" /></div>
        : data.renderStatus === 'queued' && <p className="caption">Generating the 3D diagram…</p>}</section>
    <Neighborhood area={data.area} />
    <section className="panel evidence">
      <div className="panel-head"><h2>CoStar Group building evidence</h2></div>
      {building ? <dl className="attributes">
        {building.buildingType && <div><dt>Property type</dt><dd>{building.propertySubtype ?? building.buildingType}</dd></div>}
        <div><dt>Above-grade floors</dt><dd>{building.storiesAboveGrade}</dd></div>
        {building.buildingAreaSqFt && <div><dt>Building area</dt><dd>{building.buildingAreaSqFt.toLocaleString('en-US')} sq ft</dd></div>}
        {building.yearBuilt && <div><dt>Year built</dt><dd>{building.yearBuilt}</dd></div>}
        {building.hasMatterport && <div><dt>Matterport</dt><dd>{building.roomLabel ?? 'Verified building model'}{building.roomEvidence?.areaSqFt && ` · ${building.roomEvidence.areaSqFt.toLocaleString('en-US')} sq ft measured`}</dd></div>}
        {building.hasVexcel && <div><dt>Vexcel</dt><dd>{building.captureDate ? `Roof image captured ${building.captureDate}` : 'Roof evidence available to maintenance'}</dd></div>}
      </dl> : <p className="caption">CoStar building evidence is unavailable for this address.</p>}
    </section>
    <p className="inspection"><strong>Possible effects</strong> {data.effects}</p>
  </> : <p role="status">{error || 'Loading the repair report…'}</p>}</main></>;
}
