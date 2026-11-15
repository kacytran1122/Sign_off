import type { Metadata } from 'next';
import { renderPublicReportExample } from '../../../backend/scripts/report-worker.mjs';

export const metadata: Metadata = {
  title: 'Ceiling leak report',
  description: 'Read a public Signoff ceiling leak report with repair guidance, a Blender model, and neighborhood context.',
  alternates: { canonical: 'https://signoffon.us/repair-example' },
};

const report = {
  status: 'scheduled',
  issue: 'leak',
  aid: 'bucket',
  scenario: 'ceiling-leak',
  guidance: 'If the ceiling is stable and the drip is clear of electrical fittings, place a bucket beneath it and keep the walkway clear. If the ceiling sags or water reaches an electrical fixture, keep clear and call maintenance.',
  effects: 'Water can damage the ceiling and nearby finishes. Wet floors can become slippery.',
  renderStatus: 'ready',
  area: {
    city: 'Houston city center · Weather snapshot, November 15, 2026',
    latitude: 29.760,
    longitude: -95.370,
    timeZone: 'America/Chicago',
    weather: {
      current: {
        time: '2026-11-15T06:15',
        temperature_2m: 51,
        apparent_temperature: 46,
        relative_humidity_2m: 90,
      },
      daily: {
        time: ['2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18'],
        apparent_temperature_max: [59.2, 55.7, 63.6, 71.1],
      },
    },
    history: [
      { time: '2026-11-14T19:00-06:00', feelsLikeF: 51.5 },
      { time: '2026-11-14T20:00-06:00', feelsLikeF: 49.3 },
      { time: '2026-11-14T21:00-06:00', feelsLikeF: 51.1 },
      { time: '2026-11-14T22:00-06:00', feelsLikeF: 49.8 },
      { time: '2026-11-14T23:00-06:00', feelsLikeF: 48 },
      { time: '2026-11-15T00:00-06:00', feelsLikeF: 49.4 },
      { time: '2026-11-15T01:00-06:00', feelsLikeF: 49.6 },
      { time: '2026-11-15T02:00-06:00', feelsLikeF: 49.8 },
      { time: '2026-11-15T03:00-06:00', feelsLikeF: 48.9 },
      { time: '2026-11-15T04:00-06:00', feelsLikeF: 46.8 },
      { time: '2026-11-15T05:00-06:00', feelsLikeF: 45 },
      { time: '2026-11-15T06:00-06:00', feelsLikeF: 47.3 },
    ],
  },
};

export default function RepairExamplePage() {
  const { html, css } = renderPublicReportExample(report, '/repair-example-model.webp');
  return <>
    <style>{css}</style>
    <div className="signoff-public-report" dangerouslySetInnerHTML={{ __html: html }} />
  </>;
}
