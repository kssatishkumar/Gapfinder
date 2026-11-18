import { useCallback, useEffect, useRef, useState } from 'react';
import { AREAS, QUESTION_COUNT, summarize, type Answers } from '@mbq/shared';
import { api } from './api';
import { clientId, load, save } from './storage';

const KEY = 'mbq-quiz';

export interface QuizState {
  sessionId: string;
  started: boolean;
  pos: number;
  answers: Answers;
}

const fresh = (): QuizState => ({ sessionId: crypto.randomUUID(), started: false, pos: 0, answers: {} });

/** Read-only peek at the saved quiz, for other pages (e.g. to prefill a mentor request). */
export function savedQuiz(): QuizState & { done: boolean } {
  const s = load<QuizState>(KEY, fresh());
  return { ...s, done: s.started && s.pos >= QUESTION_COUNT };
}

/** Gap titles from a finished quiz, biggest gaps first. */
export function gapTitles(answers: Answers): string[] {
  const st = summarize(answers).statuses;
  return AREAS.filter(a => st[a.k] !== 'covered')
    .sort((a, b) => (st[a.k] === 'gap' ? 0 : 1) - (st[b.k] === 'gap' ? 0 : 1))
    .map(a => a.title);
}

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'offline';

export function useQuiz() {
  const [s, setS] = useState<QuizState>(() => load<QuizState>(KEY, fresh()));
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => { save(KEY, s); }, [s]);

  // Autosave to the API, debounced. Nothing is sent until the student starts.
  useEffect(() => {
    if (!s.started || !Object.keys(s.answers).length) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setSaveStatus('saving');
      api.saveSession(s.sessionId, { clientId, answers: s.answers, pos: s.pos, completed: s.pos >= QUESTION_COUNT })
        .then(() => setSaveStatus('saved'))
        .catch(() => setSaveStatus('offline'));
    }, 600);
    return () => clearTimeout(timer.current);
  }, [s.sessionId, s.started, s.pos, s.answers]);

  const update = useCallback((patch: Partial<QuizState> | ((p: QuizState) => Partial<QuizState>)) =>
    setS(p => ({ ...p, ...(typeof patch === 'function' ? patch(p) : patch) })), []);

  const reset = useCallback(() => setS(fresh()), []);

  return { ...s, done: s.started && s.pos >= QUESTION_COUNT, saveStatus, update, reset };
}
