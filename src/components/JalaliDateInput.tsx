import { businessDateIso } from '../utils/jalali';
import React from 'react';
import {
  JALALI_MONTHS,
  getJalaliMonthLength,
  isoDateToJalali,
  jalaliToIsoDate,
  toPersianDigits,
} from '../utils/jalali';

interface JalaliDateInputProps {
  idPrefix: string;
  label: string;
  value: string; // Gregorian YYYY-MM-DD
  onChange: (isoDate: string) => void;
  allowClear?: boolean;
  onClear?: () => void;
}

const YEAR_START = 1398;
const YEAR_END = 1410;
const YEARS = Array.from({ length: YEAR_END - YEAR_START + 1 }, (_, i) => YEAR_START + i);

export const JalaliDateInput: React.FC<JalaliDateInputProps> = ({
  idPrefix,
  label,
  value,
  onChange,
  allowClear = false,
  onClear,
}) => {
  const { jy, jm, jd } = isoDateToJalali(value || businessDateIso());
  const clampedYear = Math.min(Math.max(jy, YEAR_START), YEAR_END);
  const maxDay = getJalaliMonthLength(clampedYear, jm);
  const clampedDay = Math.min(Math.max(jd, 1), maxDay);

  const handleSetToday = () => {
    onChange(businessDateIso());
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="block text-xs font-semibold text-slate-700">{label}</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSetToday}
            className="text-[11px] font-medium text-teal-700 hover:text-teal-900 cursor-pointer"
          >
            امروز
          </button>
          {allowClear && onClear && (
            <button
              type="button"
              onClick={onClear}
              className="text-[11px] font-medium text-slate-500 hover:text-red-600 cursor-pointer"
            >
              پاک کردن
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <select
          id={`${idPrefix}-day`}
          aria-label={`${label} - روز`}
          value={clampedDay}
          onChange={(e) => onChange(jalaliToIsoDate(clampedYear, jm, Number(e.target.value)))}
          className="min-h-[42px] rounded-xl border border-slate-200 bg-white px-2 text-xs sm:text-sm text-slate-900 tabular-nums focus:outline-none focus:ring-2 focus:ring-teal-600"
        >
          {Array.from({ length: maxDay }, (_, idx) => idx + 1).map((d) => (
            <option key={d} value={d}>
              {toPersianDigits(d)}
            </option>
          ))}
        </select>

        <select
          id={`${idPrefix}-month`}
          aria-label={`${label} - ماه`}
          value={jm}
          onChange={(e) => onChange(jalaliToIsoDate(clampedYear, Number(e.target.value), clampedDay))}
          className="min-h-[42px] rounded-xl border border-slate-200 bg-white px-1.5 text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
        >
          {JALALI_MONTHS.map((mName, idx) => (
            <option key={idx + 1} value={idx + 1}>
              {mName}
            </option>
          ))}
        </select>

        <select
          id={`${idPrefix}-year`}
          aria-label={`${label} - سال`}
          value={clampedYear}
          onChange={(e) => onChange(jalaliToIsoDate(Number(e.target.value), jm, clampedDay))}
          className="min-h-[42px] rounded-xl border border-slate-200 bg-white px-2 text-xs sm:text-sm text-slate-900 tabular-nums focus:outline-none focus:ring-2 focus:ring-teal-600"
        >
          {YEARS.map((y) => (
            <option key={y} value={y}>
              {toPersianDigits(y)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};
