import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import { DateTime } from 'luxon';
import { formatVisit, parseVisit } from '../../backend/schedule.js';

const zone = 'America/Los_Angeles';
const mondayEvening = DateTime.fromISO('2026-11-09T18:00:00-08:00');

describe('Inspection windows', () => {
  test('a weekday whose window has passed rolls to the following week', () => {
    assert.deepEqual(parseVisit('L-17 Monday 2 to 4 PM', zone, mondayEvening), {
      start: '2026-11-16T14:00:00.000-08:00', end: '2026-11-16T16:00:00.000-08:00',
    });
  });

  test('relative dates use the property day even after midnight UTC', () => {
    const utcMorning = DateTime.fromISO('2026-11-10T02:00:00Z');
    assert.deepEqual(parseVisit('today 7 to 8 PM', zone, utcMorning), {
      start: '2026-11-09T19:00:00.000-08:00', end: '2026-11-09T20:00:00.000-08:00',
    });
  });

  test('a window crossing noon keeps each explicit meridiem', () => {
    const visit = parseVisit('tomorrow 11:30 AM to 1:15 PM', zone, mondayEvening);
    assert.deepEqual(visit, {
      start: '2026-11-10T11:30:00.000-08:00', end: '2026-11-10T13:15:00.000-08:00',
    });
    assert.match(formatVisit(visit!, zone), /11:30 AM–1:15 PM PST$/);
  });

  test('invalid and ambiguous inspection windows are rejected', async (t) => {
    for (const [label, text] of [
      ['missing AM or PM', 'tomorrow 2 to 4'],
      ['backward window', 'tomorrow 4 PM to 2 PM'],
      ['zero-length window', 'tomorrow 4 PM to 4 PM'],
      ['past date', '2026-11-08 2 to 4 PM'],
      ['impossible calendar date', '2026-02-30 2 to 4 PM'],
      ['missing local hour during daylight saving change', '2027-03-14 2:15 AM to 4 AM'],
    ]) {
      await t.test(label, () => assert.equal(parseVisit(text, zone, mondayEvening), undefined));
    }
  });
});
