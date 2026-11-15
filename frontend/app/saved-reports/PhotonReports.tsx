import { useEffect, useState } from 'react';
import { errorMessage, request, RequestError, savedReportsOrigin, type Role } from './api';
import styles from './saved-reports.module.css';

type PhotonReport = { id: string; title: string; status: string; createdAt: string; url?: string };
type PhotonHistory = {
  state: 'unlinked' | 'pending' | 'linked';
  reports: PhotonReport[];
  code?: string;
  expiresAt?: string;
  syncing?: boolean;
};

const reportPath = /^\/reports\/[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
const verificationCode = /^[A-F\d]{32}$/;
const reportDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const expirationTime = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });
const statusLabels: Record<string, string> = {
  open: 'Open', scheduled: 'Scheduled', awaiting_confirmation: 'Awaiting tenant', closed: 'Closed',
};

function ReportEntry({ report }: { report: PhotonReport }) {
  const date = Date.parse(report.createdAt);
  const href = report.url && reportPath.test(report.url)
    ? (savedReportsOrigin() || window.location.origin) + report.url
    : undefined;
  return <li className={styles.photonReport}>
    <div>
      <h3>{report.title}</h3>
      {Number.isFinite(date) && <time className={styles.reportDate} dateTime={report.createdAt}>Reported {reportDate.format(date)}</time>}
      {href && <a className={styles.reportLink} href={href} rel="noreferrer" aria-label={`Open repair report: ${report.title}`}>Open repair report</a>}
    </div>
    <span className={styles.badge} data-status={report.status}>
      {Object.hasOwn(statusLabels, report.status) ? statusLabels[report.status] : 'Status unavailable'}
    </span>
  </li>;
}

export function PhotonReports({ role, onExpired }: { role: Role; onExpired: () => void }) {
  const [history, setHistory] = useState<PhotonHistory>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [linking, setLinking] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (linking) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polling = false;

    async function load() {
      try {
        const updated = await request<PhotonHistory>('/photon', { signal: controller.signal });
        if (controller.signal.aborted) return;
        setHistory(updated);
        setError('');
        polling = updated.state !== 'unlinked';
        if (polling) timer = setTimeout(load, updated.state === 'pending' || updated.syncing ? 3000 : 15000);
      } catch (failure) {
        if (controller.signal.aborted) return;
        if (failure instanceof RequestError && failure.status === 401) onExpired();
        else {
          setError(errorMessage(failure));
          if (polling) timer = setTimeout(load, 10000);
        }
      }
    }

    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [attempt, linking, onExpired]);

  async function linkAccount() {
    if (linking) return;
    setLinking(true);
    setError('');
    setNotice('');
    try {
      setHistory(await request<PhotonHistory>('/photon', { method: 'POST' }));
    } catch (failure) {
      if (failure instanceof RequestError && failure.status === 401) onExpired();
      else setError(errorMessage(failure));
    } finally {
      setLinking(false);
    }
  }

  const code = history?.state === 'pending' && history.code && verificationCode.test(history.code) ? history.code : '';
  const command = code ? `${role === 'tenant' ? '@signoff ' : ''}LINK ${code}` : '';
  const expiresAt = Date.parse(history?.expiresAt ?? '');

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(command);
      setNotice('Message copied. Send it in your Signoff conversation.');
    } catch {
      setNotice('Select the verification message and copy it manually.');
    }
  }

  return <section className={`${styles.card} ${styles.photonCard}`} aria-labelledby="photon-reports-title">
    <h2 id="photon-reports-title">Reports from texting</h2>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {!history ? error
      ? <button type="button" onClick={() => { setError(''); setAttempt(value => value + 1); }}>Try again</button>
      : <p role="status">Checking your messaging account…</p>
      : history.state === 'linked' ? <>
        <p className={styles.muted}>{role === 'tenant' ? 'Reports sent from your verified messaging account.' : 'Reports for your assigned property.'}</p>
        {history.syncing ? <p className={styles.photonEmpty} role="status">Updating reports…</p> :
          history.reports.length ? <ul className={styles.photonList}>
          {history.reports.map(report => <ReportEntry key={report.id} report={report} />)}
        </ul> : <p className={styles.photonEmpty}>No text reports are available yet. New reports will appear here.</p>}
      </> : <div className={styles.linkControls}>
        {command ? <>
          <p>Send this message from your enrolled {role === 'tenant' ? 'tenant' : 'landlord'} account in your usual Signoff conversation.{Number.isFinite(expiresAt) && <> The code expires at <time dateTime={history.expiresAt}>{expirationTime.format(expiresAt)}</time>.</>}</p>
          <label className={styles.linkMessage}>Verification message<input readOnly value={command} /></label>
          <button type="button" onClick={copyMessage}>Copy message</button>
          <p className={styles.muted} role="status">{notice || 'Waiting for your message…'}</p>
        </> : <>
          <p>{history.state === 'pending'
            ? 'A code was issued for this session. Select Show code to view it.'
            : 'Link the messaging account you use with Signoff to see your text reports.'}</p>
          <button type="button" onClick={linkAccount} disabled={linking}>
            {linking ? 'Getting code…' : history.state === 'pending' ? 'Show code' : 'Link messaging account'}
          </button>
        </>}
      </div>}
  </section>;
}
