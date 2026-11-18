// Seed data for the mentors table, ported from prototype/My Big Quest.dc.html.

export const FIELDS = ['Medicine & health', 'Engineering & tech', 'Science & research', 'Business & finance', 'Law & government', 'Arts & design', 'Not sure yet'];

export interface Mentor {
  id: string;
  name: string;
  role: string;
  field: string;
  years: number;
  bio: string;
  helps: string[];
}

export const MENTOR_SEED: Mentor[] = [
  { id: 'raman', name: 'Dr. Priya Raman', role: 'Pediatrician', field: 'Medicine & health', years: 12, bio: 'Went from a community college start to medical school. Happy to talk honestly about the pre-med path.', helps: ['Pre-med path', 'Hospital volunteering', 'Science classes'] },
  { id: 'abrams', name: 'Ruth Abrams', role: 'Epidemiologist, county health dept.', field: 'Medicine & health', years: 9, bio: 'Tracks disease outbreaks with data. Public health is medicine without the white coat.', helps: ['Public health careers', 'Stats & data', 'Research projects'] },
  { id: 'bell', name: 'Marcus Bell', role: 'Software engineer', field: 'Engineering & tech', years: 8, bio: 'Builds apps used by millions. Started by making games in middle school.', helps: ['Learning to code', 'Passion projects', 'Robotics & comps'] },
  { id: 'ortiz', name: 'Elena Ortiz', role: 'Structural engineer', field: 'Engineering & tech', years: 14, bio: 'Designs bridges and buildings. Ask her about architecture versus engineering.', helps: ['Architecture vs. engineering', 'Math & physics', 'Internships'] },
  { id: 'okafor', name: 'Dr. Amara Okafor', role: 'Marine biologist', field: 'Science & research', years: 11, bio: 'Studies coral reefs. Did her first research project as a high school junior.', helps: ['Finding research', 'Science fair', 'Field work'] },
  { id: 'tanaka', name: 'Kenji Tanaka', role: 'Financial analyst', field: 'Business & finance', years: 7, bio: 'Works on investments at a bank. Ran a small business selling custom stickers in high school.', helps: ['Business & finance', 'Starting a venture', 'DECA & comps'] },
  { id: 'nguyen', name: 'Tom Nguyen', role: 'Founder of a youth nonprofit', field: 'Business & finance', years: 10, bio: 'Started a free tutoring program at 16 that now runs in 30 schools.', helps: ['Starting a nonprofit', 'Leadership', 'Fundraising'] },
  { id: 'whitfield', name: 'Dana Whitfield', role: 'Public defender', field: 'Law & government', years: 15, bio: 'Represents people in court who can’t afford a lawyer. Debate kid turned lawyer.', helps: ['Law careers', 'Debate', 'Political science'] },
  { id: 'lindqvist', name: 'Sofia Lindqvist', role: 'Illustrator & product designer', field: 'Arts & design', years: 9, bio: 'Moves between picture books and app design. Ask her how to build a portfolio.', helps: ['Building a portfolio', 'Art programs', 'Design careers'] },
  { id: 'cole', name: 'Jasmine Cole', role: 'Career coach', field: 'Not sure yet', years: 13, bio: 'Helps students who don’t know what they want yet find a direction worth trying.', helps: ['Finding a passion', 'Exploring fields', 'Picking activities'] },
];

export const firstName = (name: string) => name.replace('Dr. ', '').split(' ')[0];
export const initials = (name: string) => name.replace('Dr. ', '').split(' ').map(w => w[0]).join('').slice(0, 2);
