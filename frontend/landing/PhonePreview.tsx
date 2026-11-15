'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { SignoffLogo } from '../brand/SignoffLogo';
import styles from './phone-preview.module.css';

const revealDelays = [1550, 2200, 2050, 1250];
const messageCount = revealDelays.length + 1;
const playbackThreshold = .05;
const autoplayThreshold = .45;

export function PhonePreview() {
  const preview = useRef<HTMLElement>(null);
  const hasStarted = useRef(false);
  const threadId = useId();
  const [motionEnabled, setMotionEnabled] = useState(false);
  const [onScreen, setOnScreen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [revealed, setRevealed] = useState(messageCount);

  useEffect(() => {
    const element = preview.current;
    if (!element || !window.IntersectionObserver || !window.matchMedia) return;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let intersection = 0;

    function syncPlayback() {
      const visible = intersection >= playbackThreshold && !document.hidden;
      setOnScreen(visible);
      setMotionEnabled(!preference.matches);

      if (preference.matches) {
        hasStarted.current = true;
        setRevealed(messageCount);
        setIsPlaying(false);
      } else if (visible && intersection >= autoplayThreshold && !hasStarted.current) {
        hasStarted.current = true;
        setRevealed(1);
        setIsPlaying(true);
      }
    }

    const observer = new IntersectionObserver(([entry]) => {
      intersection = entry.intersectionRatio;
      syncPlayback();
    }, { threshold: [playbackThreshold, autoplayThreshold] });
    observer.observe(element);
    syncPlayback();
    preference.addEventListener('change', syncPlayback);
    document.addEventListener('visibilitychange', syncPlayback);

    return () => {
      observer.disconnect();
      preference.removeEventListener('change', syncPlayback);
      document.removeEventListener('visibilitychange', syncPlayback);
    };
  }, []);

  useEffect(() => {
    if (!motionEnabled || !onScreen || !isPlaying || revealed >= messageCount) return;
    const timer = window.setTimeout(() => {
      const next = revealed + 1;
      setRevealed(next);
      if (next === messageCount) setIsPlaying(false);
    }, revealDelays[revealed - 1]);
    return () => window.clearTimeout(timer);
  }, [isPlaying, motionEnabled, onScreen, revealed]);

  function handlePlayback() {
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }
    hasStarted.current = true;
    if (revealed === messageCount) setRevealed(1);
    setIsPlaying(true);
  }

  const action = isPlaying ? 'Pause' : revealed === messageCount ? 'Replay' : 'Resume';

  return <figure ref={preview} className={styles.preview} aria-label="Example repair conversation">
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
        <div id={threadId} className={styles.thread}>
          <span className={styles.threadTime}>Today 9:41 AM</span>
          <div className={styles.outgoing} data-revealed="true">
            <div className={styles.messagePhoto} role="img" aria-label="Ceiling stain above the living room window" />
            <p>Water stain above the living room window.</p>
          </div>
          <p className={styles.incoming} data-revealed={revealed >= 2}>I’ve sent the photo to your manager. The crew can visit Tuesday, 2–4 PM.</p>
          <p className={styles.incoming} data-revealed={revealed >= 3}>Your manager marked it fixed. Is the ceiling still leaking?</p>
          <p className={styles.outgoing} data-revealed={revealed >= 4}>Resolved. It’s dry now.</p>
          <p className={styles.signed} data-revealed={revealed >= 5}><SignoffLogo compact /> Signed off by tenant</p>
        </div>
        <i className={styles.homeBar} aria-hidden="true" />
      </div>
    </div>
    <figcaption className={styles.caption}>
      <span>Example repair conversation</span>
      <button
        className={styles.playback}
        type="button"
        aria-label={action + ' conversation'}
        aria-controls={threadId}
        data-enabled={motionEnabled}
        onClick={handlePlayback}
      >
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 20 20" fill="none">
          {action === 'Pause'
            ? <path d="M7 5v10m6-10v10" />
            : action === 'Replay'
              ? <path d="M4 9a6 6 0 1 1 1.5 5M4 5v4h4" />
              : <path d="m7 5 8 5-8 5V5Z" />}
        </svg>
        {action}
      </button>
    </figcaption>
  </figure>;
}
