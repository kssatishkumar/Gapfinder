// Lucide-style stroke icons (stroke-width 2.75, per the design system).
const PATHS = {
  check: ['M20 6 9 17l-5-5'],
  back: ['m12 19-7-7 7-7', 'M19 12H5'],
  close: ['M18 6 6 18', 'm6 6 12 12'],
};

export function Icon({ name, size = 16 }: { name: keyof typeof PATHS; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.75}
      strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flex: 'none' }} aria-hidden="true">
      {PATHS[name].map(d => <path key={d} d={d} />)}
    </svg>
  );
}
