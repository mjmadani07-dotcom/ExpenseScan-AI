import type {
  CategoryBudget,
  CostCenter,
  Currency,
  DisplayUnit,
  DocumentType,
  ExchangeRates,
  ExpenseCategory,
  ExpenseFilters,
  ExpenseRecord,
  ExpenseSortBy,
  JsonImportMode,
  JsonImportStats,
  LedgerData,
  LineItem,
  PaymentMethod,
  PaymentStatus,
  PaymentTranche,
  PaymentTrancheStatus,
  SourceType,
  TimeframeFilter,
} from '../types/expense';
import { formatJalaliDate, formatJalaliMonthLabel, getJalaliMonthKey, toPersianDigits } from './jalali';

export const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  infrastructure: 'زیرساخت و فناوری',
  operations: 'عملیات و لجستیک',
  marketing: 'بازاریابی و فروش',
  hr_admin: 'اداری و منابع انسانی',
  equipment: 'خرید تجهیزات',
  tax_legal: 'مالیات، بیمه و حقوقی',
  travel: 'سفر و ماموریت',
  other: 'سایر هزینه‌ها',
};

export const CATEGORY_COLORS: Record<ExpenseCategory, string> = {
  infrastructure: '#0F766E',
  operations: '#0284C7',
  marketing: '#D97706',
  hr_admin: '#4F46E5',
  equipment: '#059669',
  tax_legal: '#DC2626',
  travel: '#7C3AED',
  other: '#64748B',
};

export const COST_CENTER_LABELS: Record<CostCenter, string> = {
  engineering: 'فنی و محصول',
  sales: 'فروش و بازاریابی',
  operations: 'عملیات و پشتیبانی',
  finance: 'مالی و اداری',
  executive: 'مدیریت',
  general: 'عمومی شرکت',
};

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  invoice: 'فاکتور فروش',
  receipt: 'رسید کارتخوان / خرید',
  bank_transfer: 'فیش / پیامک بانکی',
  bill: 'قبض خدماتی',
  proforma: 'پیش‌فاکتور',
  payroll: 'حقوق و دستمزد',
  petty_cash: 'سند تنخواه',
  other: 'سایر اسناد',
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  corporate_card: 'کارت بانکی شرکتی',
  bank_transfer: 'انتقال بانکی (پایا/ساتنا)',
  petty_cash: 'تنخواه‌گردان',
  online_gateway: 'درگاه پرداخت آنلاین',
  cash: 'نقدی',
  check: 'چک',
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  paid: 'پرداخت شده',
  partial: 'پرداخت بخشی (ترکیبی)',
  pending: 'در انتظار پرداخت',
  overdue: 'سررسید گذشته',
};

export const CURRENCY_LABELS: Record<Currency, string> = {
  IRT: 'تومان',
  IRR: 'ریال',
  USD: 'دلار',
  EUR: 'یورو',
};

export const SORT_BY_LABELS: Record<ExpenseSortBy, string> = {
  date_desc: 'جدیدترین تاریخ سند',
  date_asc: 'قدیمی‌ترین تاریخ سند',
  created_desc: 'جدیدترین زمان ثبت',
  amount_desc: 'بیشترین مبلغ',
  amount_asc: 'کمترین مبلغ',
};

export const DEFAULT_EXPENSE_FILTERS: ExpenseFilters = {
  query: '',
  category: 'all',
  costCenter: 'all',
  paymentStatus: 'all',
  documentType: 'all',
  paymentMethod: 'all',
  currency: 'all',
  dateFrom: undefined,
  dateTo: undefined,
  timeframe: 'all',
  sortBy: 'date_desc',
};

export function normalizeToToman(
  amount: number,
  currency: Currency,
  rates: ExchangeRates,
  documentExchangeRate?: number
): number {
  if (!Number.isFinite(amount)) return 0;
  switch (currency) {
    case 'IRT':
      return Math.round(amount);
    case 'IRR':
      return Math.round(amount / 10);
    case 'USD': {
      const rate = documentExchangeRate && documentExchangeRate > 0 ? documentExchangeRate : rates.USD;
      return Math.round(amount * rate);
    }
    case 'EUR': {
      const rate = documentExchangeRate && documentExchangeRate > 0 ? documentExchangeRate : rates.EUR;
      return Math.round(amount * rate);
    }
    default:
      return Math.round(amount);
  }
}

export function convertTomanToDisplayUnit(amountIRT: number, displayUnit: DisplayUnit): number {
  return displayUnit === 'IRR' ? Math.round(amountIRT * 10) : Math.round(amountIRT);
}

export function convertRialTomanValues(params: {
  amount: number;
  taxAmount: number;
  discountAmount: number;
  lineItems: LineItem[];
  paymentTranches?: PaymentTranche[];
  fromCurrency: Currency;
  toCurrency: 'IRT' | 'IRR';
}): {
  amount: number;
  taxAmount: number;
  discountAmount: number;
  lineItems: LineItem[];
  paymentTranches?: PaymentTranche[];
  currency: 'IRT' | 'IRR';
} {
  const { amount, taxAmount, discountAmount, lineItems, paymentTranches, fromCurrency, toCurrency } = params;
  if (fromCurrency === toCurrency || (fromCurrency !== 'IRR' && fromCurrency !== 'IRT')) {
    return { amount, taxAmount, discountAmount, lineItems, paymentTranches, currency: toCurrency };
  }
  const factor = fromCurrency === 'IRR' && toCurrency === 'IRT' ? 0.1 : 10;
  const scale = (n: number) => Math.round(n * factor);
  return {
    currency: toCurrency,
    amount: scale(amount),
    taxAmount: scale(taxAmount),
    discountAmount: scale(discountAmount),
    lineItems: lineItems.map((li) => ({
      ...li,
      unitPrice: scale(li.unitPrice),
      totalPrice: scale(li.totalPrice),
    })),
    paymentTranches: paymentTranches?.map((tr) => ({
      ...tr,
      amount: scale(tr.amount),
    })),
  };
}

export function derivePaymentStatusFromTranches(
  totalAmount: number,
  tranches: PaymentTranche[] | undefined,
  fallbackStatus: PaymentStatus
): PaymentStatus {
  if (!tranches || tranches.length === 0) return fallbackStatus;
  const paidSum = tranches
    .filter((t) => t.status === 'paid')
    .reduce((sum, t) => sum + (Number.isFinite(t.amount) ? Math.max(0, t.amount) : 0), 0);

  if (totalAmount > 0 && paidSum >= totalAmount - 0.01) {
    return 'paid';
  }
  if (paidSum > 0) {
    return 'partial';
  }
  if (tranches.some((t) => t.status === 'overdue')) {
    return 'overdue';
  }
  return 'pending';
}

export interface ExpensePaymentSummary {
  hasSchedule: boolean;
  totalInDocCurrency: number;
  paidInDocCurrency: number;
  remainingInDocCurrency: number;
  tranchesTotalInDocCurrency: number;
  unallocatedInDocCurrency: number;
  totalIRT: number;
  paidIRT: number;
  remainingIRT: number;
  paidPercent: number;
  derivedStatus: PaymentStatus;
}

export function summarizeExpensePayments(
  expense: {
    amount: number;
    currency: Currency;
    exchangeRateToToman?: number;
    paymentStatus: PaymentStatus;
    paymentTranches?: PaymentTranche[];
  },
  rates: ExchangeRates
): ExpensePaymentSummary {
  const totalInDocCurrency = Math.max(0, Number(expense.amount) || 0);
  const tranches = expense.paymentTranches ?? [];
  const hasSchedule = tranches.length > 0;

  let paidInDocCurrency = 0;
  let tranchesTotalInDocCurrency = 0;

  if (hasSchedule) {
    for (const tr of tranches) {
      const val = Math.max(0, Number(tr.amount) || 0);
      tranchesTotalInDocCurrency += val;
      if (tr.status === 'paid') {
        paidInDocCurrency += val;
      }
    }
    paidInDocCurrency = Math.min(totalInDocCurrency, paidInDocCurrency);
  } else {
    paidInDocCurrency = expense.paymentStatus === 'paid' ? totalInDocCurrency : 0;
    tranchesTotalInDocCurrency = totalInDocCurrency;
  }

  const remainingInDocCurrency = Math.max(0, totalInDocCurrency - paidInDocCurrency);
  const unallocatedInDocCurrency = totalInDocCurrency - tranchesTotalInDocCurrency;

  const totalIRT = normalizeToToman(
    totalInDocCurrency,
    expense.currency,
    rates,
    expense.exchangeRateToToman
  );
  const paidIRT = normalizeToToman(
    paidInDocCurrency,
    expense.currency,
    rates,
    expense.exchangeRateToToman
  );
  const remainingIRT = Math.max(0, totalIRT - paidIRT);
  const paidPercent =
    totalInDocCurrency > 0
      ? Math.min(100, Math.round((paidInDocCurrency / totalInDocCurrency) * 100))
      : 0;
  const derivedStatus = derivePaymentStatusFromTranches(
    totalInDocCurrency,
    tranches,
    expense.paymentStatus
  );

  return {
    hasSchedule,
    totalInDocCurrency,
    paidInDocCurrency,
    remainingInDocCurrency,
    tranchesTotalInDocCurrency,
    unallocatedInDocCurrency,
    totalIRT,
    paidIRT,
    remainingIRT,
    paidPercent,
    derivedStatus,
  };
}

export function formatCurrency(
  amount: number,
  currency: Currency = 'IRT',
  persianDigits = true
): string {
  const rounded =
    currency === 'USD' || currency === 'EUR'
      ? Math.round(amount * 100) / 100
      : Math.round(amount);
  const formatted = rounded.toLocaleString('en-US');
  const numStr = persianDigits ? toPersianDigits(formatted) : formatted;
  return `${numStr} ${CURRENCY_LABELS[currency]}`;
}

export function formatCompactCurrency(
  amountIRT: number,
  displayUnit: DisplayUnit = 'IRT'
): string {
  const valInUnit = convertTomanToDisplayUnit(amountIRT, displayUnit);
  const unitLabel = CURRENCY_LABELS[displayUnit];
  const abs = Math.abs(valInUnit);
  const sign = valInUnit < 0 ? '-' : '';
  if (abs >= 1_000_000_000) {
    const val = (abs / 1_000_000_000).toFixed(1).replace(/\.0$/, '');
    return `${sign}${toPersianDigits(val)} میلیارد ${unitLabel}`;
  }
  if (abs >= 1_000_000) {
    const val = (abs / 1_000_000).toFixed(1).replace(/\.0$/, '');
    return `${sign}${toPersianDigits(val)} میلیون ${unitLabel}`;
  }
  return `${sign}${toPersianDigits(Math.round(abs).toLocaleString('en-US'))} ${unitLabel}`;
}

export function formatCompactToman(amountIRT: number): string {
  return formatCompactCurrency(amountIRT, 'IRT');
}

export function getTimeframeCutoffIso(timeframe: TimeframeFilter, referenceDate: Date): string | null {
  if (timeframe === 'all') return null;
  const d = new Date(referenceDate.getTime());
  const monthsMap: Record<Exclude<TimeframeFilter, 'all'>, number> = {
    '1m': 1,
    '3m': 3,
    '6m': 6,
    '12m': 12,
  };
  d.setMonth(d.getMonth() - monthsMap[timeframe]);
  return d.toISOString().slice(0, 10);
}

const DEFAULT_FALLBACK_RATES: ExchangeRates = { USD: 70000, EUR: 76000 };

export function filterExpenses(
  expenses: ExpenseRecord[],
  filters: ExpenseFilters,
  referenceDate: Date = new Date(),
  rates: ExchangeRates = DEFAULT_FALLBACK_RATES
): ExpenseRecord[] {
  const q = filters.query.trim().toLowerCase();
  const cutoff = getTimeframeCutoffIso(filters.timeframe, referenceDate);

  return expenses
    .filter((item) => {
      if (cutoff && item.date < cutoff) return false;
      if (filters.dateFrom && item.date < filters.dateFrom) return false;
      if (filters.dateTo && item.date > filters.dateTo) return false;
      if (filters.category !== 'all' && item.category !== filters.category) return false;
      if (filters.costCenter !== 'all' && item.costCenter !== filters.costCenter) return false;
      if (filters.paymentStatus !== 'all' && item.paymentStatus !== filters.paymentStatus) return false;
      if (filters.documentType !== 'all' && item.documentType !== filters.documentType) return false;
      if (filters.currency !== 'all' && item.currency !== filters.currency) return false;
      if (filters.paymentMethod !== 'all') {
        const matchesMain = item.paymentMethod === filters.paymentMethod;
        const matchesTranche = (item.paymentTranches ?? []).some(
          (t) => t.method === filters.paymentMethod
        );
        if (!matchesMain && !matchesTranche) return false;
      }
      if (q) {
        const haystack = [
          item.title,
          item.vendor,
          item.vendorTaxId ?? '',
          item.invoiceNumber ?? '',
          item.trackingCode ?? '',
          item.projectTag ?? '',
          item.notes ?? '',
          ...item.lineItems.map((l) => l.description),
          ...(item.paymentTranches ?? []).flatMap((t) => [
            t.title,
            t.referenceCode ?? '',
            t.notes ?? '',
          ]),
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      switch (filters.sortBy) {
        case 'date_asc':
          return a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt);
        case 'created_desc':
          return b.createdAt.localeCompare(a.createdAt) || b.date.localeCompare(a.date);
        case 'amount_desc': {
          const aVal = normalizeToToman(a.amount, a.currency, rates, a.exchangeRateToToman);
          const bVal = normalizeToToman(b.amount, b.currency, rates, b.exchangeRateToToman);
          return bVal - aVal || b.date.localeCompare(a.date);
        }
        case 'amount_asc': {
          const aVal = normalizeToToman(a.amount, a.currency, rates, a.exchangeRateToToman);
          const bVal = normalizeToToman(b.amount, b.currency, rates, b.exchangeRateToToman);
          return aVal - bVal || b.date.localeCompare(a.date);
        }
        case 'date_desc':
        default:
          return b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt);
      }
    });
}

export interface DuplicateMatch {
  existing: ExpenseRecord;
  reason: string;
}

export function detectPotentialDuplicates(
  candidate: {
    vendor: string;
    amount: number;
    currency: Currency;
    exchangeRateToToman?: number;
    date: string;
    invoiceNumber?: string;
    trackingCode?: string;
  },
  existingExpenses: ExpenseRecord[],
  rates: ExchangeRates
): DuplicateMatch[] {
  const matches: DuplicateMatch[] = [];
  const candidateNorm = normalizeToToman(
    candidate.amount,
    candidate.currency,
    rates,
    candidate.exchangeRateToToman
  );
  const candVendor = candidate.vendor.trim().toLowerCase();
  const candInv = candidate.invoiceNumber?.trim().toLowerCase();
  const candTrack = candidate.trackingCode?.trim().toLowerCase();

  for (const existing of existingExpenses) {
    if (candTrack && existing.trackingCode && candTrack === existing.trackingCode.trim().toLowerCase()) {
      matches.push({ existing, reason: `کد پیگیری تکراری (${existing.trackingCode})` });
      continue;
    }
    if (candInv && existing.invoiceNumber && candInv === existing.invoiceNumber.trim().toLowerCase()) {
      matches.push({ existing, reason: `شماره فاکتور تکراری (${existing.invoiceNumber})` });
      continue;
    }
    const existNorm = normalizeToToman(
      existing.amount,
      existing.currency,
      rates,
      existing.exchangeRateToToman
    );
    const sameDate = existing.date === candidate.date;
    const sameVendor = candVendor.length > 1 && existing.vendor.trim().toLowerCase() === candVendor;
    const closeAmount =
      candidateNorm > 0 && Math.abs(existNorm - candidateNorm) <= Math.max(1000, candidateNorm * 0.01);
    if (sameDate && sameVendor && closeAmount) {
      matches.push({ existing, reason: 'تاریخ، فروشنده و مبلغ مشابه با سند قبلی' });
    }
  }
  return matches;
}

export interface DomainSummary {
  category: ExpenseCategory;
  label: string;
  color: string;
  totalIRT: number;
  count: number;
  sharePercent: number;
  monthlyLimitIRT: number;
  budgetUtilizationPercent: number | null;
}

export function computeDomainBreakdown(
  expenses: ExpenseRecord[],
  budgets: CategoryBudget[],
  rates: ExchangeRates,
  monthsCount = 1
): DomainSummary[] {
  const budgetMap = new Map<ExpenseCategory, number>();
  for (const b of budgets) {
    budgetMap.set(b.category, b.monthlyLimitIRT);
  }

  const totals = new Map<ExpenseCategory, { totalIRT: number; count: number }>();
  let grandTotal = 0;

  for (const exp of expenses) {
    const val = normalizeToToman(exp.amount, exp.currency, rates, exp.exchangeRateToToman);
    grandTotal += val;
    const prev = totals.get(exp.category) ?? { totalIRT: 0, count: 0 };
    totals.set(exp.category, { totalIRT: prev.totalIRT + val, count: prev.count + 1 });
  }

  const periodFactor = Math.max(1, monthsCount);
  const categories = Object.keys(CATEGORY_LABELS) as ExpenseCategory[];
  return categories
    .map((category) => {
      const entry = totals.get(category) ?? { totalIRT: 0, count: 0 };
      const monthlyLimitIRT = budgetMap.get(category) ?? 0;
      const periodLimit = monthlyLimitIRT * periodFactor;
      return {
        category,
        label: CATEGORY_LABELS[category],
        color: CATEGORY_COLORS[category],
        totalIRT: entry.totalIRT,
        count: entry.count,
        sharePercent: grandTotal > 0 ? Math.round((entry.totalIRT / grandTotal) * 1000) / 10 : 0,
        monthlyLimitIRT,
        budgetUtilizationPercent:
          periodLimit > 0 ? Math.round((entry.totalIRT / periodLimit) * 100) : null,
      };
    })
    .sort((a, b) => b.totalIRT - a.totalIRT);
}

export interface MonthlyTrendPoint {
  monthKey: string;
  label: string;
  totalIRT: number;
  count: number;
  byCategory: Partial<Record<ExpenseCategory, number>>;
}

export function computeMonthlyTrend(
  expenses: ExpenseRecord[],
  rates: ExchangeRates
): MonthlyTrendPoint[] {
  const map = new Map<string, MonthlyTrendPoint>();
  for (const exp of expenses) {
    const monthKey = getJalaliMonthKey(exp.date);
    const val = normalizeToToman(exp.amount, exp.currency, rates, exp.exchangeRateToToman);
    const existing = map.get(monthKey) ?? {
      monthKey,
      label: formatJalaliMonthLabel(monthKey),
      totalIRT: 0,
      count: 0,
      byCategory: {},
    };
    existing.totalIRT += val;
    existing.count += 1;
    existing.byCategory[exp.category] = (existing.byCategory[exp.category] ?? 0) + val;
    map.set(monthKey, existing);
  }
  return Array.from(map.values()).sort((a, b) => a.monthKey.localeCompare(b.monthKey));
}

function escapeCsvCell(value: string | number | undefined): string {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function exportExpensesToCsv(expenses: ExpenseRecord[], rates: ExchangeRates): string {
  const headers = [
    'تاریخ شمسی',
    'عنوان هزینه',
    'فروشنده / طرف حساب',
    'نوع سند',
    'حوزه هزینه',
    'مرکز هزینه',
    'مبلغ اصلی',
    'واحد پول',
    'نرخ تسعیر ثبت‌شده (تومان)',
    'معادل به تومان',
    'پرداخت‌شده (تومان)',
    'مانده تسویه‌نشده (تومان)',
    'مالیات',
    'تخفیف',
    'روش پرداخت',
    'وضعیت',
    'جزئیات پرداخت مرحله‌ای',
    'شماره فاکتور',
    'کد پیگیری',
    'برچسب پروژه',
    'یادداشت',
  ];

  const rows = expenses.map((e) => {
    const paySummary = summarizeExpensePayments(e, rates);
    const scheduleDesc = (e.paymentTranches ?? [])
      .map(
        (t) =>
          `${t.title}: ${t.amount} (${PAYMENT_METHOD_LABELS[t.method]} - ${
            PAYMENT_STATUS_LABELS[t.status]
          }${t.date ? ` - ${formatJalaliDate(t.date)}` : ''})`
      )
      .join(' | ');
    return [
      formatJalaliDate(e.date),
      e.title,
      e.vendor,
      DOCUMENT_TYPE_LABELS[e.documentType],
      CATEGORY_LABELS[e.category],
      COST_CENTER_LABELS[e.costCenter],
      e.amount,
      CURRENCY_LABELS[e.currency],
      e.currency === 'USD' || e.currency === 'EUR'
        ? e.exchangeRateToToman ?? rates[e.currency]
        : '',
      paySummary.totalIRT,
      paySummary.paidIRT,
      paySummary.remainingIRT,
      e.taxAmount,
      e.discountAmount,
      PAYMENT_METHOD_LABELS[e.paymentMethod],
      PAYMENT_STATUS_LABELS[e.paymentStatus],
      scheduleDesc,
      e.invoiceNumber ?? '',
      e.trackingCode ?? '',
      e.projectTag ?? '',
      e.notes ?? '',
    ];
  });

  const lines = [headers, ...rows].map((row) => row.map(escapeCsvCell).join(','));
  return '\uFEFF' + lines.join('\n');
}

const VALID_IMPORT_CURRENCIES: readonly Currency[] = ['IRT', 'IRR', 'USD', 'EUR'];
const VALID_IMPORT_DOC_TYPES: readonly DocumentType[] = [
  'invoice',
  'receipt',
  'bank_transfer',
  'bill',
  'proforma',
  'payroll',
  'petty_cash',
  'other',
];
const VALID_IMPORT_CATEGORIES: readonly ExpenseCategory[] = [
  'infrastructure',
  'operations',
  'marketing',
  'hr_admin',
  'equipment',
  'tax_legal',
  'travel',
  'other',
];
const VALID_IMPORT_COST_CENTERS: readonly CostCenter[] = [
  'engineering',
  'sales',
  'operations',
  'finance',
  'executive',
  'general',
];
const VALID_IMPORT_PAYMENT_METHODS: readonly PaymentMethod[] = [
  'corporate_card',
  'bank_transfer',
  'petty_cash',
  'online_gateway',
  'cash',
  'check',
];
const VALID_IMPORT_STATUSES: readonly PaymentStatus[] = ['paid', 'partial', 'pending', 'overdue'];
const VALID_IMPORT_TRANCHE_STATUSES: readonly PaymentTrancheStatus[] = ['paid', 'pending', 'overdue'];
const VALID_IMPORT_SOURCE_TYPES: readonly SourceType[] = ['image', 'pdf', 'text', 'text_file'];

function clampImportEnum<T extends string>(val: unknown, allowed: readonly T[], fallback: T): T {
  return typeof val === 'string' && (allowed as readonly string[]).includes(val)
    ? (val as T)
    : fallback;
}

export interface ValidatedLedgerImport {
  expenses: ExpenseRecord[];
  budgets?: CategoryBudget[];
  rates?: ExchangeRates;
}

export function parseAndValidateLedgerImport(raw: unknown): ValidatedLedgerImport {
  let payload: unknown = raw;
  if (typeof raw === 'string') {
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new Error('فایل JSON معتبر نیست و قابل خواندن نمی‌باشد.');
    }
  }

  let rawExpenses: unknown[] | null = null;
  let rawBudgets: unknown;
  let rawRates: unknown;

  if (Array.isArray(payload)) {
    rawExpenses = payload;
  } else if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    if (Array.isArray(obj.expenses)) {
      rawExpenses = obj.expenses;
      rawBudgets = obj.budgets;
      rawRates = obj.rates;
    }
  }

  if (!rawExpenses) {
    throw new Error('ساختار فایل JSON نامعتبر است. فایل باید شامل آرایه expenses یا لیست اسناد باشد.');
  }

  const nowIso = new Date().toISOString();
  const todayIso = nowIso.slice(0, 10);

  const expenses: ExpenseRecord[] = rawExpenses.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`سند ردیف ${toPersianDigits(index + 1)} ساختار معتبری ندارد.`);
    }
    const rec = entry as Record<string, unknown>;
    const title = typeof rec.title === 'string' ? rec.title.trim() : '';
    const vendor = typeof rec.vendor === 'string' ? rec.vendor.trim() : '';
    const amount = Number(rec.amount);

    if (!title || !vendor) {
      throw new Error(
        `سند ردیف ${toPersianDigits(index + 1)} فاقد عنوان یا نام فروشنده معتبر است.`
      );
    }
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error(
        `مبلغ سند «${title}» (ردیف ${toPersianDigits(index + 1)}) معتبر نیست.`
      );
    }

    const currency = clampImportEnum(rec.currency, VALID_IMPORT_CURRENCIES, 'IRT');
    const dateStr =
      typeof rec.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rec.date)
        ? rec.date
        : todayIso;

    const lineItems: LineItem[] = Array.isArray(rec.lineItems)
      ? rec.lineItems
          .filter((li): li is Record<string, unknown> => Boolean(li && typeof li === 'object'))
          .map((li) => ({
            description: String(li.description ?? 'قلم فاکتور'),
            quantity: Number(li.quantity) > 0 ? Number(li.quantity) : 1,
            unitPrice: Number.isFinite(Number(li.unitPrice)) ? Number(li.unitPrice) : 0,
            totalPrice: Number.isFinite(Number(li.totalPrice)) ? Number(li.totalPrice) : 0,
          }))
      : [];

    const rawTranches = Array.isArray(rec.paymentTranches) ? rec.paymentTranches : [];
    const paymentTranches: PaymentTranche[] = rawTranches
      .filter((tr): tr is Record<string, unknown> => Boolean(tr && typeof tr === 'object'))
      .map((tr, trIdx) => ({
        id:
          typeof tr.id === 'string' && tr.id.trim()
            ? tr.id.trim()
            : `tr-imp-${index}-${trIdx}-${Date.now()}`,
        title: String(tr.title ?? `بخش ${trIdx + 1}`),
        amount: Number.isFinite(Number(tr.amount)) ? Math.max(0, Number(tr.amount)) : 0,
        method: clampImportEnum(tr.method, VALID_IMPORT_PAYMENT_METHODS, 'bank_transfer'),
        status: clampImportEnum(tr.status, VALID_IMPORT_TRANCHE_STATUSES, 'pending'),
        date:
          typeof tr.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(tr.date)
            ? tr.date
            : undefined,
        referenceCode:
          typeof tr.referenceCode === 'string' && tr.referenceCode.trim()
            ? tr.referenceCode.trim()
            : undefined,
        notes: typeof tr.notes === 'string' && tr.notes.trim() ? tr.notes.trim() : undefined,
      }));

    const paymentStatus = derivePaymentStatusFromTranches(
      amount,
      paymentTranches.length > 0 ? paymentTranches : undefined,
      clampImportEnum(rec.paymentStatus, VALID_IMPORT_STATUSES, 'paid')
    );

    const exchangeRate =
      (currency === 'USD' || currency === 'EUR') &&
      Number.isFinite(Number(rec.exchangeRateToToman)) &&
      Number(rec.exchangeRateToToman) > 0
        ? Math.round(Number(rec.exchangeRateToToman))
        : undefined;

    const id =
      typeof rec.id === 'string' && rec.id.trim()
        ? rec.id.trim()
        : `imp-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`;

    return {
      id,
      title,
      vendor,
      vendorTaxId:
        typeof rec.vendorTaxId === 'string' && rec.vendorTaxId.trim()
          ? rec.vendorTaxId.trim()
          : undefined,
      documentType: clampImportEnum(rec.documentType, VALID_IMPORT_DOC_TYPES, 'invoice'),
      category: clampImportEnum(rec.category, VALID_IMPORT_CATEGORIES, 'other'),
      costCenter: clampImportEnum(rec.costCenter, VALID_IMPORT_COST_CENTERS, 'general'),
      amount,
      currency,
      exchangeRateToToman: exchangeRate,
      taxAmount: Number.isFinite(Number(rec.taxAmount)) ? Math.max(0, Number(rec.taxAmount)) : 0,
      discountAmount: Number.isFinite(Number(rec.discountAmount))
        ? Math.max(0, Number(rec.discountAmount))
        : 0,
      date: dateStr,
      invoiceNumber:
        typeof rec.invoiceNumber === 'string' && rec.invoiceNumber.trim()
          ? rec.invoiceNumber.trim()
          : undefined,
      trackingCode:
        typeof rec.trackingCode === 'string' && rec.trackingCode.trim()
          ? rec.trackingCode.trim()
          : undefined,
      paymentMethod: clampImportEnum(rec.paymentMethod, VALID_IMPORT_PAYMENT_METHODS, 'corporate_card'),
      paymentStatus,
      paymentTranches: paymentTranches.length > 0 ? paymentTranches : undefined,
      dueDate:
        typeof rec.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rec.dueDate)
          ? rec.dueDate
          : undefined,
      projectTag:
        typeof rec.projectTag === 'string' && rec.projectTag.trim()
          ? rec.projectTag.trim()
          : undefined,
      notes: typeof rec.notes === 'string' && rec.notes.trim() ? rec.notes.trim() : undefined,
      extractionNotes:
        typeof rec.extractionNotes === 'string' && rec.extractionNotes.trim()
          ? rec.extractionNotes.trim()
          : undefined,
      lineItems,
      sourceType: clampImportEnum(rec.sourceType, VALID_IMPORT_SOURCE_TYPES, 'text'),
      sourceFileName:
        typeof rec.sourceFileName === 'string' && rec.sourceFileName.trim()
          ? rec.sourceFileName.trim()
          : undefined,
      sourcePreviewUrl:
        typeof rec.sourcePreviewUrl === 'string' && rec.sourcePreviewUrl.startsWith('data:image/')
          ? rec.sourcePreviewUrl
          : undefined,
      pageCount:
        Number.isFinite(Number(rec.pageCount)) && Number(rec.pageCount) > 0
          ? Math.round(Number(rec.pageCount))
          : undefined,
      createdAt:
        typeof rec.createdAt === 'string' && rec.createdAt.trim() ? rec.createdAt : nowIso,
      approvedAt:
        typeof rec.approvedAt === 'string' && rec.approvedAt.trim() ? rec.approvedAt : nowIso,
    };
  });

  let budgets: CategoryBudget[] | undefined;
  if (Array.isArray(rawBudgets)) {
    const validBudgets = rawBudgets
      .filter((b): b is Record<string, unknown> => Boolean(b && typeof b === 'object'))
      .filter((b) => (VALID_IMPORT_CATEGORIES as readonly string[]).includes(String(b.category)))
      .map((b) => ({
        category: b.category as ExpenseCategory,
        monthlyLimitIRT: Number.isFinite(Number(b.monthlyLimitIRT))
          ? Math.max(0, Math.round(Number(b.monthlyLimitIRT)))
          : 0,
      }));
    if (validBudgets.length > 0) {
      budgets = validBudgets;
    }
  }

  let rates: ExchangeRates | undefined;
  if (rawRates && typeof rawRates === 'object') {
    const r = rawRates as Record<string, unknown>;
    const usd = Number(r.USD);
    const eur = Number(r.EUR);
    if (Number.isFinite(usd) && usd > 0 && Number.isFinite(eur) && eur > 0) {
      rates = { USD: Math.round(usd), EUR: Math.round(eur) };
    }
  }

  return { expenses, budgets, rates };
}

export function mergeLedgerData(
  current: LedgerData,
  incoming: ValidatedLedgerImport,
  mode: JsonImportMode
): { next: LedgerData; stats: JsonImportStats } {
  if (mode === 'replace') {
    const sorted = [...incoming.expenses].sort(
      (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)
    );
    const next: LedgerData = {
      expenses: sorted,
      budgets: incoming.budgets ?? current.budgets,
      rates: incoming.rates ?? current.rates,
      ...(current.aiConfig ? { aiConfig: current.aiConfig } : {}),
    };
    return {
      next,
      stats: {
        added: sorted.length,
        updated: 0,
        total: sorted.length,
      },
    };
  }

  // Merge mode: match by id, update existing, append new
  const map = new Map<string, ExpenseRecord>();
  for (const exp of current.expenses) {
    map.set(exp.id, exp);
  }

  let added = 0;
  let updated = 0;
  for (const inc of incoming.expenses) {
    if (map.has(inc.id)) {
      updated += 1;
    } else {
      added += 1;
    }
    map.set(inc.id, inc);
  }

  const mergedExpenses = Array.from(map.values()).sort(
    (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)
  );

  let nextBudgets = current.budgets;
  if (incoming.budgets && incoming.budgets.length > 0) {
    const budgetMap = new Map<ExpenseCategory, number>();
    for (const b of current.budgets) budgetMap.set(b.category, b.monthlyLimitIRT);
    for (const b of incoming.budgets) {
      if (!budgetMap.has(b.category)) {
        budgetMap.set(b.category, b.monthlyLimitIRT);
      }
    }
    nextBudgets = Array.from(budgetMap.entries()).map(([category, monthlyLimitIRT]) => ({
      category,
      monthlyLimitIRT,
    }));
  }

  const next: LedgerData = {
    expenses: mergedExpenses,
    budgets: nextBudgets,
    rates: current.rates,
    ...(current.aiConfig ? { aiConfig: current.aiConfig } : {}),
  };

  return {
    next,
    stats: {
      added,
      updated,
      total: mergedExpenses.length,
    },
  };
}

export function isSeedExpense(expense: Pick<ExpenseRecord, 'id'>): boolean {
  return expense.id.startsWith('seed-');
}

export function countSeedExpenses(expenses: ExpenseRecord[]): number {
  return expenses.filter(isSeedExpense).length;
}

export function clearLedgerExpenses(
  current: LedgerData,
  scope: 'samples' | 'all'
): { next: LedgerData; removedCount: number } {
  const nextExpenses =
    scope === 'all'
      ? []
      : current.expenses.filter((exp) => !isSeedExpense(exp));
  const removedCount = current.expenses.length - nextExpenses.length;
  return {
    next: {
      ...current,
      expenses: nextExpenses,
    },
    removedCount,
  };
}
