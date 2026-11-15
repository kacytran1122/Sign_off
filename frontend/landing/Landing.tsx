import Image from 'next/image';
import Link from 'next/link';
import { SignoffLogo } from '../brand/SignoffLogo';
import scheduledWorkOrder from './assets/scheduled-work-order.webp';
import { PhonePreview } from './PhonePreview';
import { RepairExample } from './RepairExample';
import styles from './landing.module.css';

const steps = [
  { title: 'Text a photo', description: 'Show what’s damaged and tell Signoff where you see it.' },
  { title: 'Schedule the repair', description: 'The manager reviews the report and shares the visit window.' },
  { title: 'Confirm it’s fixed', description: 'Reply to close the work order, or reopen it if the problem persists.' },
];

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
  return <Link className={styles.brand} href="/" aria-label="Signoff home"><SignoffLogo variant="light" /></Link>;
}

function HowItWorks() {
  return <section className={`${styles.wrap} ${styles.how}`} id="how" aria-labelledby="how-title">
    <div className={styles.sectionIntro}>
      <p className={styles.eyebrow}>How it works</p>
      <h2 id="how-title">From your first text to a <em>confirmed fix.</em></h2>
      <p>Send a photo by text. Your manager schedules a visit, then you confirm the fix.</p>
    </div>
    <ol className={styles.steps}>
      {steps.map(({ title, description }, index) => <li key={title} className={styles.step}>
        <span className={styles.stepNumber} aria-hidden="true">{index + 1}</span>
        <div><h3>{title}</h3><p>{description}</p></div>
      </li>)}
    </ol>
  </section>;
}

function WorkspaceShowcase() {
  return <section className={`${styles.wrap} ${styles.workspaceShowcase}`} id="example" aria-labelledby="workspace-title">
    <div className={styles.workspaceIntro}>
      <p className={styles.eyebrow}>Explore a repair</p>
      <h2 id="workspace-title">See the repair <em>in Signoff.</em></h2>
      <p>Switch between the tenant report, the manager’s work order, and the final confirmation.</p>
    </div>
    <RepairExample />
  </section>;
}

export default function Landing({ demo, previewOnly = false }: { demo: boolean; previewOnly?: boolean }) {
  const destination = previewOnly ? '#example' : '/app';
  const appLabel = previewOnly ? 'Explore the demo' : demo ? 'Try the demo' : 'Open Signoff';
  return <div className={styles.landing}>
    <a className={styles.skipLink} href="#content">Skip to content</a>
    <header className={styles.header}>
      <nav className={`${styles.wrap} ${styles.navigation}`} aria-label="Main navigation">
        <BrandLink />
        <div className={styles.navLinks}><a href="#how">How it works</a><a href="#who">Who it’s for</a></div>
        <a className={styles.primary} href={destination}>{previewOnly ? 'See the demo' : 'Get started'} <Arrow /></a>
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
              <a className={styles.primary} href={destination}>{appLabel} <Arrow /></a>
              <a className={styles.secondary} href="#how">See how it works <Arrow down /></a>
            </div>
          </div>
          <div className={styles.heroStage}>
            <figure className={styles.heroWindow}>
              <figcaption><SignoffLogo variant="light" /><span>Example work order</span></figcaption>
              <Image src={scheduledWorkOrder} alt="Example Signoff work order with the scheduled visit and inspection area" preload unoptimized />
            </figure>
            <div className={styles.heroPhone}><PhonePreview /></div>
          </div>
        </div>
      </section>
      <HowItWorks />
      <WorkspaceShowcase />
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
        <dl className={styles.roles}>
          {roles.map(({ title, description }) => <div key={title}>
            <dt>{title}</dt><dd>{description}</dd>
          </div>)}
        </dl>
      </section>
      <section className={`${styles.wrap} ${styles.finish}`} aria-labelledby="finish-title">
        <div className={styles.finishCard}>
          <div><h2 id="finish-title">See a repair <em>through.</em></h2>
            <p>{previewOnly ? 'Follow an example from the first photo to a confirmed repair.' : demo ? 'Report damage as the tenant, schedule a visit as the manager, then switch back to confirm the fix.' : 'Start by texting your building’s repair line.'}</p></div>
          <a className={styles.finalLink} href={destination}>{appLabel} <Arrow /></a>
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
