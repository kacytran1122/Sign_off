import type { Metadata } from 'next';
import Link from 'next/link';
import { SignoffLogo } from '../../brand/SignoffLogo';
import { RepairExample } from '../../landing/RepairExample';
import styles from '../../landing/landing.module.css';

export const metadata: Metadata = {
  title: 'Repair example',
  description: 'Explore how a tenant report moves from the first photo through manager review to tenant signoff.',
  alternates: { canonical: 'https://signoffon.us/repair-example' },
};

export default function RepairExamplePage() {
  return <div className={styles.landing}>
    <a className={styles.skipLink} href="#content">Skip to content</a>
    <header className={styles.header}>
      <nav className={`${styles.wrap} ${styles.exampleNavigation}`} aria-label="Main navigation">
        <Link className={styles.brand} href="/" aria-label="Signoff home"><SignoffLogo /></Link>
        <Link className={styles.secondary} href="/">Back to Signoff</Link>
      </nav>
    </header>
    <main id="content" tabIndex={-1}>
      <section className={styles.exampleHero} aria-labelledby="repair-example-title">
        <div className={styles.wrap}>
          <h1 id="repair-example-title">From photo <em>to signoff.</em></h1>
          <p>Follow a ceiling leak from the tenant’s first photo through manager review to tenant confirmation.</p>
        </div>
      </section>
      <div className={`${styles.wrap} ${styles.exampleShowcase}`}>
        <RepairExample startWithReport />
      </div>
    </main>
  </div>;
}
