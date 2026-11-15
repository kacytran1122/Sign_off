import Link from 'next/link';
import { SignoffLogo } from '../brand/SignoffLogo';
import styles from './landing.module.css';

const roles = [
  { title: 'Tenants', description: 'Text a photo, follow the repair, and confirm when the problem is fixed.' },
  { title: 'Property managers', description: 'Get the original photo, the reported location, and a timeline you can share with your crew.' },
  { title: 'Repair crews', description: 'See what was reported and where to start when you arrive.' },
];

function Arrow({ down = false }: { down?: boolean }) {
  return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none" className={down ? styles.arrowDown : undefined}>
    <path d="M4 10h11m-4.5-4.5L15 10l-4.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

function BrandLink() {
  return <Link className={styles.brand} href="/" aria-label="Signoff home"><SignoffLogo /></Link>;
}

function PhonePreview() {
  return <figure className={styles.preview}>
    <div className={styles.phone}>
      <div className={styles.screen}>
        <div aria-hidden="true" className={styles.statusBar}>
          <span>9:41</span><i className={styles.sensor} />
          <svg width="38" height="12" viewBox="0 0 38 12" fill="none">
            <path d="M1 10V8m3 2V6m3 4V4m3 6V2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            <path d="M15 5a6 6 0 0 1 8 0m-6 2a3 3 0 0 1 4 0m-2 2h.01" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
            <rect x="27" y="3" width="9" height="6" rx="1.5" stroke="currentColor" />
            <path d="M29 5h5v2h-5zm8 0h1v2h-1z" fill="currentColor" />
          </svg>
        </div>
        <div className={styles.contact}>
          <SignoffLogo className={styles.contactLogo} compact />
          <strong>Signoff repair line</strong>
          <span>iMessage</span>
        </div>
        <div className={styles.thread}>
          <span className={styles.threadTime}>Today 9:41 AM</span>
          <div className={styles.outgoing}>
            <div className={styles.messagePhoto} role="img" aria-label="Ceiling stain above the living room window" />
            <p>Water stain above the living room window.</p>
          </div>
          <p className={styles.incoming}>I’ve sent the photo to your manager. The crew can visit Tuesday, 2–4 PM.</p>
          <p className={styles.incoming}>Your manager marked it fixed. Is the ceiling still leaking?</p>
          <p className={styles.outgoing}>Resolved. It’s dry now.</p>
          <p className={styles.signed}><SignoffLogo compact /> Signed off by tenant</p>
        </div>
        <i className={styles.homeBar} aria-hidden="true" />
      </div>
    </div>
    <figcaption>Example repair conversation</figcaption>
  </figure>;
}

function WorkOrderPreview() {
  return <div className={styles.workOrder} aria-label="Example work order">
    <div className={styles.workOrderHeader}><SignoffLogo /><span>Scheduled</span></div>
    <div className={styles.workOrderBody}>
      <strong>Ceiling stain by the window</strong>
      <span>Unit 2B · Living room</span>
      <div className={styles.floorPlan} aria-hidden="true"><span>Living room <i /></span><span>Kitchen</span><span>Entry</span></div>
    </div>
  </div>;
}

function HowItWorks() {
  return <section className={`${styles.wrap} ${styles.how}`} id="how" aria-labelledby="how-title">
    <div className={styles.sectionIntro}>
      <p className={styles.eyebrow}>How it works</p>
      <h2 id="how-title">Three steps. <em>No phone tag.</em></h2>
      <p>One text thread keeps everyone up to date from the first photo to the final confirmation.</p>
    </div>
    <ol className={styles.steps}>
      <li className={styles.step}>
        <div className={`${styles.stepVisual} ${styles.reportVisual}`}>
          <div className={styles.photoCard}><div className={styles.messagePhoto} role="img" aria-label="Example ceiling stain" />
            <p>Water stain by the window.</p></div>
        </div>
        <div className={styles.stepCopy}><h3>Text a photo</h3><p>Tell Signoff what’s damaged and where you see it.</p></div>
      </li>
      <li className={styles.step}>
        <div className={`${styles.stepVisual} ${styles.planVisual}`}><WorkOrderPreview /></div>
        <div className={styles.stepCopy}><h3>Schedule the repair</h3><p>The manager reviews the photo and shares the visit window.</p></div>
      </li>
      <li className={styles.step}>
        <div className={`${styles.stepVisual} ${styles.doneVisual}`}>
          <div className={styles.completion}><SignoffLogo compact /><strong>Signed off</strong><p>Confirmed by the tenant</p></div>
        </div>
        <div className={styles.stepCopy}><h3>Confirm it’s fixed</h3><p>Reply when it’s resolved, or reopen the work order in the same thread.</p></div>
      </li>
    </ol>
  </section>;
}

export default function Landing({ demo }: { demo: boolean }) {
  const appLabel = demo ? 'Try the demo' : 'Open Signoff';
  return <div className={styles.landing}>
    <a className={styles.skipLink} href="#content">Skip to content</a>
    <header className={styles.header}>
      <nav className={`${styles.wrap} ${styles.navigation}`} aria-label="Main navigation">
        <BrandLink />
        <div className={styles.navLinks}><a href="#how">How it works</a><a href="#who">Who it’s for</a></div>
        <Link className={styles.primary} href="/app">Get started <Arrow /></Link>
      </nav>
    </header>
    <main id="content" tabIndex={-1}>
      <section className={styles.hero} aria-labelledby="headline">
        <div className={`${styles.wrap} ${styles.heroGrid}`}>
          <div className={styles.heroCopy}>
            <p className={styles.heroKicker}>Building repairs over text</p>
            <h1 id="headline">The repair isn’t done until the tenant <em>says so.</em></h1>
            <p className={styles.heroDescription}>Report a problem with a photo. Follow the repair and confirm it’s fixed, all in one text thread.</p>
            <div className={styles.actions}>
              <Link className={styles.primary} href="/app">{appLabel} <Arrow /></Link>
              <a className={styles.secondary} href="#how">See how it works <Arrow down /></a>
            </div>
          </div>
          <PhonePreview />
        </div>
      </section>
      <HowItWorks />
      <section className={styles.proof} aria-labelledby="proof-title">
        <div className={`${styles.wrap} ${styles.proofGrid}`}>
          <div className={styles.proofCopy}>
            <h2 id="proof-title">Only the tenant can <em>close the job.</em></h2>
            <p>After the manager marks the repair fixed, Signoff checks with the tenant. If the problem returns, the tenant can reopen the work order with a text.</p>
          </div>
          <figure className={styles.comparison}>
            <div><div className={styles.beforePhoto} role="img" aria-label="A ceiling with a water stain above the window" /><span>Before</span></div>
            <div><div className={styles.afterPhoto} role="img" aria-label="The same ceiling repaired" /><span>After · Signed off</span></div>
            <figcaption>Illustrative repair example</figcaption>
          </figure>
        </div>
      </section>
      <section className={`${styles.wrap} ${styles.who}`} id="who" aria-labelledby="who-title">
        <h2 id="who-title">Who it’s for</h2>
        <div className={styles.roles}>
          {roles.map(({ title, description }) => <article key={title}>
            <SignoffLogo compact /><h3>{title}</h3><p>{description}</p>
          </article>)}
        </div>
      </section>
      <section className={`${styles.wrap} ${styles.finish}`} aria-labelledby="finish-title">
        <div className={styles.finishCard}>
          <div><h2 id="finish-title">See a repair <em>through.</em></h2>
            <p>{demo ? 'Report damage as the tenant, schedule a visit as the manager, then switch back to confirm the fix.' : 'Start by texting your building’s repair line.'}</p></div>
          <Link className={styles.finalLink} href="/app">{appLabel} <Arrow /></Link>
        </div>
      </section>
    </main>
    <footer className={styles.footer}>
      <div className={`${styles.wrap} ${styles.footerInner}`}>
        <BrandLink /><p>© 2026 Signoff</p><a href="#content">Back to top <Arrow down /></a>
      </div>
    </footer>
  </div>;
}
