import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '../brand/theme.css';
import './base.css';

export const metadata: Metadata = {
  applicationName: 'Signoff',
  title: {
    default: 'Signoff | Repairs tenants can sign off on',
    template: '%s | Signoff',
  },
  description: 'Report it. Fix it. Sign it off. All in one text thread.',
  referrer: 'no-referrer',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
