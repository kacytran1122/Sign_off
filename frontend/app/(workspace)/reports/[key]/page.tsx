import type { Metadata } from 'next';
import { SharedReport } from '../../../../main';

export const metadata: Metadata = { title: 'Repair report' };

export default async function ReportPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return <SharedReport key={key} access={key} />;
}
