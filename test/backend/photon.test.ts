import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import {
  downloadPhoto, listReceivedMessages, photoLimit, readMessage, RetryableError, sendText,
} from '../../backend/photon.js';

const connection = { photonProject: 'project-fixture', photonKey: 'key-fixture' };
const since = '2026-11-15T10:00:00Z';

describe('Photon transport', () => {
  test('inbox polling keeps its time window and encodes the continuation token', async (t) => {
    const item = { id: 'message-1', createdAt: since, platform: 'imessage' };
    const fetchMock = t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
      const request = new URL(url);
      assert.equal(request.pathname, '/v1/projects/project-fixture/messages');
      assert.equal(new Headers(init.headers).get('authorization'), 'Bearer key-fixture');
      assert.deepEqual(Object.fromEntries(request.searchParams), {
        platform: 'imessage', direction: 'received', order: 'asc', pageSize: '50',
        createdSince: since, pageToken: 'a+b=/c',
      });
      return Response.json({ items: [item], nextPageToken: 'next-page' });
    });

    assert.deepEqual(await listReceivedMessages(connection, since, 'a+b=/c'), {
      items: [item], nextPageToken: 'next-page',
    });
    assert.equal(fetchMock.mock.callCount(), 1);
  });

  test('intake ignores outbound messages, other platforms, group spaces, and nonhuman senders', () => {
    const base = {
      id: 'message', status: 'received', platform: 'imessage', space: { id: 'space', kind: 'direct' },
      sentBy: { handle: 'tenant@example.invalid', kind: 'human' },
      receivedBy: { id: 'agent', kind: 'agent' }, content: { type: 'text', text: '  Water dripping  ' },
    };
    assert.equal(readMessage(base)?.text, 'Water dripping');
    for (const rejected of [
      { status: 'delivered' },
      { platform: 'sms' },
      { space: { id: 'space', kind: 'group' } },
      { sentBy: { ...base.sentBy, kind: 'agent' } },
      { receivedBy: undefined },
      { content: { type: 'text', text: '   ' } },
    ]) {
      assert.equal(readMessage({ ...base, ...rejected }), undefined, JSON.stringify(rejected));
    }
  });

  test('photo download preserves original bytes and normalizes the image MIME', async (t) => {
    const bytes = Uint8Array.of(255, 216, 1, 2, 3, 255, 217);
    t.mock.method(globalThis, 'fetch', async (url: string) => {
      assert.match(url, /\/attachments\/photo%2F1\/content$/);
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(bytes.subarray(0, 3));
          controller.enqueue(bytes.subarray(3));
          controller.close();
        },
      });
      return new Response(body, { headers: { 'Content-Type': 'image/jpeg; charset=binary' } });
    });

    assert.deepEqual(await downloadPhoto(connection, 'photo/1'), { bytes: Buffer.from(bytes), type: 'image/jpeg' });
  });

  test('photo download cancels unsupported and oversized attachment bodies', async (t) => {
    const responses: { name: string; headers: Record<string, string>; chunks: Uint8Array[] }[] = [
      { name: 'unsupported MIME', headers: { 'Content-Type': 'image/svg+xml' }, chunks: [] },
      {
        name: 'oversized Content-Length',
        headers: { 'Content-Type': 'image/png', 'Content-Length': String(photoLimit + 1) },
        chunks: [],
      },
      {
        name: 'oversized stream with no length header',
        headers: { 'Content-Type': 'image/png' },
        chunks: [new Uint8Array(photoLimit), Uint8Array.of(1)],
      },
    ];
    for (const { name, headers, chunks } of responses) {
      await t.test(name, async (subtest) => {
        let cancelled = false;
        subtest.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(chunk);
          },
          cancel() { cancelled = true; },
        }), { headers }));
        assert.equal(await downloadPhoto(connection, 'photo'), undefined);
        assert(cancelled);
      });
    }
  });

  test('temporary attachment errors carry a retry delay while missing photos fail permanently', async (t) => {
    let status = 409;
    t.mock.method(globalThis, 'fetch', async () => new Response('fixture', {
      status, headers: { 'Retry-After': '7' },
    }));
    for (const temporary of [409, 429, 503]) {
      status = temporary;
      await assert.rejects(downloadPhoto(connection, 'photo'),
        (error) => error instanceof RetryableError && error.retryAfter === 7 && error.message.endsWith(String(temporary)));
    }
    status = 404;
    await assert.rejects(downloadPhoto(connection, 'photo'), (error) =>
      error instanceof Error && !(error instanceof RetryableError) && error.message.endsWith('404'));
  });

  test('an attachment retry uses the same upload and send idempotency keys', async (t) => {
    const requests: { path: string; key: string | null; body: RequestInit['body'] }[] = [];
    t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
      const path = new URL(url).pathname;
      requests.push({ path, key: new Headers(init.headers).get('idempotency-key'), body: init.body });
      if (path.endsWith('/attachments')) return Response.json({ id: 'attachment-1' });
      if (requests.length === 2) return new Response(null, { status: 503, headers: { 'Retry-After': '3' } });
      return Response.json({ id: 'message-1' });
    });
    const job = {
      id: 'job-1', body: '', space_id: 'manager-space', agent_id: 'manager-agent',
      image: Buffer.from([255, 216, 255, 217]), image_type: 'image/jpeg',
    };

    await assert.rejects(sendText(connection, job),
      (error) => error instanceof RetryableError && error.retryAfter === 3);
    assert.equal(await sendText(connection, job), 'message-1');
    assert.equal(requests.length, 4);
    assert.deepEqual(requests[0], requests[2]);
    assert.match(requests[0].key ?? '', /^photo-job-1-/);
    assert.deepEqual(requests[1], requests[3]);
    assert.equal(requests[1].key, 'job-1');
    assert.deepEqual(JSON.parse(String(requests[1].body)), {
      spaceId: 'manager-space', senderId: 'manager-agent',
      content: { type: 'attachment', attachmentId: 'attachment-1' },
    });
  });
});
