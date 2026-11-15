import type { Metadata } from 'next';
import { DemoPage } from '../../../main';

export const metadata: Metadata = { title: 'Repair workspace' };

export default function AppPage() {
  return <DemoPage />;
}
