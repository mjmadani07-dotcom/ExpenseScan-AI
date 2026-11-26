import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpLeft,
  Calendar,
  FileText,
  Receipt,
  TrendingUp,
  User,
  Wallet,
} from 'lucide-react';
import type {
  CategoryBudget,
  CategoryDefinition,
  DisplayUnit,
  ExchangeRates,
  ExpenseCategory,
  ExpenseRecord,
  TimeframeFilter,
} from '../types/expense';
import {
  COST_CENTER_LABELS,
  DEFAULT_EXPENSE_FILTERS,
  PAYMENT_STATUS_LABELS,
  computeDomainBreakdown,
  computeMonthlyTrend,
  computePurchaserBreakdown,
  convertTomanToDisplayUnit,
  filterExpenses,
  formatCompactCurrency,
  formatDisplayAmount,
  getCategoryColor,
  getCategoryLabel,
  normalizePurchaserName,
  normalizeToToman,
  resolveCategories,
  summarizeExpensePayments,
} from '../utils/finance';
import { formatJalaliDate, toPersianDigits } from '../utils/jalali';

interface OverviewDashboardProps {
  expenses: ExpenseRecord[];
  categories?: CategoryDefinition[];
  budgets: CategoryBudget[];
  rates: ExchangeRates;
  displayUnit: DisplayUnit;
  onChangeDisplayUnit: (unit: DisplayUnit) => void;
  onNavigateCapture: () => void;
  onOpenLedgerWithCategory: (category: ExpenseCategory | 'all') => void;
  onOpenLedgerWithPurchaser: (purchaser: string) => void;
  onSelectExpense: (expense: ExpenseRecord) => void;
}

const TIMEFRAME_OPTIONS: { id: TimeframeFilter; label: string }[] = [
  { id: '1m', label: 'ماه اخیر' },
  { id: '3m', label: '۳ ماه اخیر' },
  { id: '6m', label: '۶ ماه اخیر' },
  { id: '12m', label: '۱۲ ماه' },
  { id: 'all', label: 'همه زمان‌ها' },
];

function formatBarShortLabel(amountIRT: number, displayUnit: DisplayUnit): string {
  const val = convertTomanToDisplayUnit(amountIRT, displayUnit);
  if (val >= 1_000_000_000) {
    return `${toPersianDigits((val / 1_000_000_000).toFixed(1).replace(/\.0$/, ''))} میلیارد`;
  }
  return `${toPersianDigits((val / 1_000_000).toFixed(1).replace(/\.0$/, ''))} میلیون`;
}

export const OverviewDashboard: React.FC<OverviewDashboardProps> = ({
  expenses,
  categories,
  budgets,
  rates,
  displayUnit,
  onChangeDisplayUnit,
  onNavigateCapture,
  onOpenLedgerWithCategory,
  onOpenLedgerWithPurchaser,
  onSelectExpense,
}) => {
  const activeCategories = useMemo(() => resolveCategories(categories), [categories]);
  const [timeframe, setTimeframe] = useState<TimeframeFilter>('6m');
  const [selectedCategory, setSelectedCategory] = useState<ExpenseCategory | 'all'>('all');
  const [hoveredMonthKey, setHoveredMonthKey] = useState<string | null>(null);

  const periodExpenses = useMemo(
    () =>
      filterExpenses(
        expenses,
        {
          ...DEFAULT_EXPENSE_FILTERS,
          timeframe,
        },
        new Date(),
        rates
      ),
    [expenses, timeframe, rates]
  );

  const chartExpenses = useMemo(
    () =>
      selectedCategory === 'all'
        ? periodExpenses
        : periodExpenses.filter((e) => e.category === selectedCategory),
    [periodExpenses, selectedCategory]
  );

  const periodMonthsCount = useMemo(
    () => Math.max(1, computeMonthlyTrend(periodExpenses, rates).length),
    [periodExpenses, rates]
  );

  const domainBreakdown = useMemo(
    () =>
      computeDomainBreakdown(
        periodExpenses,
        budgets,
        rates,
        periodMonthsCount,
        activeCategories
      ),
    [periodExpenses, budgets, rates, periodMonthsCount, activeCategories]
  );

  const monthlyTrend = useMemo(
    () => computeMonthlyTrend(chartExpenses, rates),
    [chartExpenses, rates]
  );

  const purchaserBreakdown = useMemo(
    () => computePurchaserBreakdown(chartExpenses, rates).filter((p) => !p.isUnassigned),
    [chartExpenses, rates]
  );

  const kpis = useMemo(() => {
    let totalIRT = 0;
    let pendingIRT = 0;
    let pendingCount = 0;
    let totalTaxIRT = 0;

    for (const exp of chartExpenses) {
      const amountIRT = normalizeToToman(exp.amount, exp.currency, rates, exp.exchangeRateToToman);
      const taxIRT = normalizeToToman(exp.taxAmount || 0, exp.currency, rates, exp.exchangeRateToToman);
      const paySummary = summarizeExpensePayments(exp, rates);
      totalIRT += amountIRT;
      totalTaxIRT += taxIRT;
      if (paySummary.remainingIRT > 0) {
        pendingIRT += paySummary.remainingIRT;
        pendingCount += 1;
      }
    }

    const monthCount = Math.max(1, monthlyTrend.length);
    const monthlyAvgIRT = Math.round(totalIRT / monthCount);

    return {
      totalIRT,
      monthlyAvgIRT,
      pendingIRT,
      pendingCount,
      totalTaxIRT,
      count: chartExpenses.length,
    };
  }, [chartExpenses, monthlyTrend.length, rates]);

  const maxMonthlyIRT = useMemo(
    () => Math.max(1, ...monthlyTrend.map((m) => m.totalIRT)),
    [monthlyTrend]
  );

  const activeMonth = useMemo(() => {
    if (monthlyTrend.length === 0) return null;
    if (hoveredMonthKey) {
      return monthlyTrend.find((m) => m.monthKey === hoveredMonthKey) ?? monthlyTrend[monthlyTrend.length - 1];
    }
    return monthlyTrend[monthlyTrend.length - 1];
  }, [monthlyTrend, hoveredMonthKey]);

  const overBudgetDomains = useMemo(
    () => domainBreakdown.filter((d) => d.budgetUtilizationPercent !== null && d.budgetUtilizationPercent >= 90),
    [domainBreakdown]
  );

  return (
    <div className="space-y-6">
      {/* Header, Unit Switcher & Timeframe Control */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 text-balance">
            گزارش تحلیلی هزینه‌های شرکت
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            پایش روند مخارج در حوزه‌های مختلف و وضعیت تسویه فاکتورها با تاریخ شمسی
          </p>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 w-full lg:w-auto">
          <div
            className="inline-flex items-center p-1 bg-slate-100 rounded-xl border border-slate-200/80 self-start sm:self-auto"
            role="group"
            aria-label="واحد نمایش مبالغ"
          >
            <button
              type="button"
              onClick={() => onChangeDisplayUnit('IRT')}
              className={`min-h-[36px] px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                displayUnit === 'IRT'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              تومان
            </button>
            <button
              type="button"
              onClick={() => onChangeDisplayUnit('IRR')}
              className={`min-h-[36px] px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                displayUnit === 'IRR'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              ریال
            </button>
          </div>

          <div
            className="inline-flex items-center justify-between sm:justify-start gap-0.5 sm:gap-1 p-1 bg-slate-100 rounded-xl border border-slate-200/80 w-full sm:w-auto"
            role="group"
            aria-label="بازه زمانی گزارش"
          >
            {TIMEFRAME_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setTimeframe(opt.id)}
                className={`min-h-[36px] px-2 sm:px-3 py-1.5 text-[11px] sm:text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  timeframe === opt.id
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Selected Category Filter Notice */}
      {selectedCategory !== 'all' && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-teal-50 border border-teal-200 px-4 py-3">
          <div className="text-sm text-teal-900">
            نمایش آمار و نمودار روند اختصاصی حوزه:{' '}
            <strong className="font-bold">
              {getCategoryLabel(selectedCategory, activeCategories)}
            </strong>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onOpenLedgerWithCategory(selectedCategory)}
              className="min-h-[36px] px-3 py-1.5 rounded-lg bg-teal-700 text-white text-xs font-semibold hover:bg-teal-800 transition-colors cursor-pointer"
            >
              مشاهده اسناد این حوزه
            </button>
            <button
              type="button"
              onClick={() => setSelectedCategory('all')}
              className="min-h-[36px] px-3 py-1.5 rounded-lg bg-white border border-teal-200 text-teal-900 text-xs font-semibold hover:bg-teal-100/50 transition-colors cursor-pointer"
            >
              نمایش همه حوزه‌ها
            </button>
          </div>
        </div>
      )}

      {/* 4-Column KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="rounded-2xl bg-white border border-slate-200 p-3.5 sm:p-5">
          <div className="flex items-center justify-between text-[11px] sm:text-xs text-slate-500">
            <span className="truncate">مجموع هزینه‌های دوره</span>
            <Wallet className="w-4 h-4 text-teal-700 shrink-0" />
          </div>
          <div className="mt-2 text-base sm:text-2xl font-bold text-slate-900 tabular-nums">
            {formatCompactCurrency(kpis.totalIRT, displayUnit)}
          </div>
          <div className="mt-1 text-[11px] sm:text-xs text-slate-500 tabular-nums">
            {toPersianDigits(kpis.count)} سند تاییدشده
          </div>
        </div>

        <div className="rounded-2xl bg-white border border-slate-200 p-3.5 sm:p-5">
          <div className="flex items-center justify-between text-[11px] sm:text-xs text-slate-500">
            <span className="truncate">میانگین ماهانه</span>
            <TrendingUp className="w-4 h-4 text-sky-600 shrink-0" />
          </div>
          <div className="mt-2 text-base sm:text-2xl font-bold text-slate-900 tabular-nums">
            {formatCompactCurrency(kpis.monthlyAvgIRT, displayUnit)}
          </div>
          <div className="mt-1 text-[11px] sm:text-xs text-slate-500 tabular-nums">
            در {toPersianDigits(Math.max(1, monthlyTrend.length))} ماه فعال
          </div>
        </div>

        <div className="rounded-2xl bg-white border border-slate-200 p-3.5 sm:p-5">
          <div className="flex items-center justify-between text-[11px] sm:text-xs text-slate-500">
            <span className="truncate">در انتظار پرداخت</span>
            <Calendar className="w-4 h-4 text-amber-600 shrink-0" />
          </div>
          <div className="mt-2 text-base sm:text-2xl font-bold text-slate-900 tabular-nums">
            {formatCompactCurrency(kpis.pendingIRT, displayUnit)}
          </div>
          <div className="mt-1 text-[11px] sm:text-xs text-amber-700 font-medium tabular-nums truncate">
            {kpis.pendingCount > 0
              ? `${toPersianDigits(kpis.pendingCount)} فاکتور نیازمند تسویه`
              : 'همه اسناد تسویه شده‌اند'}
          </div>
        </div>

        <div className="rounded-2xl bg-white border border-slate-200 p-3.5 sm:p-5">
          <div className="flex items-center justify-between text-[11px] sm:text-xs text-slate-500">
            <span className="truncate">مالیات ارزش افزوده</span>
            <FileText className="w-4 h-4 text-slate-600 shrink-0" />
          </div>
          <div className="mt-2 text-base sm:text-2xl font-bold text-slate-900 tabular-nums">
            {formatCompactCurrency(kpis.totalTaxIRT, displayUnit)}
          </div>
          <div className="mt-1 text-[11px] sm:text-xs text-slate-500 truncate">
            قابل گزارش در اظهارنامه
          </div>
        </div>
      </div>

      {/* Main 2-Column Analytics Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Monthly Trend Over Time */}
        <section className="lg:col-span-7 rounded-2xl bg-white border border-slate-200 p-5 flex flex-col">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                روند هزینه‌ها در گذر زمان
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                برای مشاهده جزئیات هر ماه روی ستون آن لمس یا کلیک کنید
              </p>
            </div>
            {activeMonth && (
              <div className="text-left">
                <div className="text-xs text-slate-500">{activeMonth.label}</div>
                <div className="text-sm font-bold text-teal-800 tabular-nums">
                  {formatCompactCurrency(activeMonth.totalIRT, displayUnit)}
                </div>
                <div className="text-[11px] text-slate-500 tabular-nums">
                  {toPersianDigits(activeMonth.count)} سند ثبت‌شده
                </div>
              </div>
            )}
          </div>

          {monthlyTrend.length === 0 ? (
            <div className="my-10 flex flex-col items-center justify-center text-center py-8 px-4 rounded-xl bg-slate-50 border border-dashed border-slate-200">
              <Receipt className="w-8 h-8 text-slate-400 mb-2" />
              <p className="text-sm font-semibold text-slate-700">
                در این بازه زمانی هزینه‌ای ثبت نشده است
              </p>
              <button
                type="button"
                onClick={onNavigateCapture}
                className="mt-3 min-h-[40px] px-4 py-2 rounded-xl bg-teal-700 text-white text-xs font-semibold hover:bg-teal-800 transition-colors cursor-pointer"
              >
                ثبت اولین سند هزینه
              </button>
            </div>
          ) : (
            <div className="mt-4">
              <div className="flex items-end gap-2 sm:gap-4 h-64 pt-6 pb-2 border-b border-slate-200">
                {monthlyTrend.map((point) => {
                  const heightPercent = Math.max(8, Math.round((point.totalIRT / maxMonthlyIRT) * 100));
                  const isActive = activeMonth?.monthKey === point.monthKey;
                  const barColor =
                    selectedCategory !== 'all'
                      ? getCategoryColor(selectedCategory, activeCategories)
                      : isActive
                        ? '#0F766E'
                        : '#0D9488';

                  return (
                    <button
                      key={point.monthKey}
                      type="button"
                      onMouseEnter={() => setHoveredMonthKey(point.monthKey)}
                      onFocus={() => setHoveredMonthKey(point.monthKey)}
                      onClick={() => setHoveredMonthKey(point.monthKey)}
                      aria-label={`${point.label}: ${formatCompactCurrency(point.totalIRT, displayUnit)}`}
                      className="flex-1 h-full flex flex-col items-center justify-end gap-2 group cursor-pointer focus:outline-none"
                    >
                      <span className="text-[11px] font-medium text-slate-600 tabular-nums opacity-90 group-hover:text-slate-900">
                        {formatBarShortLabel(point.totalIRT, displayUnit)}
                      </span>
                      <div className="w-full max-w-[44px] flex-1 flex items-end justify-center">
                        <div
                          style={{
                            height: `${heightPercent}%`,
                            backgroundColor: barColor,
                            opacity: isActive ? 1 : 0.78,
                          }}
                          className="w-full rounded-t-lg transition-all duration-200 group-hover:opacity-100"
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-2 sm:gap-4 pt-2.5">
                {monthlyTrend.map((point) => (
                  <div
                    key={point.monthKey}
                    className={`flex-1 text-center text-[11px] truncate ${
                      activeMonth?.monthKey === point.monthKey
                        ? 'font-bold text-slate-900'
                        : 'text-slate-500'
                    }`}
                  >
                    {point.label}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Domain Breakdown & Budget Utilization */}
        <section className="lg:col-span-5 rounded-2xl bg-white border border-slate-200 p-5 flex flex-col">
          <div className="flex items-center justify-between gap-2 mb-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">هزینه به تفکیک حوزه</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                روی هر حوزه بزنید تا روند زمانی آن را ببینید
              </p>
            </div>
            {selectedCategory !== 'all' && (
              <button
                type="button"
                onClick={() => setSelectedCategory('all')}
                className="text-xs font-semibold text-teal-700 hover:text-teal-900 cursor-pointer"
              >
                بازنشانی
              </button>
            )}
          </div>

          <div className="space-y-3 flex-1">
            {domainBreakdown
              .filter((d) => d.count > 0 || d.monthlyLimitIRT > 0)
              .map((domain) => {
                const isSelected = selectedCategory === domain.category;
                const util = domain.budgetUtilizationPercent;
                return (
                  <button
                    key={domain.category}
                    type="button"
                    onClick={() =>
                      setSelectedCategory(isSelected ? 'all' : domain.category)
                    }
                    className={`w-full text-right p-2.5 rounded-xl border transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-teal-50/70 border-teal-300'
                        : 'bg-slate-50/60 border-transparent hover:border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-slate-800 truncate">
                        {domain.label}
                      </span>
                      <span className="font-bold text-slate-900 tabular-nums whitespace-nowrap">
                        {formatCompactCurrency(domain.totalIRT, displayUnit)}
                      </span>
                    </div>

                    <div className="mt-2 h-1.5 w-full rounded-full bg-slate-200 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${Math.min(100, Math.max(domain.totalIRT > 0 ? 4 : 0, domain.sharePercent))}%`,
                          backgroundColor: domain.color,
                        }}
                      />
                    </div>

                    <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500 tabular-nums">
                      <span>
                        {toPersianDigits(domain.count)} سند · {toPersianDigits(domain.sharePercent)}٪ از کل
                      </span>
                      {util !== null && (
                        <span className={util >= 100 ? 'text-red-600 font-semibold' : ''}>
                          مصرف بودجه دوره: {toPersianDigits(util)}٪
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
          </div>
        </section>
      </div>

      {/* Budget Alert & Recent Transactions */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-8 rounded-2xl bg-white border border-slate-200 p-5">
          <div className="flex items-center justify-between gap-4 mb-4">
            <h2 className="text-base font-bold text-slate-900">آخرین اسناد و فاکتورهای ثبت‌شده</h2>
            <button
              type="button"
              onClick={() => onOpenLedgerWithCategory(selectedCategory)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:text-teal-900 cursor-pointer"
            >
              <span>مشاهده همه در دفتر کل</span>
              <ArrowUpLeft className="w-3.5 h-3.5" />
            </button>
          </div>

          {chartExpenses.length === 0 ? (
            <p className="text-sm text-slate-500 py-6 text-center">
              سندی برای نمایش در این بخش وجود ندارد.
            </p>
          ) : (
            <div className="divide-y divide-slate-100">
              {chartExpenses.slice(0, 5).map((exp) => {
                const paySummary = summarizeExpensePayments(exp, rates);

                return (
                  <button
                    key={exp.id}
                    type="button"
                    onClick={() => onSelectExpense(exp)}
                    className="w-full py-3.5 px-2 -mx-2 rounded-xl hover:bg-slate-50 transition-colors flex items-center justify-between gap-4 text-right cursor-pointer"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-slate-900 truncate">
                        {exp.title}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
                        <span>{exp.vendor}</span>
                        {normalizePurchaserName(exp.purchaser) && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-medium text-teal-800">
                              {normalizePurchaserName(exp.purchaser)}
                            </span>
                          </>
                        )}
                        <span aria-hidden="true">·</span>
                        <span>{formatJalaliDate(exp.date)}</span>
                        <span aria-hidden="true">·</span>
                        <span>{getCategoryLabel(exp.category, activeCategories)}</span>
                        <span aria-hidden="true">·</span>
                        <span>{COST_CENTER_LABELS[exp.costCenter]}</span>
                      </div>
                    </div>
                    <div className="text-left shrink-0">
                      <div className="text-sm font-bold text-slate-900 tabular-nums">
                        {formatDisplayAmount(exp.amount, exp.currency, rates, displayUnit, exp.exchangeRateToToman)}
                      </div>
                      <div
                        className={`mt-0.5 text-[11px] font-medium ${
                          exp.paymentStatus === 'paid'
                            ? 'text-emerald-700'
                            : exp.paymentStatus === 'partial'
                              ? 'text-sky-700'
                              : exp.paymentStatus === 'overdue'
                                ? 'text-red-600'
                                : 'text-amber-700'
                        }`}
                      >
                        {PAYMENT_STATUS_LABELS[exp.paymentStatus]}
                        {exp.paymentStatus === 'partial' && paySummary.remainingIRT > 0
                          ? ` · مانده ${formatCompactCurrency(paySummary.remainingIRT, displayUnit)}`
                          : ''}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className="lg:col-span-4 rounded-2xl bg-white border border-slate-200 p-5 flex flex-col justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900 mb-3">پیشنهادها و هشدارهای مالی</h2>
            <div className="space-y-3">
              {overBudgetDomains.length > 0 ? (
                overBudgetDomains.map((d) => (
                  <div
                    key={d.category}
                    className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-950"
                  >
                    <div className="flex items-center gap-1.5 font-semibold">
                      <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                      <span>سقف بودجه {d.label}</span>
                    </div>
                    <p className="mt-1 text-amber-900 leading-relaxed tabular-nums">
                      مخارج این حوزه در بازه انتخابی به {toPersianDigits(d.budgetUtilizationPercent ?? 0)}٪ سقف ماهانه رسیده است.
                    </p>
                  </div>
                ))
              ) : (
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 leading-relaxed">
                  همه حوزه‌های هزینه در این بازه در محدوده بودجه تعریف‌شده قرار دارند.
                </div>
              )}

              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 leading-relaxed">
                نرخ تسعیر اسناد ارزی به صورت جداگانه روی همان سند ذخیره می‌شود تا تغییرات بعدی نرخ ارز گزارش‌های تاریخی را برهم نزند.
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onNavigateCapture}
            className="mt-5 w-full min-h-[44px] rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 transition-colors cursor-pointer"
          >
            ثبت فاکتور یا رسید جدید
          </button>
        </section>
      </div>

      {/* Per-Purchaser Summary Card */}
      {purchaserBreakdown.length > 0 && (
        <section className="rounded-2xl bg-white border border-slate-200 p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <User className="w-4 h-4 text-teal-700 shrink-0" />
              <h2 className="text-base font-bold text-slate-900">
                جمع هزینه بر اساس مسئول خرید
              </h2>
            </div>
            <span className="text-xs text-slate-500">
              برای مشاهده اسناد هر فرد روی کارت آن کلیک کنید
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {purchaserBreakdown.map((person) => (
              <button
                key={person.purchaserKey}
                type="button"
                onClick={() => onOpenLedgerWithPurchaser(person.purchaserKey)}
                className="text-right rounded-xl border border-slate-200 bg-slate-50/60 hover:bg-teal-50/50 hover:border-teal-300 p-3.5 transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-slate-900 truncate">{person.label}</span>
                  <span className="text-[11px] font-medium text-slate-500 tabular-nums shrink-0">
                    {toPersianDigits(person.count)} سند
                  </span>
                </div>
                <div className="mt-1.5 text-base font-bold text-slate-900 tabular-nums">
                  {formatCompactCurrency(person.totalIRT, displayUnit)}
                </div>
                {person.personalOutOfPocketIRT > 0 && (
                  <div className="mt-1 text-[11px] font-medium text-teal-700 tabular-nums">
                    از کارت/جیب شخصی:{' '}
                    {formatCompactCurrency(person.personalOutOfPocketIRT, displayUnit)}
                  </div>
                )}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
