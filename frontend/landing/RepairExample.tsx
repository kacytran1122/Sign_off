'use client';

import Image from 'next/image';
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import managerReview from './assets/manager-review.webp';
import tenantReport from './assets/tenant-report.webp';
import tenantConfirmation from './assets/tenant-confirmation.webp';
import styles from './repair-example.module.css';

const stages = [
  { title: 'Tenant report', image: tenantReport, alt: 'Signoff tenant report showing a photo of the ceiling leak and its location by the conference room window.' },
  { title: 'Manager review', image: managerReview, alt: 'Signoff repair report showing leak guidance, a maintenance check, and a Blender-rendered model of a bucket under the drip.' },
  { title: 'Tenant confirmation', image: tenantConfirmation, alt: 'Signoff timeline showing a scheduled inspection, the tenant confirming the fix, and the work order closing.' },
];

export function RepairExample({ startWithReport = false }: { startWithReport?: boolean }) {
  const id = useId();
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const [active, setActive] = useState(startWithReport ? 0 : 1);

  function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const movement: Partial<Record<string, number>> = {
      ArrowLeft: (index + stages.length - 1) % stages.length, ArrowRight: (index + 1) % stages.length,
      Home: 0, End: stages.length - 1,
    };
    const next = Object.hasOwn(movement, event.key) ? movement[event.key] : undefined;
    if (next === undefined) return;
    event.preventDefault();
    setActive(next);
    tabs.current[next]?.focus();
  }

  return <div className={styles.example} id="example">
    <div className={styles.tabs} role="tablist" aria-label="Stages of the example repair">
      {stages.map(({ title, image }, index) => <button key={title} type="button" role="tab"
        id={`${id}-tab-${index}`} aria-controls={`${id}-panel-${index}`} aria-selected={active === index}
        tabIndex={active === index ? 0 : -1} ref={(button) => { tabs.current[index] = button; }}
        onClick={() => setActive(index)} onKeyDown={(event) => moveTab(event, index)}>
        <Image src={image} alt="" unoptimized />
        <span>{title}</span>
      </button>)}
    </div>
    {stages.map(({ title, image, alt }, index) => <section key={title}
      id={`${id}-panel-${index}`} role="tabpanel" aria-labelledby={`${id}-tab-${index}`}
      tabIndex={0} hidden={active !== index} className={styles.panel}>
      {index === 1 ? <figure className={styles.reportCapture}>
        <Image src={image} alt={alt} unoptimized />
        <figcaption><a href={image.src} target="_blank" rel="noreferrer">Enlarge report capture</a></figcaption>
      </figure> : <Image className={styles.capture} src={image} alt={alt} unoptimized />}
    </section>)}
  </div>;
}
