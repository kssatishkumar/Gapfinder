import type { SessionUpsert, FeedbackCreate, MentorRequestCreate, Mentor, Summary } from '@mbq/shared';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function call<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
  const res = await fetch('/api' + path, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || 'Request failed');
  return data as T;
}

export const api = {
  mentors: () => call<Mentor[]>('GET', '/mentors'),
  saveSession: (id: string, b: SessionUpsert) => call<{ id: string; summary: Summary }>('PUT', '/sessions/' + id, b),
  sendFeedback: (b: FeedbackCreate) => call<{ id: string }>('POST', '/feedback', b),
  requestMentor: (b: MentorRequestCreate) => call<{ id: string }>('POST', '/mentor-requests', b),
  admin: {
    login: (password: string) => call<{ token: string }>('POST', '/admin/login', { password }),
    get: <T>(path: string, token: string) => call<T>('GET', '/admin/' + path, undefined, token),
    setRequestStatus: (id: string, status: string, token: string) => call('PATCH', '/admin/requests/' + id, { status }, token),
  },
};
