// Ordered schema migrations. Kept in code (not .sql files) so they bundle into the Lambda.
// Never edit a migration that has shipped; add a new one.
import { MENTOR_SEED } from '@mbq/shared';

const esc = (s: string) => "'" + s.replace(/'/g, "''") + "'";

export const MIGRATIONS: { id: string; sql: string }[] = [
  {
    id: '001_init',
    sql: `
      CREATE EXTENSION IF NOT EXISTS pgcrypto;

      CREATE TABLE quiz_sessions (
        id            uuid PRIMARY KEY,
        client_id     uuid NOT NULL,
        variant       char(1) NOT NULL CHECK (variant IN ('A','B')),
        grade         smallint CHECK (grade BETWEEN 6 AND 12),
        answers       jsonb NOT NULL DEFAULT '{}',
        summary       jsonb,
        pos           smallint NOT NULL DEFAULT 0,
        completed_at  timestamptz,
        created_at    timestamptz NOT NULL DEFAULT now(),
        updated_at    timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX quiz_sessions_client_idx ON quiz_sessions (client_id);
      CREATE INDEX quiz_sessions_created_idx ON quiz_sessions (created_at DESC);

      CREATE TABLE feedback (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id   uuid NOT NULL,
        session_id  uuid REFERENCES quiz_sessions(id) ON DELETE SET NULL,
        rating      text NOT NULL,
        useful      text,
        wrong       text NOT NULL DEFAULT '',
        wish        text NOT NULL DEFAULT '',
        answers     jsonb,
        created_at  timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX feedback_created_idx ON feedback (created_at DESC);

      CREATE TABLE mentors (
        id          text PRIMARY KEY,
        name        text NOT NULL,
        role        text NOT NULL,
        field       text NOT NULL,
        years       smallint NOT NULL,
        bio         text NOT NULL,
        helps       text[] NOT NULL DEFAULT '{}',
        active      boolean NOT NULL DEFAULT true,
        sort_order  smallint NOT NULL DEFAULT 0
      );

      CREATE TABLE mentor_requests (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id     uuid NOT NULL,
        session_id    uuid REFERENCES quiz_sessions(id) ON DELETE SET NULL,
        mentor_id     text NOT NULL REFERENCES mentors(id),
        grade         smallint CHECK (grade BETWEEN 6 AND 12),
        message       text NOT NULL,
        parent_email  text NOT NULL,
        status        text NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','closed')),
        created_at    timestamptz NOT NULL DEFAULT now(),
        updated_at    timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX mentor_requests_created_idx ON mentor_requests (created_at DESC);

      INSERT INTO mentors (id, name, role, field, years, bio, helps, sort_order) VALUES
      ${MENTOR_SEED.map((m, i) => `(${[m.id, m.name, m.role, m.field].map(esc).join(', ')}, ${m.years}, ${esc(m.bio)}, ARRAY[${m.helps.map(esc).join(', ')}]::text[], ${i})`).join(',\n      ')};
    `,
  },
];
