import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '../../style.css';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return <div className="workspace">{children}</div>;
}
