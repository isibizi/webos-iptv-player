export function parseXmltvDate(str: string | null): Date | null {
  if (!str) return null;
  const match = str.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?$/);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, tz] = match;
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}${tz ? tz.slice(0, 3) + ':' + tz.slice(3) : 'Z'}`;
  return new Date(iso);
}

export function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

export function formatDuration(ms: number): string {
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function getTimeSlots(startTime: Date, hours: number, slotMinutes = 30): Date[] {
  const slots: Date[] = [];
  const start = new Date(startTime);
  start.setMinutes(Math.floor(start.getMinutes() / slotMinutes) * slotMinutes, 0, 0);
  const totalSlots = (hours * 60) / slotMinutes;
  for (let i = 0; i < totalSlots; i++) {
    slots.push(new Date(start.getTime() + i * slotMinutes * 60000));
  }
  return slots;
}

export function isNow(start: Date, stop: Date): boolean {
  const now = Date.now();
  return start.getTime() <= now && stop.getTime() > now;
}

export function getProgress(start: Date, stop: Date): number {
  const now = Date.now();
  const total = stop.getTime() - start.getTime();
  if (total <= 0) return 0;
  return Math.max(0, Math.min(1, (now - start.getTime()) / total));
}
