export type Role = 'tenant' | 'landlord';

export class RequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function savedReportsOrigin() {
  const configuredOrigin = process.env.NEXT_PUBLIC_SAVED_REPORTS_ORIGIN ?? '';
  const origin = window.location.hostname === process.env.NEXT_PUBLIC_SAVED_REPORTS_FALLBACK_HOST
    ? process.env.NEXT_PUBLIC_SAVED_REPORTS_FALLBACK_ORIGIN ?? configuredOrigin
    : configuredOrigin;
  return origin.replace(/\/$/, '');
}

export async function request<T>(path = '', options?: RequestInit): Promise<T> {
  const response = await fetch(`${savedReportsOrigin()}/api/saved-reports${path}`, {
    ...options, credentials: 'include', cache: 'no-store',
    headers: options?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const data = await response.json().catch(() => undefined);
  if (!response.ok) throw new RequestError(data?.error ?? 'The report service is temporarily unavailable.', response.status);
  return data;
}

export function errorMessage(error: unknown) {
  return error instanceof RequestError ? error.message : 'Could not reach Signoff. Try again in a moment.';
}
