import Image from 'next/image';
import Link from 'next/link';
import { SignoffLogo } from '../brand/SignoffLogo';
import leakingSink from './assets/leaking-sink.webp';
import crackedWindow from './assets/cracked-window.webp';
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

export default function Landing({ previewOnly = false }: { previewOnly?: boolean }) {
  const destination = previewOnly ? '#example' : '/app';
  const appLabel = previewOnly ? 'Explore the repair' : 'Open Signoff';
  return <div className={styles.landing}>
    <a className={styles.skipLink} href="#content">Skip to content</a>
    <header className={styles.header}>
      <nav className={`${styles.wrap} ${styles.navigation}`} aria-label="Main navigation">
        <BrandLink />
        <div className={styles.navLinks}><a href="#how">How it works</a><a href="#verification">Tenant signoff</a></div>
        <a className={styles.primary} href={destination}>{previewOnly ? 'See the repair' : 'Get started'} <Arrow /></a>
      </nav>
    </header>
    <main id="content" tabIndex={-1}>
      <section className={styles.hero} aria-labelledby="headline">
        <div className={`${styles.wrap} ${styles.heroGrid}`}>
          <div className={styles.heroCopy}>
            <h1 id="headline">The repair isn’t done until <em>the tenant says so.</em></h1>
            <div className={styles.actions}>
              <a className={styles.primary} href={destination}>{appLabel} <Arrow /></a>
              <a className={styles.secondary} href="#how">See how it works <Arrow down /></a>
            </div>
          </div>
          <div className={styles.heroPhone}><PhonePreview /></div>
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
            <div>
              <div className={`${styles.repairImage} ${styles.beforePhoto}`} role="img" aria-label="A ceiling with a water stain above the window" />
              <span>Ceiling stain</span>
            </div>
            <div>
              <div className={`${styles.repairImage} ${styles.afterPhoto}`} role="img" aria-label="The same ceiling repaired" />
              <span>Ceiling repaired · Tenant signoff</span>
            </div>
            <div>
              <Image className={styles.repairImage} src={leakingSink} alt="Leaking PVC drain trap beneath a bathroom sink" unoptimized />
              <div className={styles.photoLabel}>Leaking sink pipe
                <small><a href="https://commons.wikimedia.org/wiki/File:Leaking_PVC_Pipe_Under_Sink_-_P_Trap_(52842956605).jpg">Tony Webster</a> · <a href="https://creativecommons.org/licenses/by/2.0/">CC BY 2.0</a></small>
              </div>
            </div>
            <div>
              <Image className={styles.repairImage} src={crackedWindow} alt="A crack in the glass of a window pane" unoptimized />
              <div className={styles.photoLabel}>Cracked window
                <small><a href="https://commons.wikimedia.org/wiki/File:Crack_on_window_20180404.jpg">Santeri Viinamäki</a> · <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a></small>
              </div>
            </div>
            <figcaption>The ceiling comparison and courtyard artwork were created for Signoff. The ceiling pair shows a sample repair. The sourced photographs are resized and cropped for display.</figcaption>
          </figure>
        </div>
      </section>
      <section className={`${styles.wrap} ${styles.finish}`} aria-labelledby="finish-title">
        <div className={styles.finishCard}>
          <h2 id="finish-title">Keep every repair <em>on record.</em></h2>
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
