import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError, type ZodType } from 'zod';
import { cleanAnswers, summarize, QUESTION_COUNT, AREAS } from '@mbq/shared';
import { SessionUpsert, FeedbackCreate, MentorRequestCreate, AdminLogin, RequestStatusUpdate } from '@mbq/shared/schemas';
import { query } from './db';
import { checkPassword, issueToken, requireAdmin } from './auth';

const parse = <T>(schema: ZodType<T>, body: unknown): T => schema.parse(body);

export function buildApp(opts: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 64 * 1024, trustProxy: true });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: 'Invalid request', issues: err.issues.map(i => ({ path: i.path.join('.'), message: i.message })) });
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: e.message });
    req.log.error(err);
    return reply.code(500).send({ error: 'Something went wrong' });
  });

  app.get('/api/health', async () => {
    await query('SELECT 1');
    return { ok: true };
  });

  // ---------- public ----------

  app.get('/api/mentors', async () => {
    const { rows } = await query('SELECT id, name, role, field, years, bio, helps FROM mentors WHERE active ORDER BY sort_order, name');
    return rows;
  });

  /** Autosave of a quiz in progress. The browser picks the session id; only the same client can update it. */
  app.put<{ Params: { id: string } }>('/api/sessions/:id', async (req, reply) => {
    const id = parse(SessionUpsert.shape.clientId, req.params.id);
    const body = parse(SessionUpsert, req.body);
    const answers = cleanAnswers(body.answers);
    const summary = summarize(answers);
    const completed = body.completed && body.pos >= QUESTION_COUNT;
    const { rowCount } = await query(
      `INSERT INTO quiz_sessions (id, client_id, variant, grade, answers, summary, pos, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $8::boolean THEN now() END)
       ON CONFLICT (id) DO UPDATE SET
         grade = EXCLUDED.grade, answers = EXCLUDED.answers, summary = EXCLUDED.summary, pos = EXCLUDED.pos,
         completed_at = COALESCE(quiz_sessions.completed_at, EXCLUDED.completed_at), updated_at = now()
       WHERE quiz_sessions.client_id = EXCLUDED.client_id`,
      [id, body.clientId, body.variant, summary.grade, answers, summary, Math.min(body.pos, QUESTION_COUNT), completed],
    );
    if (!rowCount) return reply.code(403).send({ error: 'This session belongs to someone else' });
    return { id, summary };
  });

  app.post('/api/feedback', async (req, reply) => {
    const b = parse(FeedbackCreate, req.body);
    if (b.useful && !AREAS.some(a => a.k === b.useful)) return reply.code(400).send({ error: 'Unknown area' });
    // Attach the answers server-side so the feedback can't claim a session it doesn't own.
    const { rows } = await query<{ id: string }>(
      `INSERT INTO feedback (client_id, session_id, rating, useful, wrong, wish, answers)
       SELECT $1, s.id, $3, $4, $5, $6, s.answers
       FROM (SELECT 1) x LEFT JOIN quiz_sessions s ON s.id = $2 AND s.client_id = $1
       RETURNING id`,
      [b.clientId, b.sessionId, b.rating, b.useful, b.wrong.trim(), b.wish.trim()],
    );
    return reply.code(201).send({ id: rows[0].id });
  });

  app.post('/api/mentor-requests', async (req, reply) => {
    const b = parse(MentorRequestCreate, req.body);
    const mentor = await query('SELECT 1 FROM mentors WHERE id = $1 AND active', [b.mentorId]);
    if (!mentor.rowCount) return reply.code(404).send({ error: 'Mentor not found' });
    const { rows } = await query<{ id: string }>(
      `INSERT INTO mentor_requests (client_id, session_id, mentor_id, grade, message, parent_email)
       SELECT $1, s.id, $3, $4, $5, $6
       FROM (SELECT 1) x LEFT JOIN quiz_sessions s ON s.id = $2 AND s.client_id = $1
       RETURNING id`,
      [b.clientId, b.sessionId, b.mentorId, b.grade, b.message, b.parentEmail],
    );
    return reply.code(201).send({ id: rows[0].id });
  });

  // ---------- admin ----------

  app.post('/api/admin/login', async (req, reply) => {
    const { password } = parse(AdminLogin, req.body);
    if (!(await checkPassword(password))) {
      await new Promise(r => setTimeout(r, 500)); // slow down guessing
      return reply.code(401).send({ error: 'Wrong password' });
    }
    return { token: await issueToken() };
  });

  app.register(async admin => {
    admin.addHook('preHandler', requireAdmin);

    admin.get('/api/admin/summary', async () => {
      const [s, areas, fb, mr] = await Promise.all([
        query(`SELECT count(*)::int AS started, count(completed_at)::int AS completed,
                 count(*) FILTER (WHERE variant = 'A')::int AS variant_a, count(*) FILTER (WHERE variant = 'B')::int AS variant_b,
                 count(completed_at) FILTER (WHERE variant = 'A')::int AS completed_a, count(completed_at) FILTER (WHERE variant = 'B')::int AS completed_b
               FROM quiz_sessions`),
        query(`SELECT k AS area, count(*) FILTER (WHERE v = 'gap')::int AS gap, count(*) FILTER (WHERE v = 'partly')::int AS partly,
                 count(*) FILTER (WHERE v = 'covered')::int AS covered
               FROM quiz_sessions, jsonb_each_text(summary->'statuses') AS e(k, v)
               WHERE completed_at IS NOT NULL GROUP BY k`),
        query(`SELECT rating, count(*)::int AS n FROM feedback GROUP BY rating`),
        query(`SELECT status, count(*)::int AS n FROM mentor_requests GROUP BY status`),
      ]);
      return { sessions: s.rows[0], areas: areas.rows, feedback: fb.rows, requests: mr.rows };
    });

    admin.get('/api/admin/sessions', async () => {
      const { rows } = await query(`SELECT id, variant, grade, answers, summary, pos, completed_at, created_at FROM quiz_sessions ORDER BY created_at DESC LIMIT 200`);
      return rows;
    });

    admin.get('/api/admin/feedback', async () => {
      const { rows } = await query(`SELECT id, session_id, rating, useful, wrong, wish, created_at FROM feedback ORDER BY created_at DESC LIMIT 200`);
      return rows;
    });

    admin.get('/api/admin/requests', async () => {
      const { rows } = await query(
        `SELECT r.id, r.mentor_id, m.name AS mentor_name, r.grade, r.message, r.parent_email, r.status, r.created_at
         FROM mentor_requests r JOIN mentors m ON m.id = r.mentor_id ORDER BY r.created_at DESC LIMIT 200`);
      return rows;
    });

    admin.patch<{ Params: { id: string } }>('/api/admin/requests/:id', async (req, reply) => {
      const id = parse(SessionUpsert.shape.clientId, req.params.id);
      const { status } = parse(RequestStatusUpdate, req.body);
      const { rowCount } = await query('UPDATE mentor_requests SET status = $2, updated_at = now() WHERE id = $1', [id, status]);
      if (!rowCount) return reply.code(404).send({ error: 'Request not found' });
      return { id, status };
    });
  });

  return app;
}
