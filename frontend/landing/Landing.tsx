import Link from 'next/link';
import styles from './landing.module.css';

const steps = [
  { label: 'Text it in', detail: 'A photo and a few words. Done.' },
  { label: 'Fix it', detail: 'The crew knows where to look before they arrive.' },
  { label: 'Sign it off', detail: 'The tenant confirms the repair or reopens the work order.' },
];

const audiences = [
  { name: 'Tenants', detail: 'Your yes closes the job.' },
  { name: 'Managers', detail: 'Every repair, with proof.' },
  { name: 'Crews', detail: 'Fewer callbacks. Clear jobs.' },
];

function Check({ size = 24, filled = false, className }: { size?: number; filled?: boolean; className?: string }) {
  return <svg className={className} aria-hidden="true" viewBox="0 0 40 40" width={size} height={size}>
    <circle cx="20" cy="20" r={filled ? 20 : 16.5} fill={filled ? 'var(--check-fill, #f6ecc8)' : 'none'}
      stroke={filled ? 'none' : 'currentColor'} strokeWidth="4" />
    <path d="M12.5 20.5l5 5 10-11" stroke="currentColor" fill="none" strokeWidth="4"
      strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

function Brand({ compact = false }: { compact?: boolean }) {
  return <Link className={compact ? styles.brandSmall : styles.brand} href="/" aria-label="Signoff home">Signoff</Link>;
}

function DashboardPreview() {
  return <div className={styles.productPreview}>
    <div className={styles.browser}>
      <div className={styles.browserBar}>
        <span aria-hidden="true" className={styles.browserDots}><i /><i /><i /></span>
        <span className={styles.browserTitle}>Signoff work orders</span>
      </div>
      <div className={styles.dashboard}>
        <div className={styles.dashboardTop}>
          <div className={styles.dashboardBrand}><span aria-hidden="true">+</span> Signoff</div>
          <span>Example work order</span>
        </div>
        <div className={styles.dashboardBody}>
          <div className={styles.dashboardText}>
            <span className={styles.eyebrow}>Work order L-12</span>
            <p className={styles.dashboardHeading}>Ceiling stain by the window</p>
            <span className={styles.scheduled}>Scheduled</span>
            <dl>
              <div><dt>Location</dt><dd>Unit 2B · Living room</dd></div>
              <div><dt>Visit window</dt><dd>Tuesday, 2 to 4 PM</dd></div>
              <div><dt>Next step</dt><dd>Tenant confirms the repair</dd></div>
            </dl>
          </div>
          <div className={styles.locationPreview}>
            <span>Reported location</span>
            <div className={styles.floorPlan}>
              <div className={styles.livingRoom}><span>Living room</span><i aria-hidden="true" /></div>
              <div>Kitchen</div>
              <div>Bedroom</div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div className={styles.phone} role="group" aria-label="Example repair text thread">
      <div className={styles.phoneInside}>
        <div className={styles.phoneHeader}><span aria-hidden="true" className={styles.phoneMark}>S</span>Building repairs</div>
        <div className={styles.phoneMessages}>
          <p className={styles.sentMessage}>Ceiling stain by the window</p>
          <p className={styles.receivedMessage}>Crew booked. Tue 2 to 4 PM.</p>
          <p className={styles.receivedMessage}>Crew says it’s fixed. Is it?</p>
          <p className={styles.resolvedMessage}>Resolved</p>
          <span className={styles.signedOff}><Check size={14} />Signed off</span>
        </div>
      </div>
    </div>
  </div>;
}

function StepPreview({ step }: { step: number }) {
  if (step === 0) {
    return <div className={`${styles.stepPreview} ${styles.intakePreview}`}>
      <div className={styles.miniThread}>
        <span className={styles.miniTitle}>Building repairs</span>
        <div className={styles.miniPhoto} />
        <p className={styles.sentMessage}>Ceiling stain by the window</p>
        <p className={styles.receivedMessage}>I’ve opened your work order.</p>
      </div>
    </div>;
  }
  if (step === 1) {
    return <div className={`${styles.stepPreview} ${styles.visitPreview}`}>
      <div className={styles.miniOrder}>
        <span className={styles.eyebrow}>Work order L-12</span>
        <strong>Crew visit</strong>
        <div className={styles.visitDate}><span aria-hidden="true" />Tuesday, 2 to 4 PM</div>
        <small>Unit 2B · Living room</small>
      </div>
    </div>;
  }
  return <div className={`${styles.stepPreview} ${styles.signoffPreview}`}>
    <div className={styles.miniThread}>
      <span className={styles.miniTitle}>Building repairs</span>
      <p className={styles.receivedMessage}>Is the ceiling still leaking?</p>
      <p className={styles.resolvedMessage}>Resolved</p>
      <span className={styles.signedOff}><Check size={14} />Signed off</span>
    </div>
  </div>;
}

export default function Landing({ demo }: { demo: boolean }) {
  const appLabel = demo ? 'Try the demo' : 'Open Signoff';
  return <div className={styles.landing}>
    <a className={styles.skipLink} href="#content">Skip to content</a>
    <header className={styles.header}>
      <nav className={styles.navigation} aria-label="Main navigation">
        <Brand />
        <a href="#how">How it works</a>
        <a href="#who">Who it’s for</a>
        <Link className={styles.primaryLink} href="/app">Get started</Link>
      </nav>
    </header>
    <main id="content" tabIndex={-1}>
      <section className={styles.hero} aria-labelledby="headline">
        <div className={styles.heroBadge}><Check size={22} filled />Works over text. Nothing to download.</div>
        <h1 id="headline">The repair isn’t done until the tenant <em>says so.</em></h1>
        <p className={styles.heroDescription}>Report it. Fix it. Sign it off. All in one text thread.</p>
        <div className={styles.heroActions}>
          <Link className={`${styles.primaryLink} ${styles.heroButton}`} href="/app">{appLabel}</Link>
          <a className={styles.secondaryLink} href="#how">See how it works</a>
        </div>
        <DashboardPreview />
      </section>
      <div className={styles.sections}>
        <section id="how" className={styles.how} aria-labelledby="how-title">
          <div className={styles.sectionIntro}>
            <span className={styles.eyebrow}>How it works</span>
            <h2 id="how-title">Three steps. <em>No phone tag.</em></h2>
          </div>
          <ol className={styles.steps}>
            {steps.map((step, index) => <li key={step.label} className={styles.step}>
              <StepPreview step={index} />
              <div className={styles.stepCopy}>
                {index === 2 ? <Check size={32} /> : <span className={styles.stepNumber} aria-hidden="true">{index + 1}</span>}
                <div><h3>{step.label}</h3><p>{step.detail}</p></div>
              </div>
            </li>)}
          </ol>
        </section>
        <section className={styles.promise} aria-labelledby="promise-title">
          <div className={styles.promiseCopy}>
            <span className={styles.eyebrow}>The promise</span>
            <h2 id="promise-title">Only the tenant can <em>close the job.</em></h2>
            <p>If it’s still dripping, the tenant can reopen the work order in the same thread.</p>
          </div>
          <figure className={styles.comparison}>
            <div className={styles.photoPair}>
              <div><div className={styles.beforePhoto} role="img" aria-label="A water stain on the ceiling above a window" /><span>Before</span></div>
              <div><div className={styles.afterPhoto} role="img" aria-label="The same ceiling after the stain has been repaired" /><span>After · Signed off</span></div>
              <Check size={76} className={styles.comparisonCheck} filled />
            </div>
            <figcaption>Illustrative repair example</figcaption>
          </figure>
        </section>
        <section id="who" className={styles.audiences} aria-label="Who it’s for">
          {audiences.map(({ name, detail }) => <article key={name}>
            <Check size={26} />
            <h3>{name}</h3>
            <p>{detail}</p>
          </article>)}
        </section>
        <section className={styles.final} aria-labelledby="final-title">
          <Check size={520} className={styles.finalDecoration} />
          <h2 id="final-title">Fixed means <em>fixed.</em></h2>
          <p>{demo ? 'See the whole flow in two minutes.' : 'Start by texting your building’s repair line.'}</p>
          <Link className={styles.finalLink} href="/app">{appLabel}</Link>
        </section>
      </div>
    </main>
    <footer className={styles.footer}>
      <Brand compact />
      <span>© 2026 Signoff</span>
    </footer>
  </div>;
}
