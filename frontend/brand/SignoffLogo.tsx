import styles from './logo.module.css';

type SignoffLogoProps = {
  className?: string;
  compact?: boolean;
  variant?: 'light' | 'dark';
};

export function SignoffLogo({ className, compact = false, variant = 'dark' }: SignoffLogoProps) {
  const classes = [styles.logo, variant === 'light' ? styles.light : '', className].filter(Boolean).join(' ');
  return <span className={classes} aria-hidden="true">
    {compact ? <svg className={styles.mark} viewBox="0 0 40 40" focusable="false">
      <circle cx="20" cy="20" r="19" fill="currentColor" />
      <path d="M28 12.2c-2.7-3.8-12.9-1.5-12.9 3.4 0 4.7 9.1 3.4 9.1 8.1 0 4.7-8 7.6-11.3 4.4-1.5-1.5-1.1-3.5.3-5.1" />
    </svg> : <span className={styles.wordmark}>Signoff</span>}
  </span>;
}
