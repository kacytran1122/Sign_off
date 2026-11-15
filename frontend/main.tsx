import 'vite/modulepreload-polyfill';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type { Showcase } from '@matterport/sdk';
import './style.css';

type Landmark = {
  id: string; label: string; suite: string;
  anchor?: { x: number; y: number; z: number };
  stem?: { x: number; y: number; z: number };
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
  reports: { id: string; landmark_id: string; description: string; has_photo: boolean }[];
  timeline: { action: string; detail: string; created_at: string }[];
};
type Area = {
  latitude?: number; longitude?: number; city?: string; error?: string; timeZone?: string; store?: string;
  weather?: { current: { temperature_2m: number; apparent_temperature: number; relative_humidity_2m: number };
    daily: { time: string[]; apparent_temperature_max: (number | null)[] } };
  coverage?: { start_date: string; through_date: string; indicators: { water: number; waste: number } };
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
  closed: 'Work order closed', tenant_confirmed: 'Tenant confirmed', photo_added: 'Photo added',
};

function usePoll<T>(url: string) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    let fetching = false;
    async function refresh() {
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
    }
    void refresh();
    const timer = setInterval(refresh, 1500);
    return () => { controller.abort(); clearInterval(timer); };
  }, [url]);
  return { data, error };
}

function Header({ demo }: { demo?: boolean }) {
  return <header className="topbar"><div className="topbar-inner">
    <div className="brand"><span className="brand-mark" aria-hidden="true">+</span>Signoff</div>
    {demo && <a className="demo-label" href="/">Local demo</a>}
  </div></header>;
}
function Badge({ status }: { status: Status }) {
  return <span className={`badge ${status}`}>{statuses[status]}</span>;
}

function Interior({ ticket, active }: { ticket: Ticket; active: Landmark }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const added = useRef(new Set<string>());
  const [sdk, setSdk] = useState<Showcase>();
  const [message, setMessage] = useState('');
  const [walking, setWalking] = useState(false);
  const { matterportKey } = ticket;
  const model = ticket.property.matterportModel;
  const showcaseUrl = model && matterportKey
    ? `https://my.matterport.com/show/?${new URLSearchParams({ m: model, play: '1', applicationKey: matterportKey })}`
    : undefined;
  const locationIds = [...new Set(ticket.reports.map((report) => report.landmark_id))].join(',');
  useEffect(() => {
    if (!model || !matterportKey || !frame.current) return;
    const iframe = frame.current;
    let live = true;
    void import('@matterport/sdk').then(({ setupSdk }) =>
      setupSdk(matterportKey, { iframe }),
    ).then((client) => { if (live) setSdk(client); })
      .catch(() => { if (live) setMessage('The interactive viewer could not connect. Check the model and allowed domain.'); });
    return () => { live = false; };
  }, [model, matterportKey]);
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
      const sweeps = ticket.sponsorRehearsal ? (await sdk.Model.getData()).sweeps : [];
      const normalize = (id: string) => id.replaceAll('-', '');
      for (const view of active.views) {
        const sweep = sweeps.find(({ sid, uuid }) =>
          [sid, uuid].some((id) => id && normalize(id) === normalize(view.sweep)),
        );
        await sdk.Sweep.moveTo(sweep?.sid ?? view.sweep, { rotation: view.rotation, transition: 'transition.fade' });
      }
      if (ticket.sponsorRehearsal && active.anchor && sdk.Camera.lookAt) await sdk.Camera.lookAt(active.anchor);
    } catch { setMessage('This walkthrough could not reach its saved viewpoint.'); }
    finally { setWalking(false); }
  }
  return <section className="panel evidence">
    <div className="panel-head"><div><h2>Reported location</h2><p>{ticket.sponsorRehearsal ? active.suite : `Suite ${active.suite}`} · {active.label}</p></div>
      {model && <button className="small" disabled={!sdk || walking} onClick={walk}>{walking ? 'Moving…' : 'Walk to report'}</button>}</div>
    {model ? <iframe className="showcase" title="Matterport inspection model" src={showcaseUrl}
      allow="fullscreen; xr-spatial-tracking; autoplay" referrerPolicy="origin" ref={frame} />
      : <div className="diagram interior" role="img" aria-label={`Demo floor plan. Marker at ${active.label}`}>
        <div className="room west-north">Conference</div><div className="room east-north">Reception</div>
        <div className="room west-south">Studio</div><div className="room east-south">Office</div>
        <div className="hall">Hall</div>
        <span className="pin" style={{ left: `${(active.diagramPoint?.[0] ?? .5) * 100}%`, top: `${(active.diagramPoint?.[1] ?? .5) * 100}%` }} />
      </div>}
    {message && <p className="notice" role="status">{message}</p>}
  </section>;
}

function Roof({ ticket, zone }: { ticket: Ticket; zone: Ticket['property']['zones'][number] }) {
  const { roof } = ticket.property;
  return <section className="panel evidence">
    <div className="panel-head"><div><h2>Suggested inspection area</h2><p>{zone.label}{roof.captureDate && ` · Captured ${roof.captureDate}`}</p></div></div>
    <div className={`roof-image ${roof.imageUrl ? '' : 'diagram roof-diagram'}`}>
      {roof.imageUrl ? <img src={roof.imageUrl} alt="Vexcel aerial view of the property roof" /> : <div className="roof-shape" />}
      <svg className="roof-zone" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label={`Highlighted zone: ${zone.label}`} role="img">
        {roof.outline && <polygon className="roof-outline" points={roof.outline.map(([x, y]) => `${x * 100},${y * 100}`).join(' ')} />}
        <polygon points={zone.polygon.map(([x, y]) => `${x * 100},${y * 100}`).join(' ')} />
      </svg>
    </div>
    <p className="caption">The location gives the vendor a place to inspect. The cause is pending inspection.</p>
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
  const canMap = area?.latitude !== undefined && area.longitude !== undefined;
  const map = canMap ? `${area.longitude! - .012},${area.latitude! - .008},${area.longitude! + .012},${area.latitude! + .008}` : '';
  const weather = area?.weather;
  return <section className="panel evidence neighborhood">
    <div className="panel-head"><div><h2>Neighborhood conditions</h2><p>{area?.city || 'Location and outdoor conditions'}</p></div></div>
    {map && <div><iframe className="area-map" title="OpenStreetMap neighborhood map" loading="lazy" referrerPolicy="origin"
      src={`https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(map)}&layer=mapnik`} />
      <p className="caption"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a></p></div>}
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
      <div><h3>Conditions that attract rodents</h3>
        {area.coverage && <p>{area.coverage.indicators.water} water-related and {area.coverage.indicators.waste} waste-related 311 reports within 1 km from {area.coverage.start_date} to {area.coverage.through_date}.</p>}
        <p>These records do not establish whether mice or rats are at the building. Tell maintenance if you see rodents, droppings or gnaw marks.</p>
        {area.coverage && <p className="caption"><a href={area.city === 'LOS ANGELES' ? 'https://data.lacity.org/d/2cy6-i7zn' : 'https://my311.houstontx.gov/servicerequestdata.html'} target="_blank" rel="noreferrer">City 311 records</a></p>}
      </div>
    </div>}
  </section>;
}
function WorkOrder({ access }: { access: string }) {
  const { data, error } = usePoll<Ticket>(`/api/work-orders/${encodeURIComponent(access)}`);
  const [selected, setSelected] = useState<string>();
  if (!data) return <><Header /><main className="page"><p role="status">{error || 'Loading work order…'}</p></main></>;
  const activeReport = data.reports.find((report) => report.id === selected) ?? data.reports[0];
  const active = data.property.landmarks.find((point) => point.id === activeReport?.landmark_id);
  const zone = data.property.zones.find((roof) => roof.id === data.zoneId);
  const plan = data.plans?.find((item) => item.landmarkId === active?.id);
  return <><Header demo={data.demo} /><main className="page">
    <section className="heading">
      <div><p className="eyebrow">Work order L-{data?.id}</p><h1>{data.repair?.issue === 'damage' ? 'Building damage' : data.repair ? 'Water leak' : 'Ceiling leak'}</h1>
        <p className="subtitle">{data.property.name} · {data.photonTest && !data.sponsorRehearsal ? 'Fictional property for live messaging test' : data.repair?.address ?? data.property.address}</p>
        {data.sponsorRehearsal && <p className="subtitle">Demo work order</p>}</div>
      <Badge status={data.status} />
    </section>
    {error && <p role="status" className="notice">{error}</p>}
    {data.visitStart && data.visitEnd && <p className="inspection"><strong>Inspection</strong> {dateTime(data.visitStart, data.property.timeZone)} to {dateTime(data.visitEnd, data.property.timeZone)} · {data.property.timeZone}</p>}
    {plan && <InspectionPlan plan={plan} property={data.property} />}
    {active && zone && <div className="evidence-grid"><Interior ticket={data} active={active} /><Roof ticket={data} zone={zone} /></div>}
    {data.repair && <Neighborhood area={data.repair.area} />}
    {data.repair && <p className="inspection"><strong>Possible effects</strong> {data.repair.effects}</p>}
    {data.renderStatus && !data.repair && <section className="panel evidence">
      <div className="panel-head"><div><h2>3D inspection schematic</h2><p>Illustration of the ceiling report and suggested roof inspection area.</p></div></div>
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
function DemoPage() {
  const { data, error } = usePoll<Demo>('/api/demo');
  const [role, setRole] = useState<Role>('tenant');
  const [text, setText] = useState('');
  const [image, setImage] = useState<File>();
  const [notice, setNotice] = useState('');
  const health = usePoll<{mode: 'live' | 'photon-test' | 'demo'}>('/healthz');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<Record<string, { body: string; created_at: string }[]>>({});
  const choices = role === 'manager' ? ['Tuesday 2 to 4 PM', 'YES', 'FIXED']
    : role === 'tenant2' ? ['Water stain by the studio window', 'Still leaking', 'Resolved']
      : ['Ceiling stain by the window', '1', 'Still leaking', 'Resolved'];
  const handle = `${role}@demo.invalid`;
  const messages = [...(data?.messages.filter((m) => m.target === handle).map((m) => ({ ...m, outgoing: false })) ?? []),
    ...(sent[role]?.map((m) => ({ ...m, outgoing: true })) ?? [])]
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
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
  if (health.data && health.data.mode !== 'demo') return <><Header /><main className="page">
    <section className="heading"><div><h1>Signoff</h1>
      <p className="subtitle">{health.data.mode === 'photon-test'
        ? 'Live iMessage test with a fictional property. Text your assigned line to start.'
        : 'Text your building’s repair line to report a leak. Open a work-order link from your conversation to view its evidence.'}</p></div></section>
  </main></>;
  return <><Header demo={!!data} /><main className="page">
    <section className="heading">
      <div><p className="eyebrow">Repair workflow</p><h1>From report to repair.</h1>
        <p className="subtitle">{data ? 'Local rehearsal with a fictional property and simulated messages.' : error || 'Loading workspace…'}</p></div>
    </section>
    {data && <div className="demo-grid">
      <section className="panel composer">
        <div className="panel-head"><h2>Conversations</h2></div>
        <div className="roles" aria-label="Simulated sender">{([['tenant', 'Tenant'], ['manager', 'Manager'], ['tenant2', 'Tenant 2']] as const).map(([id, label]) =>
          <button key={id} type="button" aria-pressed={role === id} onClick={() => { setRole(id); setText(''); }}>{label}</button>,
        )}</div>
        <div className="thread" role="log" aria-live="polite">{messages.length ? messages.map((msg, index) =>
          <p key={`${msg.created_at}-${index}`} className={msg.outgoing ? 'bubble outgoing' : 'bubble'}>{msg.body}</p>,
        ) : <p className="empty">Send a message to start the conversation.</p>}</div>
        <form onSubmit={send} className="send-form">
          <div className="examples" aria-label="Example messages">{choices.map((choice) =>
            <button type="button" key={choice} onClick={() => setText(choice)}>{choice}</button>,
          )}</div>
          <label htmlFor="message" className="sr-only">Message</label>
          <textarea id="message" placeholder="Write a message…" value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={2000} />
          <div className="send-actions"><input id="photo" type="file" aria-label="Attach a photo" accept="image/jpeg,image/png,image/webp" onChange={(e) => {
            const chosen = e.target.files?.[0];
            if (chosen && chosen.size > 4 * 1024 * 1024) { setNotice('Choose a photo under 4 MB.'); setImage(undefined); e.target.value = ''; return; }
            setNotice(''); setImage(chosen);
          }} /><button className="primary" disabled={sending || (!text.trim() && !image)}>Send</button></div>
          {notice && <p className="notice" role="status">{notice}</p>}
        </form>
      </section>
      <section className="panel orders"><div className="panel-head"><h2>Work orders</h2></div>
        {data.orders.length ? data.orders.map((order) => <a key={order.id} className="order-row" href={`/work-orders/${order.access_key}`}>
          <span><strong>L-{order.id} · Ceiling leak</strong><small>View inspection evidence</small></span><Badge status={order.status} />
        </a>) : <p className="empty">New reports appear here once the location is confirmed.</p>}
      </section>
    </div>}
  </main></>;
}
const match = /^\/work-orders\/([^/]+)\/?$/.exec(location.pathname);
const shared = /^\/reports\/([^/]+)\/?$/.exec(location.pathname);
function SharedReport({ access }: { access: string }) {
  const url = `/api/reports/${encodeURIComponent(access)}`;
  const { data, error } = usePoll<{ id: string; status: Status; issue: string; guidance: string; effects: string; area?: Area; renderStatus?: string }>(url);
  return <><Header /><main className="page">{data ? <>
    <section className="heading"><div><p className="eyebrow">Work order L-{data.id}</p><h1>{data.issue === 'leak' ? 'Water leak' : 'Building damage'}</h1></div><Badge status={data.status} /></section>
    <section className="panel evidence"><div className="panel-head"><div><h2>Temporary protection</h2><p>{data.guidance}</p></div></div>
      {data.renderStatus === 'ready' ? <div className="roof-image"><img src={`${url}/render`} alt="3D guide showing temporary protection and what maintenance should repair" /></div>
        : data.renderStatus === 'queued' && <p className="caption">Generating the 3D diagram…</p>}</section>
    <Neighborhood area={data.area} />
    <p className="inspection"><strong>Possible effects</strong> {data.effects}</p>
  </> : <p role="status">{error || 'Loading the repair report…'}</p>}</main></>;
}
createRoot(document.getElementById('root')!).render(match ? <WorkOrder access={match[1]} /> : shared ? <SharedReport access={shared[1]} /> : <DemoPage />);
