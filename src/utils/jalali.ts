const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

export const JALALI_MONTHS = [
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
  'مهر',
  'آبان',
  'آذر',
  'دی',
  'بهمن',
  'اسفند',
];

export function toPersianDigits(value: string | number): string {
  return String(value).replace(/\d/g, (d) => PERSIAN_DIGITS[Number(d)] ?? d);
}

export function toEnglishDigits(value: string): string {
  return value
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632));
}

export interface JalaliDate {
  jy: number;
  jm: number;
  jd: number;
}

export function isJalaliLeapYear(jy: number): boolean {
  const breaks = [
    -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097,
    2192, 2262, 2324, 2394, 2456, 3178,
  ];
  let bl = breaks.length;
  let gy = jy + 621;
  let leapJ = -14;
  let jp = breaks[0];
  let jump = 0;

  if (jy < jp || jy >= breaks[bl - 1]) {
    // Fallback 33-year cycle
    const mod = ((jy % 33) + 33) % 33;
    return [1, 5, 9, 13, 17, 22, 26, 30].includes(mod);
  }

  for (let i = 1; i < bl; i++) {
    const jm = breaks[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ += Math.floor(jump / 33) * 8 + Math.floor((jump % 33) / 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ += Math.floor(n / 33) * 8 + Math.floor(((n % 33) + 3) / 4);
  if (jump % 33 === 4 && jump - n === 4) leapJ += 1;
  const leapG = Math.floor(gy / 4) - Math.floor(((Math.floor(gy / 100) + 1) * 3) / 4) - 150;
  const march = 20 + leapJ - leapG;
  void march;
  if (jump - n < 6) n = n - jump + Math.floor((jump + 4) / 33) * 33;
  let leap = (((n + 1) % 33) - 1) % 4;
  if (leap === -1) leap = 4;
  return leap === 0;
}

export function getJalaliMonthLength(jy: number, jm: number): number {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return isJalaliLeapYear(jy) ? 30 : 29;
}

export function gregorianToJalali(gy: number, gm: number, gd: number): JalaliDate {
  const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days =
    355666 +
    365 * gy +
    Math.floor((gy2 + 3) / 4) -
    Math.floor((gy2 + 99) / 100) +
    Math.floor((gy2 + 399) / 400) +
    gd +
    g_d_m[gm - 1];
  let jy = -1595 + 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  const jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return { jy, jm, jd };
}

export function jalaliToGregorian(
  jy: number,
  jm: number,
  jd: number
): { gy: number; gm: number; gd: number } {
  const jy2 = jy + 1595;
  let days =
    -355668 +
    365 * jy2 +
    Math.floor(jy2 / 33) * 8 +
    Math.floor(((jy2 % 33) + 3) / 4) +
    jd +
    (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
  let gy = 400 * Math.floor(days / 146097);
  days %= 146097;
  if (days > 36524) {
    gy += 100 * Math.floor(--days / 36524);
    days %= 36524;
    if (days >= 365) days++;
  }
  gy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    gy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  let gd = days + 1;
  const salA = [
    0,
    31,
    (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0 ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  let gm = 0;
  for (gm = 1; gm <= 12 && gd > salA[gm]; gm++) {
    gd -= salA[gm];
  }
  return { gy, gm, gd };
}

export function jalaliToIsoDate(jy: number, jm: number, jd: number): string {
  const maxDay = getJalaliMonthLength(jy, jm);
  const clampedDay = Math.min(Math.max(1, jd), maxDay);
  const { gy, gm, gd } = jalaliToGregorian(jy, jm, clampedDay);
  return `${String(gy).padStart(4, '0')}-${String(gm).padStart(2, '0')}-${String(gd).padStart(2, '0')}`;
}

export function isoDateToJalali(isoDate: string): JalaliDate {
  const parsed = parseIsoDate(isoDate);
  if (!parsed) {
    const today = parseIsoDate(businessDateIso())!;
    return gregorianToJalali(today.year, today.month, today.day);
  }
  return gregorianToJalali(parsed.year, parsed.month, parsed.day);
}

// Business dates in Iran; UTC is retained only for event timestamps.
export function businessDateIso(at = new Date(), timeZone = 'Asia/Tehran'): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, calendar: 'gregory', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const part = (type: string) => parts.find(p => p.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function addCalendarDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function parseIsoDate(isoDate: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
  return { year, month, day };
}

export function formatJalaliDate(isoDate: string): string {
  const parsed = parseIsoDate(isoDate);
  if (!parsed) return isoDate;
  const { jy, jm, jd } = gregorianToJalali(parsed.year, parsed.month, parsed.day);
  const mm = String(jm).padStart(2, '0');
  const dd = String(jd).padStart(2, '0');
  return toPersianDigits(`${jy}/${mm}/${dd}`);
}

export function formatJalaliLong(isoDate: string): string {
  const parsed = parseIsoDate(isoDate);
  if (!parsed) return isoDate;
  const { jy, jm, jd } = gregorianToJalali(parsed.year, parsed.month, parsed.day);
  const monthName = JALALI_MONTHS[jm - 1] ?? '';
  return `${toPersianDigits(jd)} ${monthName} ${toPersianDigits(jy)}`;
}

export function getJalaliMonthKey(isoDate: string): string {
  const parsed = parseIsoDate(isoDate);
  if (!parsed) return isoDate.slice(0, 7);
  const { jy, jm } = gregorianToJalali(parsed.year, parsed.month, parsed.day);
  return `${jy}-${String(jm).padStart(2, '0')}`;
}

export function formatJalaliMonthLabel(monthKey: string): string {
  const [yStr, mStr] = monthKey.split('-');
  const m = Number(mStr);
  const monthName = JALALI_MONTHS[m - 1] ?? mStr;
  return `${monthName} ${toPersianDigits(yStr.slice(-2))}`;
}
