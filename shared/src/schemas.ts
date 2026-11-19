// Request body schemas, written as JSON Schema draft 4 because that's what API Gateway validates with.
// The same objects become API Gateway "models" (infra/) and validate requests in the local mock API,
// so the rules can't drift apart. Answers are generated from the quiz questions: only known question
// ids and option ids are accepted.
import { QUESTIONS, QUESTION_COUNT, TEXT_MAX, AREAS } from './quiz';
import { MENTOR_SEED } from './mentors';
import { RATINGS, REQUEST_STATUSES } from './constants';

export type JsonSchema = Record<string, unknown>;

const UUID = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
const uuid = { type: 'string', pattern: UUID };
const uuidOrNull = { type: ['string', 'null'], pattern: UUID };
const obj = (properties: Record<string, JsonSchema>, required = Object.keys(properties)): JsonSchema =>
  ({ $schema: 'http://json-schema.org/draft-04/schema#', type: 'object', additionalProperties: false, required, properties });

export const answersSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: Object.fromEntries(QUESTIONS.flatMap(q => [
    [q.id, { type: 'string', enum: q.options.map(o => o.id) }],
    ...(q.text ? [[q.id + '_text', { type: 'string', maxLength: TEXT_MAX }]] : []),
  ])),
};

/** PUT /api/sessions — autosave of a quiz. The browser picks the session id. */
export const sessionPutSchema = obj({
  id: uuid,
  clientId: uuid,
  answers: answersSchema,
  pos: { type: 'integer', minimum: 0, maximum: QUESTION_COUNT },
  completed: { type: 'boolean' },
});

/** POST /api/feedback */
export const feedbackPostSchema = obj({
  clientId: uuid,
  sessionId: uuidOrNull,
  rating: { type: 'string', enum: [...RATINGS] },
  // anyOf instead of an enum containing null: CloudFormation templates can't hold null values.
  useful: { anyOf: [{ type: 'string', enum: AREAS.map(a => a.k) }, { type: 'null' }] },
  wrong: { type: 'string', maxLength: 2000 },
  wish: { type: 'string', maxLength: 2000 },
});

/** POST /api/mentor-requests */
export const mentorRequestPostSchema = obj({
  clientId: uuid,
  sessionId: uuidOrNull,
  mentorId: { type: 'string', enum: MENTOR_SEED.map(m => m.id) },
  grade: { type: ['integer', 'null'], minimum: 6, maximum: 12 },
  message: { type: 'string', minLength: 1, maxLength: 2000, pattern: '\\S' },
  parentEmail: { type: 'string', maxLength: 254, pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$' },
});

/** PATCH /api/admin/requests/{id} */
export const requestStatusSchema = obj({ status: { type: 'string', enum: [...REQUEST_STATUSES] } });

// ---------- TypeScript shapes of the same bodies ----------
export interface SessionPut { id: string; clientId: string; answers: Record<string, string>; pos: number; completed: boolean }
export interface FeedbackPost { clientId: string; sessionId: string | null; rating: (typeof RATINGS)[number]; useful: string | null; wrong: string; wish: string }
export interface MentorRequestPost { clientId: string; sessionId: string | null; mentorId: string; grade: number | null; message: string; parentEmail: string }

// ---------- what the admin endpoints return ----------
export interface SessionRow { id: string; clientId: string; answers: Record<string, string>; pos: number; createdAt: number; updatedAt: number; completedAt: number | null }
export interface FeedbackRow { id: string; clientId: string; sessionId: string | null; rating: string; useful: string | null; wrong: string; wish: string; createdAt: number }
export interface RequestRow { id: string; clientId: string; sessionId: string | null; mentorId: string; grade: number | null; message: string; parentEmail: string; status: string; createdAt: number; updatedAt: number }
