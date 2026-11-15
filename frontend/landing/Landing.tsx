import Image from 'next/image';
import Link from 'next/link';
import { SignoffLogo } from '../brand/SignoffLogo';
import scheduledWorkOrder from './assets/scheduled-work-order.webp';
import { PhonePreview } from './PhonePreview';
import { RepairExample } from './RepairExample';
import styles from './landing.module.css';

function Arrow({ down = false }: { down?: boolean }) {
  return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none" className={down ? styles.arrowDown : undefined}>
    <path d="M4 10h11m-4.5-4.5L15 10l-4.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

function BrandLink() {
  return <Link className={styles.brand} href="/" aria-label="Signoff home"><SignoffLogo /></Link>;
}

export default function Landing({ demo, previewOnly = false }: { demo: boolean; previewOnly?: boolean }) {
  const destination = previewOnly ? '#example' : '/app';
  const appLabel = previewOnly ? 'Explore the example' : demo ? 'Try the demo' : 'Open Signoff';
  return <div className={styles.landing}>
    <a className={styles.skipLink} href="#content">Skip to content</a>
    <header className={styles.header}>
      <nav className={`${styles.wrap} ${styles.navigation}`} aria-label="Main navigation">
        <BrandLink />
        <div className={styles.navLinks}><a href="#how">How it works</a><a href="#verification">Tenant signoff</a></div>
        <a className={styles.primary} href={destination}>{previewOnly ? 'See the demo' : 'Get started'} <Arrow /></a>
      </nav>
    </header>
    <main id="content" tabIndex={-1}>
      <section className={styles.hero} aria-labelledby="headline">
        <div className={`${styles.wrap} ${styles.heroGrid}`}>
          <div className={styles.heroCopy}>
            <h1 id="headline">Report a repair. <em>See it through.</em></h1>
            <p className={styles.heroDescription}>Text a photo. Get updates. Confirm the fix.</p>
            <div className={styles.actions}>
              <a className={styles.primary} href={destination}>{appLabel} <Arrow /></a>
              <a className={styles.secondary} href="#how">See how it works <Arrow down /></a>
            </div>
          </div>
          <div className={styles.heroStage}>
            <figure className={styles.heroWindow}>
              <Image src={scheduledWorkOrder} alt="Example Signoff work order with a scheduled visit, reported room, and roof inspection area" preload unoptimized />
            </figure>
            <div className={styles.heroPhone}><PhonePreview /></div>
          </div>
        </div>
      </section>
      <section className={`${styles.wrap} ${styles.workspaceShowcase}`} id="how" aria-labelledby="workspace-title">
        <h2 id="workspace-title">From photo <em>to signoff.</em></h2>
        <RepairExample />
      </section>
      <section className={styles.proof} id="verification" aria-labelledby="proof-title">
        <div className={`${styles.wrap} ${styles.proofGrid}`}>
          <div className={styles.proofCopy}>
            <h2 id="proof-title">Tenants get the <em>final say.</em></h2>
            <p>Confirm the fix or reopen the work order by text.</p>
          </div>
          <figure className={styles.comparison}>
            <div><div className={styles.beforePhoto} role="img" aria-label="A ceiling with a water stain above the window" /><span>Before</span></div>
            <div><div className={styles.afterPhoto} role="img" aria-label="The same ceiling repaired" /><span>After · Signed off</span></div>
            <figcaption>Illustrative repair example</figcaption>
          </figure>
        </div>
      </section>
      <section className={`${styles.wrap} ${styles.finish}`} aria-labelledby="finish-title">
        <div className={styles.finishCard}>
          <h2 id="finish-title">See a repair <em>through.</em></h2>
          <a className={styles.primary} href={destination}>{appLabel} <Arrow /></a>
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
