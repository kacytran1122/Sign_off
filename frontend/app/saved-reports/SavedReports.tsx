'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { SignoffLogo } from '../../brand/SignoffLogo';
import styles from './saved-reports.module.css';

type Role = 'tenant' | 'landlord';
type Status = 'received' | 'scheduled' | 'fixed';
type Report = {
  id: string;
  title: string;
  description: string;
  status: Status;
  createdAt: string;
  updatedAt: string;
};

const statuses: Record<Status, string> = { received: 'Received', scheduled: 'Scheduled', fixed: 'Fixed' };
const accountName: Record<Role, string> = { tenant: 'Tenant account', landlord: 'Landlord account' };
const reportDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

class RequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function request<T>(path = '', options?: RequestInit): Promise<T> {
  const configuredOrigin = process.env.NEXT_PUBLIC_SAVED_REPORTS_ORIGIN ?? '';
  const origin = window.location.hostname === process.env.NEXT_PUBLIC_SAVED_REPORTS_FALLBACK_HOST
    ? process.env.NEXT_PUBLIC_SAVED_REPORTS_FALLBACK_ORIGIN ?? configuredOrigin
    : configuredOrigin;
  const response = await fetch(`${origin.replace(/\/$/, '')}/api/saved-reports${path}`, {
    ...options, credentials: 'include', cache: 'no-store',
    headers: options?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const data = await response.json().catch(() => undefined);
  if (!response.ok) throw new RequestError(data?.error ?? 'The report service is temporarily unavailable.', response.status);
  return data;
}

function errorMessage(error: unknown) {
  return error instanceof RequestError ? error.message : 'Could not reach Signoff. Try again in a moment.';
}

function SavedReport({ report, role, onUpdate }: {
  report: Report;
  role: Role;
  onUpdate: (id: string, status: Status) => Promise<void>;
}) {
  const [updating, setUpdating] = useState(false);

  async function update(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (updating) return;
    const status = new FormData(event.currentTarget).get('status') as Status;
    setUpdating(true);
    try { await onUpdate(report.id, status); }
    finally { setUpdating(false); }
  }

  return <details className={styles.report}>
    <summary>
      <span><strong>{report.title}</strong><span className={styles.reportDate}>Reported {reportDate.format(new Date(report.createdAt))}</span></span>
      <span className={styles.badge} data-status={report.status}>{statuses[report.status]}</span>
    </summary>
    <div className={styles.reportDetail}>
      <p>{report.description}</p>
      <p className={styles.reportDate}>Last updated {reportDate.format(new Date(report.updatedAt))}</p>
      {role === 'landlord' && <form onSubmit={update} className={styles.update}>
        <label>Report status
          <select key={report.status} name="status" defaultValue={report.status} disabled={updating}>
            {Object.entries(statuses).map(([status, label]) => <option key={status} value={status}>{label}</option>)}
          </select>
        </label>
        <button type="submit" disabled={updating}>{updating ? 'Updating…' : 'Update status'}</button>
      </form>}
    </div>
  </details>;
}

function Workspace({ role, onExpired }: { role: Role; onExpired: () => void }) {
  const [reports, setReports] = useState<Report[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void request<{ reports: Report[] }>('', { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setReports(data.reports); })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        if (failure instanceof RequestError && failure.status === 401) onExpired();
        else setError(errorMessage(failure));
      });
    return () => controller.abort();
  }, [attempt, onExpired]);

  function handleError(failure: unknown) {
    if (failure instanceof RequestError && failure.status === 401) onExpired();
    else setError(errorMessage(failure));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { report } = await request<{ report: Report }>('', {
        method: 'POST',
        body: JSON.stringify({ title: String(fields.get('title') ?? '').trim(), description: String(fields.get('description') ?? '').trim() }),
      });
      setReports(current => [report, ...(current ?? [])]);
      form.reset();
      setNotice('Report saved.');
    } catch (failure) {
      handleError(failure);
    } finally {
      setSaving(false);
    }
  }

  async function updateReport(id: string, status: Status) {
    setNotice('');
    setError('');
    try {
      const { report } = await request<{ report: Report }>(`/${encodeURIComponent(id)}`, {
        method: 'PATCH', body: JSON.stringify({ status }),
      });
      setReports(current => current?.map(entry => entry.id === report.id ? report : entry) ?? []);
      setNotice('Report status updated.');
    } catch (failure) {
      handleError(failure);
    }
  }

  return <>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    {reports === null ? <section className={styles.card} aria-label="Saved reports">
      {error
        ? <button type="button" onClick={() => { setError(''); setAttempt(value => value + 1); }}>Try again</button>
        : <p role="status">Loading your saved reports…</p>}
    </section> : <div className={`${styles.workspace} ${role === 'tenant' ? styles.tenantWorkspace : ''}`}>
      {role === 'tenant' && <section className={styles.card} aria-labelledby="new-report-title">
        <h2 id="new-report-title">New report</h2>
        <form className={styles.form} onSubmit={save}>
          <label>Report title<input name="title" required maxLength={120} placeholder="Ceiling leak" /></label>
          <label>Description<textarea name="description" required maxLength={3000} rows={5} /></label>
          <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save report'}</button>
        </form>
      </section>}
      <section className={styles.card} aria-labelledby="reports-title">
        <h2 id="reports-title">Saved reports</h2>
        {reports.length ? <div className={styles.reportList}>{reports.map(report =>
          <SavedReport key={report.id} report={report} role={role} onUpdate={updateReport} />
        )}</div> : <p className={styles.muted}>
          {role === 'tenant' ? 'Reports you save will appear here.' : 'Reports shared with this account will appear here.'}
        </p>}
      </section>
    </div>}
  </>;
}

export default function SavedReports() {
  const [role, setRole] = useState<Role | null | undefined>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void request<{ role: Role | null }>('/session', { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setRole(data.role); })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(failure));
      });
    return () => controller.abort();
  }, [attempt]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    setBusy(true);
    setError('');
    try {
      const data = await request<{ role: Role }>('/session', {
        method: 'POST', body: JSON.stringify({ username: fields.get('username'), password: fields.get('password') }),
      });
      form.reset();
      setRole(data.role);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    setError('');
    try {
      await request('/session', { method: 'DELETE' });
      setRole(null);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  const expireSession = useCallback(() => {
    setRole(null);
    setError('Your session expired. Sign in again to see your saved reports.');
  }, []);

  return <div className={styles.surface}>
    <header className={styles.header}><nav className={styles.headerInner} aria-label="Main navigation">
      <a href="/" aria-label="Signoff home"><SignoffLogo /></a>
      {role && <div className={styles.account}>
        <span>{accountName[role]}</span>
        <button type="button" className={styles.secondary} disabled={busy} onClick={signOut}>Sign out</button>
      </div>}
    </nav></header>
    <main className={styles.main}>
      <div className={styles.headline}>
        <h1>Repair reports</h1>
        <p>{role === 'landlord'
          ? 'Review tenant reports and update the repair status.'
          : role === 'tenant' ? 'Save a report and check its repair status here.'
            : 'Sign in to see your saved repair reports.'}</p>
        <p className={styles.accountNote}>These are shared test accounts. Use them for reports without personal details.</p>
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {role === undefined ? <div className={`${styles.card} ${styles.signIn}`}>
        {error
          ? <button type="button" onClick={() => { setError(''); setAttempt(value => value + 1); }}>Try again</button>
          : <p role="status">Checking your session…</p>}
      </div> : role ? <Workspace role={role} onExpired={expireSession} /> :
        <section className={`${styles.card} ${styles.signIn}`} aria-labelledby="sign-in-title">
          <h2 id="sign-in-title">Sign in</h2>
          <form className={styles.form} onSubmit={signIn}>
            <label>Username<input name="username" required autoComplete="username" autoCapitalize="none" spellCheck={false} /></label>
            <label>Password<input name="password" type="password" required autoComplete="current-password" /></label>
            <button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          </form>
        </section>}
    </main>
  </div>;
}
