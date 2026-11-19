import type { SessionPut, FeedbackPost, MentorRequestPost, SessionRow, FeedbackRow, RequestRow } from '@mbq/shared';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function call<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
  const res = await fetch('/api' + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      // Admin calls carry the Cognito access token in X-Auth (CloudFront forwards it to API Gateway).
      ...(token ? { 'x-auth': token } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || 'Request failed');
  return data as T;
}

export const api = {
  saveSession: (b: SessionPut) => call<{ ok: true }>('PUT', '/sessions', b),
  sendFeedback: (b: FeedbackPost) => call<{ id: string }>('POST', '/feedback', b),
  requestMentor: (b: MentorRequestPost) => call<{ id: string }>('POST', '/mentor-requests', b),
  admin: {
    sessions: (token: string) => call<SessionRow[]>('GET', '/admin/sessions', undefined, token),
    feedback: (token: string) => call<FeedbackRow[]>('GET', '/admin/feedback', undefined, token),
    requests: (token: string) => call<RequestRow[]>('GET', '/admin/requests', undefined, token),
    setRequestStatus: (id: string, status: string, token: string) => call('PATCH', '/admin/requests/' + encodeURIComponent(id), { status }, token),
  },
};
