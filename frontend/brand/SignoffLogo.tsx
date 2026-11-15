import styles from './logo.module.css';

type SignoffLogoProps = {
  className?: string;
  compact?: boolean;
  variant?: 'light' | 'dark';
};

export function SignoffLogo({ className, compact = false, variant = 'dark' }: SignoffLogoProps) {
  const classes = [styles.logo, variant === 'light' ? styles.light : '', className].filter(Boolean).join(' ');
  return <span className={classes} aria-hidden="true">
    <svg className={styles.mark} viewBox="0 0 40 40" focusable="false">
      <circle cx="20" cy="20" r="19" fill="currentColor" />
      <path d="m11.5 20.3 5.6 5.7 11.7-12" />
    </svg>
    {!compact && <span className={styles.wordmark}>Signoff</span>}
  </span>;
}
