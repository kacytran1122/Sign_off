'use client';

import Image from 'next/image';
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import scheduledWorkOrder from './assets/scheduled-work-order.webp';
import managerRoom from './assets/manager-room.webp';
import managerRoof from './assets/manager-roof.webp';
import tenantReport from './assets/tenant-report.webp';
import tenantConfirmation from './assets/tenant-confirmation.webp';
import styles from './repair-example.module.css';

const stages = [
  { title: 'Tenant report', image: tenantReport, alt: 'Signoff tenant report showing a photo of the ceiling leak and its location by the conference room window.' },
  { title: 'Manager review', image: managerRoom, alt: 'Floor plan from Signoff with a pin at the conference room window.' },
  { title: 'Tenant confirmation', image: tenantConfirmation, alt: 'Signoff timeline showing a scheduled inspection, the tenant confirming the fix, and the work order closing.' },
];

export function RepairExample() {
  const id = useId();
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const [active, setActive] = useState(1);

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
      {index === 1 ? <article className={styles.workOrder}>
        <header>
          <div><p>Work order L-1</p><h3>Ceiling leak</h3></div>
          <span>Scheduled</span>
        </header>
        <div className={styles.details}>
          <figure>
            <Image src={image} alt={alt} unoptimized />
            <figcaption><strong>Reported location</strong>Suite 402 · Conference room window</figcaption>
          </figure>
          <figure>
            <Image src={managerRoof} alt="Roof diagram from Signoff with the west edge highlighted for inspection." unoptimized />
            <figcaption><strong>Suggested inspection area</strong>West roof edge</figcaption>
          </figure>
        </div>
        <a href={scheduledWorkOrder.src} target="_blank" rel="noreferrer">Open the full work order capture</a>
      </article> : <Image className={styles.capture} src={image} alt={alt} unoptimized />}
    </section>)}
    <p className={styles.caption}>Product screens captured in Signoff with sample data.</p>
  </div>;
}
