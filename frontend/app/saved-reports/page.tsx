import type { Metadata } from 'next';
import SavedReports from './SavedReports';

export const metadata: Metadata = {
  title: 'Saved reports',
  description: 'Sign in to read your saved Signoff repair reports.',
  robots: { index: false, follow: false },
};

export default function SavedReportsPage() {
  return <SavedReports />;
}
