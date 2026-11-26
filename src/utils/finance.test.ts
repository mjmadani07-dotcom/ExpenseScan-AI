import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatJalaliDate,
  getJalaliMonthKey,
  gregorianToJalali,
  jalaliToGregorian,
  jalaliToIsoDate,
  toPersianDigits,
} from './jalali';
import {
  DEFAULT_EXPENSE_FILTERS,
  clearLedgerExpenses,
  computeDomainBreakdown,
  computeMonthlyTrend,
  convertRialTomanValues,
  convertTomanToDisplayUnit,
  countSeedExpenses,
  derivePaymentStatusFromTranches,
  detectPotentialDuplicates,
  exportExpensesToCsv,
  filterExpenses,
  formatCompactCurrency,
  mergeLedgerData,
  normalizeToToman,
  parseAndValidateLedgerImport,
  summarizeExpensePayments,
} from './finance';
import { normalizeExtractedExpenseList, stripJsonCodeFences } from './aiSchema';
import { maskApiKey } from './localKeyVault';
import type { CategoryBudget, ExchangeRates, ExpenseRecord, LedgerData } from '../types/expense';

const SAMPLE_RATES: ExchangeRates = { USD: 70000, EUR: 76000 };

const SAMPLE_EXPENSES: ExpenseRecord[] = [
  {
    id: 'exp-1',
    title: 'سرور ابری و دامنه',
    vendor: 'آروان کلود',
    documentType: 'invoice',
    category: 'infrastructure',
    costCenter: 'engineering',
    amount: 45000000,
    currency: 'IRR',
    taxAmount: 4500000,
    discountAmount: 0,
    date: '2026-11-10',
    invoiceNumber: 'INV-1405-881',
    trackingCode: 'TRK-9901',
    paymentMethod: 'bank_transfer',
    paymentStatus: 'paid',
    lineItems: [{ description: 'سرور ابری ماهانه', quantity: 1, unitPrice: 45000000, totalPrice: 45000000 }],
    sourceType: 'pdf',
    createdAt: '2026-11-10T10:00:00Z',
    approvedAt: '2026-11-10T10:05:00Z',
  },
  {
    id: 'exp-2',
    title: 'اشتراک سرویس هوش مصنوعی',
    vendor: 'Cloudflare',
    documentType: 'receipt',
    category: 'infrastructure',
    costCenter: 'engineering',
    amount: 100,
    currency: 'USD',
    exchangeRateToToman: 65000, // Historical rate locked on document
    taxAmount: 0,
    discountAmount: 0,
    date: '2026-10-15',
    invoiceNumber: 'CF-2026-10',
    paymentMethod: 'corporate_card',
    paymentStatus: 'paid',
    lineItems: [],
    sourceType: 'image',
    createdAt: '2026-10-15T12:00:00Z',
    approvedAt: '2026-10-15T12:02:00Z',
  },
  {
    id: 'exp-3',
    title: 'کمپین تبلیغاتی پاییز',
    vendor: 'یکتانت',
    documentType: 'proforma',
    category: 'marketing',
    costCenter: 'sales',
    amount: 12000000,
    currency: 'IRT',
    taxAmount: 1080000,
    discountAmount: 0,
    date: '2026-11-18',
    paymentMethod: 'bank_transfer',
    paymentStatus: 'pending',
    lineItems: [],
    sourceType: 'text',
    createdAt: '2026-11-18T09:00:00Z',
    approvedAt: '2026-11-18T09:10:00Z',
  },
];

test('gregorianToJalali and jalaliToGregorian round-trip accurately', () => {
  const j = gregorianToJalali(2026, 3, 21);
  assert.deepEqual(j, { jy: 1405, jm: 1, jd: 1 });
  assert.deepEqual(jalaliToGregorian(1405, 1, 1), { gy: 2026, gm: 3, gd: 21 });
  assert.equal(jalaliToIsoDate(1405, 9, 4), '2026-11-25');
  assert.equal(formatJalaliDate('2026-11-25'), '۱۴۰۵/۰۹/۰۴');
  assert.equal(toPersianDigits('1405/01/01'), '۱۴۰۵/۰۱/۰۱');
});

test('normalizeToToman prioritizes per-document historical rate over global rate', () => {
  assert.equal(normalizeToToman(45000000, 'IRR', SAMPLE_RATES), 4500000);
  assert.equal(normalizeToToman(12000000, 'IRT', SAMPLE_RATES), 12000000);
  assert.equal(normalizeToToman(100, 'USD', SAMPLE_RATES), 7000000);
  assert.equal(normalizeToToman(100, 'USD', SAMPLE_RATES, 65000), 6500000);
  assert.equal(normalizeToToman(50, 'EUR', SAMPLE_RATES, 72000), 3600000);
});

test('convertRialTomanValues converts amounts, tax, discount, and lineItems between IRR and IRT', () => {
  const toToman = convertRialTomanValues({
    amount: 45000000,
    taxAmount: 4500000,
    discountAmount: 500000,
    lineItems: [{ description: 'سرور', quantity: 1, unitPrice: 40000000, totalPrice: 40000000 }],
    fromCurrency: 'IRR',
    toCurrency: 'IRT',
  });
  assert.equal(toToman.currency, 'IRT');
  assert.equal(toToman.amount, 4500000);
  assert.equal(toToman.taxAmount, 450000);
  assert.equal(toToman.discountAmount, 50000);
  assert.equal(toToman.lineItems[0].unitPrice, 4000000);

  const backToRial = convertRialTomanValues({
    ...toToman,
    fromCurrency: 'IRT',
    toCurrency: 'IRR',
  });
  assert.equal(backToRial.currency, 'IRR');
  assert.equal(backToRial.amount, 45000000);
  assert.equal(convertTomanToDisplayUnit(1000000, 'IRR'), 10000000);
  assert.ok(formatCompactCurrency(1000000, 'IRR').includes('ریال'));
});

test('detectPotentialDuplicates identifies duplicate tracking code, invoice number, or matching vendor+amount+date', () => {
  const byTrack = detectPotentialDuplicates(
    { vendor: 'سایر', amount: 100, currency: 'IRT', date: '2026-11-01', trackingCode: 'TRK-9901' },
    SAMPLE_EXPENSES,
    SAMPLE_RATES
  );
  assert.equal(byTrack.length, 1);

  const byInv = detectPotentialDuplicates(
    { vendor: 'سایر', amount: 100, currency: 'IRT', date: '2026-11-01', invoiceNumber: 'INV-1405-881' },
    SAMPLE_EXPENSES,
    SAMPLE_RATES
  );
  assert.equal(byInv.length, 1);

  const bySimilarity = detectPotentialDuplicates(
    { vendor: 'یکتانت', amount: 12000000, currency: 'IRT', date: '2026-11-18' },
    SAMPLE_EXPENSES,
    SAMPLE_RATES
  );
  assert.equal(bySimilarity.length, 1);
});

test('computeDomainBreakdown respects locked per-document exchange rate and period scaling', () => {
  const budgets: CategoryBudget[] = [
    { category: 'infrastructure', monthlyLimitIRT: 20000000 },
    { category: 'marketing', monthlyLimitIRT: 10000000 },
  ];
  const breakdown = computeDomainBreakdown(SAMPLE_EXPENSES, budgets, SAMPLE_RATES, 1);
  const infra = breakdown.find((d) => d.category === 'infrastructure');
  // 4,500,000 (IRR->IRT) + 100 * 65,000 (locked rate) = 11,000,000
  assert.equal(infra?.totalIRT, 11000000);
});

test('computeMonthlyTrend groups expenses chronologically by Jalali month', () => {
  const trend = computeMonthlyTrend(SAMPLE_EXPENSES, SAMPLE_RATES);
  assert.equal(trend.length, 2);
  assert.ok(trend[0].monthKey < trend[1].monthKey);
  assert.equal(getJalaliMonthKey('2026-11-10'), trend[1].monthKey);
});

test('filterExpenses filters by query, category, status, paymentMethod, currency, date range, and sorts accurately', () => {
  const onlyPending = filterExpenses(
    SAMPLE_EXPENSES,
    { ...DEFAULT_EXPENSE_FILTERS, paymentStatus: 'pending' },
    new Date('2026-11-25'),
    SAMPLE_RATES
  );
  assert.equal(onlyPending.length, 1);
  assert.equal(onlyPending[0].id, 'exp-3');

  // Sort by date ascending vs descending
  const dateAsc = filterExpenses(
    SAMPLE_EXPENSES,
    { ...DEFAULT_EXPENSE_FILTERS, sortBy: 'date_asc' },
    new Date('2026-11-25'),
    SAMPLE_RATES
  );
  assert.deepEqual(
    dateAsc.map((e) => e.id),
    ['exp-2', 'exp-1', 'exp-3']
  );

  const dateDesc = filterExpenses(
    SAMPLE_EXPENSES,
    { ...DEFAULT_EXPENSE_FILTERS, sortBy: 'date_desc' },
    new Date('2026-11-25'),
    SAMPLE_RATES
  );
  assert.deepEqual(
    dateDesc.map((e) => e.id),
    ['exp-3', 'exp-1', 'exp-2']
  );

  // Sort by normalized Toman amount (exp-3: 12M, exp-2: 6.5M, exp-1: 4.5M)
  const amountDesc = filterExpenses(
    SAMPLE_EXPENSES,
    { ...DEFAULT_EXPENSE_FILTERS, sortBy: 'amount_desc' },
    new Date('2026-11-25'),
    SAMPLE_RATES
  );
  assert.deepEqual(
    amountDesc.map((e) => e.id),
    ['exp-3', 'exp-2', 'exp-1']
  );

  const amountAsc = filterExpenses(
    SAMPLE_EXPENSES,
    { ...DEFAULT_EXPENSE_FILTERS, sortBy: 'amount_asc' },
    new Date('2026-11-25'),
    SAMPLE_RATES
  );
  assert.deepEqual(
    amountAsc.map((e) => e.id),
    ['exp-1', 'exp-2', 'exp-3']
  );

  // Currency & date range filter
  const usdFiltered = filterExpenses(
    SAMPLE_EXPENSES,
    { ...DEFAULT_EXPENSE_FILTERS, currency: 'USD', dateFrom: '2026-10-01', dateTo: '2026-10-31' },
    new Date('2026-11-25'),
    SAMPLE_RATES
  );
  assert.equal(usdFiltered.length, 1);
  assert.equal(usdFiltered[0].id, 'exp-2');

  // Payment method filter matching split payment tranche
  const withTranche: ExpenseRecord[] = [
    ...SAMPLE_EXPENSES,
    {
      ...SAMPLE_EXPENSES[2],
      id: 'exp-split',
      paymentMethod: 'bank_transfer',
      paymentStatus: 'partial',
      paymentTranches: [
        { id: 't1', title: 'پیش‌پرداخت', amount: 4000000, method: 'bank_transfer', status: 'paid' },
        { id: 't2', title: 'چک صیادی', amount: 8000000, method: 'check', status: 'pending' },
      ],
    },
  ];
  const checkMatches = filterExpenses(
    withTranche,
    { ...DEFAULT_EXPENSE_FILTERS, paymentMethod: 'check' },
    new Date('2026-11-25'),
    SAMPLE_RATES
  );
  assert.equal(checkMatches.length, 1);
  assert.equal(checkMatches[0].id, 'exp-split');
});

test('exportExpensesToCsv produces UTF-8 BOM CSV with Jalali date and historical rate column', () => {
  const csv = exportExpensesToCsv(SAMPLE_EXPENSES, SAMPLE_RATES);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('65000'));
  const lines = csv.trim().split('\n');
  assert.equal(lines.length, 4);
});

test('summarizeExpensePayments and derivePaymentStatusFromTranches handle advance + check split payments', () => {
  const tranches = [
    {
      id: 't1',
      title: 'پیش‌پرداخت',
      amount: 15000000,
      method: 'bank_transfer' as const,
      status: 'paid' as const,
      date: '2026-11-10',
    },
    {
      id: 't2',
      title: 'چک صیادی ۳۰ روزه',
      amount: 35000000,
      method: 'check' as const,
      status: 'pending' as const,
      date: '2026-12-10',
      referenceCode: 'CHK-44102',
    },
  ];
  assert.equal(derivePaymentStatusFromTranches(50000000, tranches, 'pending'), 'partial');

  const summary = summarizeExpensePayments(
    {
      amount: 50000000,
      currency: 'IRT',
      paymentStatus: 'partial',
      paymentTranches: tranches,
    },
    SAMPLE_RATES
  );
  assert.equal(summary.paidIRT, 15000000);
  assert.equal(summary.remainingIRT, 35000000);
  assert.equal(summary.paidPercent, 30);
  assert.equal(summary.derivedStatus, 'partial');

  const allPaid = tranches.map((t) => ({ ...t, status: 'paid' as const }));
  assert.equal(derivePaymentStatusFromTranches(50000000, allPaid, 'partial'), 'paid');

  const scaledToRial = convertRialTomanValues({
    amount: 50000000,
    taxAmount: 0,
    discountAmount: 0,
    lineItems: [],
    paymentTranches: tranches,
    fromCurrency: 'IRT',
    toCurrency: 'IRR',
  });
  assert.equal(scaledToRial.paymentTranches?.[0].amount, 150000000);
  assert.equal(scaledToRial.paymentTranches?.[1].amount, 350000000);
});

test('parseAndValidateLedgerImport and mergeLedgerData handle merge and replace across devices', () => {
  const current: LedgerData = {
    expenses: SAMPLE_EXPENSES,
    budgets: [{ category: 'infrastructure', monthlyLimitIRT: 20000000 }],
    rates: SAMPLE_RATES,
    aiConfig: { provider: 'openai', model: 'gpt-4o-mini' },
  };

  const incomingRaw = JSON.stringify({
    expenses: [
      {
        ...SAMPLE_EXPENSES[0],
        title: 'سرور ابری بروزرسانی‌شده از دستگاه دوم',
        amount: 55000000,
      },
      {
        id: 'device2-exp-9',
        title: 'خرید لایسنس از دستگاه دوم',
        vendor: 'JetBrains',
        documentType: 'invoice',
        category: 'infrastructure',
        costCenter: 'engineering',
        amount: 199,
        currency: 'USD',
        exchangeRateToToman: 71000,
        taxAmount: 0,
        discountAmount: 0,
        date: '2026-11-21',
        paymentMethod: 'corporate_card',
        paymentStatus: 'paid',
        lineItems: [],
        sourceType: 'image',
      },
    ],
    rates: { USD: 72000, EUR: 78000 },
  });

  const validated = parseAndValidateLedgerImport(incomingRaw);
  assert.equal(validated.expenses.length, 2);

  // Merge: 1 updated (exp-1), 1 added (device2-exp-9), exp-2 & exp-3 preserved => total 4
  const merged = mergeLedgerData(current, validated, 'merge');
  assert.equal(merged.stats.added, 1);
  assert.equal(merged.stats.updated, 1);
  assert.equal(merged.stats.total, 4);
  assert.equal(
    merged.next.expenses.find((e) => e.id === 'exp-1')?.title,
    'سرور ابری بروزرسانی‌شده از دستگاه دوم'
  );
  assert.equal(merged.next.aiConfig?.provider, 'openai');

  // Replace: strictly replaces expenses with incoming 2 items while preserving aiConfig
  const replaced = mergeLedgerData(current, validated, 'replace');
  assert.equal(replaced.stats.total, 2);
  assert.equal(replaced.next.expenses.length, 2);
  assert.equal(replaced.next.rates.USD, 72000);
  assert.equal(replaced.next.aiConfig?.provider, 'openai');

  // Invalid JSON throws descriptive Persian error
  assert.throws(() => parseAndValidateLedgerImport('{not valid json'), /معتبر نیست/);
  assert.throws(() => parseAndValidateLedgerImport({ foo: 'bar' }), /ساختار فایل JSON/);
});

test('clearLedgerExpenses removes only seed examples or all records cleanly', () => {
  const mixed: LedgerData = {
    expenses: [
      { ...SAMPLE_EXPENSES[0], id: 'seed-1' },
      { ...SAMPLE_EXPENSES[1], id: 'seed-2' },
      { ...SAMPLE_EXPENSES[2], id: 'exp-real-101' },
    ],
    budgets: [],
    rates: SAMPLE_RATES,
  };
  assert.equal(countSeedExpenses(mixed.expenses), 2);

  const clearedSamples = clearLedgerExpenses(mixed, 'samples');
  assert.equal(clearedSamples.removedCount, 2);
  assert.deepEqual(
    clearedSamples.next.expenses.map((e) => e.id),
    ['exp-real-101']
  );

  const clearedAll = clearLedgerExpenses(mixed, 'all');
  assert.equal(clearedAll.removedCount, 3);
  assert.equal(clearedAll.next.expenses.length, 0);
});

test('aiSchema normalizes provider output and masks API keys safely', () => {
  const raw = stripJsonCodeFences('```json\n{"expenses":[]}\n```');
  assert.equal(raw, '{"expenses":[]}');

  const normalized = normalizeExtractedExpenseList(
    [{ title: 'خرید سرویس', vendor: 'تست', amount: 250000, currency: 'IRT' }],
    '2026-11-25'
  );
  assert.equal(normalized[0].date, '2026-11-25');
  assert.equal(normalized[0].currency, 'IRT');
  assert.equal(maskApiKey('sk-proj-1234567890abcd'), 'sk-p••••••abcd');
  assert.equal(maskApiKey('short'), '••••••••');
});
