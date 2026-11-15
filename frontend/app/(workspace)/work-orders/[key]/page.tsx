import type { Metadata } from 'next';
import { WorkOrder } from '../../../../main';

export const metadata: Metadata = { title: 'Work order' };

export default async function WorkOrderPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return <WorkOrder key={key} access={key} />;
}
