import Image from 'next/image';
import Link from 'next/link';
import { SignoffLogo } from '../brand/SignoffLogo';
import scheduledWorkOrder from './assets/scheduled-work-order.webp';
import { PhonePreview } from './PhonePreview';
import { RepairExample } from './RepairExample';
import styles from './landing.module.css';

const steps = [
  { title: 'Text a photo', description: 'Show what’s damaged and say where it is.' },
  { title: 'Get a visit time', description: 'Your manager reviews the report and texts you when someone can come by.' },
  { title: 'Confirm the fix', description: 'Reply when it’s fixed, or let your manager know if the problem is still there.' },
];

const roles = [
  { title: 'Tenants', description: 'Report damage and get updates from the same text thread.' },
  { title: 'Property managers', description: 'Review the original photo, schedule a visit, and keep the repair history in one work order.' },
  { title: 'Repair crews', description: 'Get the photo and reported location from the manager before the visit.' },
];

function Arrow({ down = false }: { down?: boolean }) {
  return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none" className={down ? styles.arrowDown : undefined}>
    <path d="M4 10h11m-4.5-4.5L15 10l-4.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

function BrandLink() {
  return <Link className={styles.brand} href="/" aria-label="Signoff home"><SignoffLogo /></Link>;
}

function HowItWorks() {
  return <section className={`${styles.wrap} ${styles.how}`} id="how" aria-labelledby="how-title">
    <div className={styles.sectionIntro}>
      <h2 id="how-title">What happens <em>after you text.</em></h2>
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
      <h2 id="workspace-title">Follow one <em>repair.</em></h2>
      <p>See what the tenant sends, what the manager receives, and how the work order closes.</p>
    </div>
    <RepairExample />
  </section>;
}

export default function Landing({ demo, previewOnly = false }: { demo: boolean; previewOnly?: boolean }) {
  const destination = previewOnly ? '#example' : '/app';
  const appLabel = previewOnly ? 'Explore the example' : demo ? 'Try the demo' : 'Open Signoff';
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
            <h1 id="headline">Report a repair. <em>See it through.</em></h1>
            <p className={styles.heroDescription}>Text a photo of the problem. Get the visit time and confirm the fix in the same conversation.</p>
            <div className={styles.actions}>
              <a className={styles.primary} href={destination}>{appLabel} <Arrow /></a>
              <a className={styles.secondary} href="#how">See how it works <Arrow down /></a>
            </div>
          </div>
          <div className={styles.heroStage}>
            <figure className={styles.heroWindow}>
              <figcaption><SignoffLogo /><span>Example work order</span></figcaption>
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
            <h2 id="proof-title">Tenants get the <em>final say.</em></h2>
            <p>When a manager marks a repair fixed, Signoff checks with everyone who reported it. If the problem is still there, a reply reopens the work order.</p>
          </div>
          <figure className={styles.comparison}>
            <div><div className={styles.beforePhoto} role="img" aria-label="A ceiling with a water stain above the window" /><span>Before</span></div>
            <div><div className={styles.afterPhoto} role="img" aria-label="The same ceiling repaired" /><span>After · Signed off</span></div>
            <figcaption>Illustrative repair example</figcaption>
          </figure>
        </div>
      </section>
      <section className={`${styles.wrap} ${styles.who}`} id="who" aria-labelledby="who-title">
        <h2 id="who-title">What each person <em>gets.</em></h2>
        <dl className={styles.roles}>
          {roles.map(({ title, description }) => <div key={title}>
            <dt>{title}</dt><dd>{description}</dd>
          </div>)}
        </dl>
      </section>
      <section className={`${styles.wrap} ${styles.finish}`} aria-labelledby="finish-title">
        <div className={styles.finishCard}>
          <div><h2 id="finish-title">Try it with a <em>sample repair.</em></h2>
            <p>{previewOnly ? 'Start with a ceiling leak and see how it gets resolved.' : demo ? 'Report damage as the tenant, schedule a visit as the manager, then switch back to confirm the fix.' : 'Start by texting your building’s repair line.'}</p></div>
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
