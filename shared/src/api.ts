// Request schemas (Zod). Imported via @mbq/shared/schemas so the web bundle never pulls in Zod.
import { z } from 'zod';

import { RATINGS, REQUEST_STATUSES } from './constants';

const uuid = z.string().uuid();

export const SessionUpsert = z.object({
  clientId: uuid,
  answers: z.record(z.string(), z.unknown()),
  pos: z.number().int().min(0).max(50),
  completed: z.boolean(),
});
export type SessionUpsert = z.infer<typeof SessionUpsert>;

export const FeedbackCreate = z.object({
  clientId: uuid,
  sessionId: uuid.nullable(),
  rating: z.enum(RATINGS),
  useful: z.string().max(40).nullable(),
  wrong: z.string().max(2000),
  wish: z.string().max(2000),
});
export type FeedbackCreate = z.infer<typeof FeedbackCreate>;

export const MentorRequestCreate = z.object({
  clientId: uuid,
  sessionId: uuid.nullable(),
  mentorId: z.string().min(1).max(40),
  grade: z.number().int().min(6).max(12).nullable(),
  message: z.string().trim().min(1).max(2000),
  parentEmail: z.string().trim().toLowerCase().email().max(254),
});
export type MentorRequestCreate = z.infer<typeof MentorRequestCreate>;

export const RequestStatusUpdate = z.object({ status: z.enum(REQUEST_STATUSES) });
