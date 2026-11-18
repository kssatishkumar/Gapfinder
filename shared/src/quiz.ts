// GapFinder quiz content and scoring, ported from prototype/My Big Quest v6.dc.html.
// Shared by the web app (to render) and the API (to score what gets stored).

export type Status = 'gap' | 'partly' | 'covered';
export type Answers = Record<string, string>;

export interface Want { t: string; src: string }
export interface Area {
  k: string;
  title: string;
  q: string;
  help?: string;
  text?: { label: string; ph: string };
  opts: string[];
  st: Status[];
  wants: Want[];
  admit?: string;
  admitSrc?: string;
  ms: string;
  hs: string;
  survey: string;
}

const W = (t: string, src: string): Want => ({ t, src });

export const AREAS: Area[] = [
  { k: 'rigor', title: 'How hard your classes are', q: 'Are you in advanced classes?', opts: ['No', 'Advanced in one class', 'Advanced Learning program'], st: ['gap', 'partly', 'covered'],
    wants: [W('Yale calls the transcript the most important document, and reads it against the classes your own school offered.', 'Yale'), W('64% of colleges give class difficulty considerable importance.', 'NACAC'), W('UW asks whether you took advantage of AP, IB or extra core classes.', 'UW')],
    ms: 'Ask your counselor how to get into Advanced Learning, or which one class you could move up in next year.', hs: 'Ask your counselor which honors, AP or college-credit class you could add next year.',
    survey: '22 of 28 students already take advanced classes or work above grade level.' },
  { k: 'routine', title: 'A study routine', q: 'When do you usually study for a test?', opts: ['I don’t really study', 'The night before', 'A few days ahead'], st: ['gap', 'partly', 'covered'],
    wants: [W('UW’s review asks whether your grades show a positive trend over time.', 'UW'), W('Yale’s admissions officers look for grades that stay strong, not one good semester.', 'Yale')],
    admit: '73% of surveyed Harvard freshmen studied more than 10 hours a week in high school.', admitSrc: 'Harvard Crimson, Class of 2028 survey',
    ms: 'Pick a set time each day for homework, and review for 15 minutes even when nothing is due.', hs: 'Pick a set time each day for homework, and review for 15 minutes even when nothing is due.',
    survey: '20 of 28 students keep a study routine, and 11 more want to start one.' },
  { k: 'help', title: 'Getting help early', q: 'Last time you were stuck in class, what did you do?', opts: ['Nothing', 'Looked it up', 'Asked a teacher'], st: ['gap', 'partly', 'covered'],
    wants: [W('Yale wants teacher letters that show how you earned your grade, including how you handled a challenge.', 'Yale'), W('A rising grade trend is one of the things UW’s review looks for.', 'UW')],
    ms: 'Next time something doesn’t make sense, ask your teacher that same day, after class.', hs: 'Next time something doesn’t make sense, go to office hours that week instead of waiting for the test.',
    survey: '18 of 28 students ask a teacher, an adult or AI when work gets hard.' },
  { k: 'story', title: 'Something to write about', q: 'Do you keep notes on what you’ve done or learned?', opts: ['No', 'Sort of', 'Yes'], st: ['gap', 'partly', 'covered'],
    wants: [W('UW rates the essay as very important, the same level as grades and class difficulty.', 'UW'), W('Johns Hopkins says the essays it shares use everyday moments to show character and values.', 'Johns Hopkins')],
    admit: 'Essays from students admitted to Johns Hopkins are about things like learning to crochet and baking with family.', admitSrc: 'Johns Hopkins, Essays That Worked',
    ms: 'Start a notes file. Each month, write down one moment that mattered to you and why.', hs: 'Start a notes file. Each month, write down one moment that mattered to you and why. Then read a few essays that worked.',
    survey: 'A student asked what colleges look for “in your resume and essay.”' },
  { k: 'depth', title: 'One activity you go deep in', q: 'Your best result in an activity outside school?', text: { label: 'What’s the activity?', ph: 'e.g. soccer, piano, robotics' }, opts: ['No activity yet', 'Just joined in', 'Competed or performed', 'Placed or won'], st: ['gap', 'gap', 'partly', 'covered'],
    wants: [W('Stanford looks for sustained commitment and leadership in school and community activities.', 'Stanford'), W('MIT says it doesn’t expect applicants to do a million things, and asks for quality over quantity.', 'MIT'), W('Harvard’s readers rank real distinction in an activity above solid participation.', 'Harvard')],
    admit: 'More than half of surveyed Harvard freshmen played a sport in high school.', admitSrc: 'Harvard Crimson, Class of 2028 survey',
    ms: 'Pick the activity you enjoy most and set one goal for this year, like a competition, a show or a finished project.', hs: 'Set one goal in your main activity this year: placing in a competition, a performance or a finished project others can see.',
    survey: 'One student wrote that activities mostly matter “when you’re really good at it so that you stand out.”' },
  { k: 'lead', title: 'Leading something', q: 'Have you led anything in the past year?', text: { label: 'What did you lead or help lead?', ph: 'e.g. a club event, a team, a project' }, opts: ['No', 'Helped lead', 'Led it myself'], st: ['gap', 'partly', 'covered'],
    wants: [W('MIT lists initiative among what it looks for: going after opportunities, taking hard classes, or contributing to your family or community.', 'MIT'), W('In Harvard’s ratings, roles like class president or newspaper editor rank above being a member.', 'Harvard')],
    admit: 'More than half of surveyed Harvard freshmen were in student government in high school.', admitSrc: 'Harvard Crimson, Class of 2028 survey',
    ms: 'In a club or team you’re in, offer to help run one event or project.', hs: 'Take on one real role this year, like officer, captain or organizer, and stay with it.',
    survey: 'Leadership was the second thing students most wanted to start: 14 of 26.' },
  { k: 'serve', title: 'Helping others', q: 'How often do you volunteer or tutor?', opts: ['Never', 'Sometimes', 'Monthly or more'], st: ['gap', 'partly', 'covered'],
    wants: [W('UW rates volunteer work as important in its review.', 'UW'), W('Stanford looks for commitment in community activities, not just school ones.', 'Stanford'), W('MIT’s admissions page says tutoring a single kid in math changes the world. Impact doesn’t have to be big.', 'MIT')],
    admit: 'Volunteering was the most common activity among surveyed Harvard freshmen: 71% had done it.', admitSrc: 'Harvard Crimson, Class of 2028 survey',
    ms: 'Pick one way to help every month, like tutoring a younger student or helping at a library.', hs: 'Pick one place to help every month, like tutoring, a food bank or a cause you care about.',
    survey: '10 of 28 students help or tutor others, and 7 more want to start.' },
  { k: 'adult', title: 'Teachers who know you', q: 'How many teachers know you beyond your grades?', opts: ['None', 'One', 'Two or more'], st: ['gap', 'partly', 'covered'],
    wants: [W('Yale’s admissions officers say teacher letters are among the most important parts, after the transcript and tests.', 'Yale'), W('Yale asks for letters from two teachers who know you well. Teachers often write about your curiosity and how you treat classmates.', 'Yale'), W('UW is an exception and doesn’t use letters.', 'UW')],
    ms: 'Go to one teacher’s office hours this month with a question about something you’re curious about.', hs: 'Get to know two teachers in subjects you like, so you have people to ask for letters in 11th grade.',
    survey: '3 students said “Nobody’s here to guide me” is what’s getting in the way.' },
];

export interface Option { id: string; label: string }
export interface Question { id: string; title: string; help?: string; text?: { label: string; ph: string }; options: Option[] }

export const GRADES = [6, 7, 8, 9, 10, 11, 12];

export const QUESTIONS: Question[] = [
  { id: 'grade', title: 'What grade are you in?', options: GRADES.map(g => ({ id: String(g), label: g + 'th' })) },
  ...AREAS.map(a => ({ id: a.k, title: a.q, help: a.help, text: a.text, options: a.opts.map((l, i) => ({ id: 'a' + i, label: l })) })),
];

export const QUESTION_COUNT = QUESTIONS.length;
export const TEXT_MAX = 40;

export const statusOf = (a: Area, id: string | undefined): Status => {
  const i = id ? Number(id.slice(1)) : -1;
  return a.st[i] ?? 'gap';
};

export const isHighSchool = (answers: Answers) => Number(answers.grade || 8) >= 9;

export interface Summary {
  grade: number | null;
  statuses: Record<string, Status>;
  gapCount: number;
  partlyCount: number;
  coveredCount: number;
}

/** Compact, storable summary of a set of answers. */
export function summarize(answers: Answers): Summary {
  const statuses = Object.fromEntries(AREAS.map(a => [a.k, statusOf(a, answers[a.k])])) as Record<string, Status>;
  const vals = Object.values(statuses);
  const g = Number(answers.grade);
  return {
    grade: GRADES.includes(g) ? g : null,
    statuses,
    gapCount: vals.filter(v => v === 'gap').length,
    partlyCount: vals.filter(v => v === 'partly').length,
    coveredCount: vals.filter(v => v === 'covered').length,
  };
}

/** Keep only known question ids, valid option ids and trimmed short text. */
export function cleanAnswers(raw: Record<string, unknown>): Answers {
  const out: Answers = {};
  for (const q of QUESTIONS) {
    const v = raw[q.id];
    if (typeof v === 'string' && q.options.some(o => o.id === v)) out[q.id] = v;
    const t = raw[q.id + '_text'];
    if (q.text && typeof t === 'string' && t.trim()) out[q.id + '_text'] = t.trim().slice(0, TEXT_MAX);
  }
  return out;
}

export const answerLabel = (qid: string, answers: Answers): string => {
  const q = QUESTIONS.find(x => x.id === qid);
  const o = q?.options.find(x => x.id === answers[qid]);
  const text = answers[qid + '_text'];
  return (o ? o.label : 'Skipped') + (text ? ' (' + text + ')' : '');
};
