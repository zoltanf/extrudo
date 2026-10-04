/**
 * "Just now", "5 minutes ago", "Yesterday", "12 Sep 2026": when a design was
 * last edited, or when a file in the linked folder was last written (a number
 * of milliseconds, as the File System Access API gives it).
 */
export function formatModified(when: string | number | Date, now: Date = new Date()): string {
  const then = when instanceof Date ? when : new Date(when);
  const seconds = (now.getTime() - then.getTime()) / 1000;
  if (!Number.isFinite(seconds)) return '';
  if (seconds < 45) return 'Just now';
  const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'long' });
  if (seconds < 45 * 60) return relative.format(-Math.max(1, Math.round(seconds / 60)), 'minute');
  if (seconds < 20 * 3600) return relative.format(-Math.round(seconds / 3600), 'hour');
  const days = calendarDays(then, now);
  if (days < 7) return capitalise(relative.format(-Math.max(1, days), 'day'));
  return `${then.getDate()} ${MONTHS[then.getMonth()]} ${then.getFullYear()}`;
}

// Fixed names: ICU's short months differ between versions ("Sep", "Sept").
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function calendarDays(a: Date, b: Date): number {
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((day(b) - day(a)) / 86_400_000);
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
