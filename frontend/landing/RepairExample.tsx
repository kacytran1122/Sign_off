'use client';

import Image from 'next/image';
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import scheduledWorkOrder from './assets/scheduled-work-order.webp';
import tenantConfirmation from './assets/tenant-confirmation.webp';
import styles from './repair-example.module.css';

const stages = [
  { title: 'Tenant report', heading: 'One photo starts the repair.', description: 'The tenant shares what happened and where they see it, straight from their text thread.' },
  { title: 'Manager review', heading: 'A visit with a clear starting point.', description: 'The manager gets the original photo, the reported room, and an inspection window to share with the crew.' },
  { title: 'Tenant confirmation', heading: 'The tenant verifies the fix.', description: 'The timeline records each handoff. The tenant can confirm the repair or reopen it in the same thread.' },
];

export function RepairExample() {
  const id = useId();
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const [active, setActive] = useState(0);

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

  return <div className={styles.example}>
    <div className={styles.tabs} role="tablist" aria-label="Stages of the example repair">
      {stages.map(({ title }, index) => <button key={title} type="button" role="tab"
        id={`${id}-tab-${index}`} aria-controls={`${id}-panel-${index}`} aria-selected={active === index}
        tabIndex={active === index ? 0 : -1} ref={(button) => { tabs.current[index] = button; }}
        onClick={() => setActive(index)} onKeyDown={(event) => moveTab(event, index)}>{title}</button>)}
    </div>
    {stages.map(({ title, heading, description }, index) => <section key={title}
      id={`${id}-panel-${index}`} role="tabpanel" aria-labelledby={`${id}-tab-${index}`}
      tabIndex={0} hidden={active !== index} className={styles.panel}>
      <div className={styles.copy}><h3>{heading}</h3><p>{description}</p></div>
      {index === 0 && <div className={styles.photoPreview}>
        <div className={styles.tenantPhoto} role="img" aria-label="Illustration of a water stain near a window" />
        <p>“Water stain above the living room window.”</p>
      </div>}
      {index === 1 && <Image className={styles.capture} src={scheduledWorkOrder}
        alt="Signoff work order showing the reported room, tenant photo, and scheduled inspection window" unoptimized />}
      {index === 2 && <Image className={`${styles.capture} ${styles.timeline}`} src={tenantConfirmation}
        alt="Signoff repair timeline ending in tenant confirmation and work-order closure" unoptimized />}
    </section>)}
    <p className={styles.caption}>Fictional repair example</p>
  </div>;
}
