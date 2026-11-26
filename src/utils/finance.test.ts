import { businessDateIso, addCalendarDays, parseIsoDate, getJalaliMonthLength } from './jalali';
import { validateExpenseFields, validateExpensePatch } from './expenseValidation';
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
  DEFAULT_CATEGORIES,
  DEFAULT_EXPENSE_FILTERS,
  clearLedgerExpenses,
  computeDomainBreakdown,
  computeMonthlyTrend,
  computePurchaserBreakdown,
  convertRialTomanValues,
  getEntryCurrency,
  toEntryAmount,
  fromEntryAmount,
  formatDisplayAmount,
  convertTomanToDisplayUnit,
  countSeedExpenses,
  createCustomCategoryId,
  deleteCategoryAndReassign,
  derivePaymentStatusFromTranches,
  detectPotentialDuplicates,
  exportExpensesToCsv,
  filterExpenses,
  formatCompactCurrency,
  getCategoryLabel,
  getUniquePurchasers,
  mergeLedgerData,
  normalizePurchaserName,
  normalizeToToman,
  parseAndValidateLedgerImport,
  sanitizeCategories,
  summarizeExpensePayments,
} from './finance';
import { buildExpenseWorkbook, exportExpensesToXlsxBuffer } from './excelExport';
import {
  buildExtractionSystemInstruction,
  normalizeExtractedExpenseList,
  stripJsonCodeFences,
} from './aiSchema';
import {
  buildGeminiEndpoints,
  buildOpenAiChatCompletionsUrl,
  validateClientBaseUrl,
  validateServerBaseUrl,
} from './aiUrls';
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

test('aiSchema normalizes provider output, strips redundant single tranches, and preserves true split payments', () => {
  const raw = stripJsonCodeFences('```json\n{"expenses":[]}\n```');
  assert.equal(raw, '{"expenses":[]}');

  const normalized = normalizeExtractedExpenseList(
    [{ title: 'خرید سرویس', vendor: 'تست', amount: 250000, currency: 'IRT' }],
    '2026-11-25'
  );
  assert.equal(normalized[0].date, '2026-11-25');
  assert.equal(normalized[0].currency, 'IRT');
  assert.equal(normalized[0].paymentTranches, undefined);

  // Redundant 1-item full-amount tranche on a paid invoice must be stripped
  const paidWithFakeTranche = normalizeExtractedExpenseList(
    [
      {
        title: 'رسید کارتخوان',
        vendor: 'فروشگاه',
        amount: 500000,
        currency: 'IRT',
        paymentStatus: 'paid',
        paymentTranches: [
          { title: 'پیش‌پرداخت', amount: 500000, method: 'corporate_card', status: 'paid' },
        ],
      },
    ],
    '2026-11-25'
  );
  assert.equal(paidWithFakeTranche[0].paymentStatus, 'paid');
  assert.equal(paidWithFakeTranche[0].paymentTranches, undefined);

  // Genuine advance + check split must be preserved with partial status
  const trueSplit = normalizeExtractedExpenseList(
    [
      {
        title: 'قرارداد طراحی',
        vendor: 'استودیو',
        amount: 10000000,
        currency: 'IRT',
        paymentStatus: 'paid',
        paymentTranches: [
          { title: 'پیش‌پرداخت', amount: 3000000, method: 'bank_transfer', status: 'paid' },
          { title: 'چک مابقی', amount: 7000000, method: 'check', status: 'pending' },
        ],
      },
    ],
    '2026-11-25'
  );
  assert.equal(trueSplit[0].paymentStatus, 'partial');
  assert.equal(trueSplit[0].paymentTranches?.length, 2);

  assert.equal(maskApiKey('sk-proj-1234567890abcd'), 'sk-p••••••abcd');
  assert.equal(maskApiKey('short'), '••••••••');
});

test('buildExpenseWorkbook and exportExpensesToXlsxBuffer generate styled RTL multi-sheet Excel', () => {
  const sampleBudgets: CategoryBudget[] = [
    { category: 'infrastructure', monthlyLimitIRT: 20_000_000 },
  ];
  const wb = buildExpenseWorkbook(SAMPLE_EXPENSES, sampleBudgets, SAMPLE_RATES, 'IRT');
  assert.deepEqual(wb.SheetNames, [
    'دفتر کل هزینه‌ها',
    'خلاصه حوزه‌ها و بودجه',
    'پرداخت‌های ترکیبی و چک‌ها',
    'اقلام ریز فاکتورها',
    'خلاصه مسئولان خرید',
  ]);
  assert.equal(wb.Workbook?.Views?.[0]?.RTL, true);

  const ledgerSheet = wb.Sheets['دفتر کل هزینه‌ها'] as Record<string, { v?: unknown; s?: Record<string, unknown> }>;
  assert.ok(ledgerSheet.A1?.s, 'Title banner should carry styling');
  assert.ok(ledgerSheet.A4?.s, 'Header row should carry styling');
  // Status cell (column Q = index 16 after inserting purchaser) on row 5 (first expense: paid)
  assert.ok(ledgerSheet.Q5?.s, 'Status badge cell should carry color styling');

  const bytes = exportExpensesToXlsxBuffer(SAMPLE_EXPENSES, sampleBudgets, SAMPLE_RATES, 'IRT');
  assert.ok(bytes.byteLength > 2000, 'XLSX buffer should be non-trivial');
  // Standard ZIP / XLSX magic header "PK"
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
});

test('aiUrls validates Base URLs safely, blocks SSRF targets server-side, and resolves provider endpoints', () => {
  // Client validation accepts https proxies and local HTTP LLM servers (e.g. Ollama)
  assert.equal(validateClientBaseUrl(''), undefined);
  assert.equal(validateClientBaseUrl('https://proxy.example.com/v1///'), 'https://proxy.example.com/v1');
  assert.equal(validateClientBaseUrl('http://localhost:11434/v1/'), 'http://localhost:11434/v1');
  assert.throws(() => validateClientBaseUrl('javascript:alert(1)'), /شروع شود/);
  assert.throws(() => validateClientBaseUrl('not-a-url'), /معتبر نیست/);
  assert.throws(() => validateClientBaseUrl('https://user:pass@proxy.example.com'), /نام کاربری/);

  // Server validation enforces HTTPS and blocks loopback / link-local / private RFC1918
  assert.equal(validateServerBaseUrl('https://api.avalai.ir/v1/'), 'https://api.avalai.ir/v1');
  assert.throws(() => validateServerBaseUrl('http://proxy.example.com/v1'), /https/);
  assert.throws(() => validateServerBaseUrl('https://localhost:8080/v1'), /داخلی یا لوکال/);
  assert.throws(() => validateServerBaseUrl('https://127.0.0.1/v1'), /داخلی یا لوکال/);
  assert.throws(() => validateServerBaseUrl('https://169.254.169.254/latest'), /داخلی یا لوکال/);
  assert.throws(() => validateServerBaseUrl('https://192.168.1.10/v1'), /داخلی یا لوکال/);
  assert.throws(() => validateServerBaseUrl('https://10.0.0.5/v1'), /داخلی یا لوکال/);

  // OpenAI / OpenRouter URL normalization
  assert.equal(
    buildOpenAiChatCompletionsUrl('openai'),
    'https://api.openai.com/v1/chat/completions'
  );
  assert.equal(
    buildOpenAiChatCompletionsUrl('openrouter'),
    'https://openrouter.ai/api/v1/chat/completions'
  );
  assert.equal(
    buildOpenAiChatCompletionsUrl('openai', 'https://proxy.example.com'),
    'https://proxy.example.com/v1/chat/completions'
  );
  assert.equal(
    buildOpenAiChatCompletionsUrl('openai', 'https://api.avalai.ir/v1'),
    'https://api.avalai.ir/v1/chat/completions'
  );
  assert.equal(
    buildOpenAiChatCompletionsUrl('openai', 'https://custom.ai/gw/v1/chat/completions'),
    'https://custom.ai/gw/v1/chat/completions'
  );

  // Gemini URL normalization (both SDK baseUrl and direct REST)
  assert.deepEqual(buildGeminiEndpoints('gemini-2.5-flash'), {
    sdkBaseUrl: 'https://generativelanguage.googleapis.com',
    restGenerateContentUrl:
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
  });
  assert.deepEqual(buildGeminiEndpoints('gemini-2.5-flash', 'https://gem-proxy.example.com/v1beta'), {
    sdkBaseUrl: 'https://gem-proxy.example.com',
    apiVersion: 'v1beta',
    restGenerateContentUrl:
      'https://gem-proxy.example.com/v1beta/models/gemini-2.5-flash:generateContent',
  });
  assert.deepEqual(buildGeminiEndpoints('gemini-2.5-flash', 'https://gem-proxy.example.com'), {
    sdkBaseUrl: 'https://gem-proxy.example.com',
    restGenerateContentUrl:
      'https://gem-proxy.example.com/v1beta/models/gemini-2.5-flash:generateContent',
  });
});

test('purchaser normalization, filtering, per-person totals, and AI extraction work accurately', () => {
  assert.equal(normalizePurchaserName('  علی   رضایی '), 'علی رضایی');
  assert.equal(normalizePurchaserName('   '), undefined);

  const withPurchasers: ExpenseRecord[] = [
    {
      ...SAMPLE_EXPENSES[0],
      purchaser: 'علی رضایی',
      paymentMethod: 'personal_card', // 4,500,000 IRT
    },
    {
      ...SAMPLE_EXPENSES[1],
      purchaser: '  علی   رضایی ',
      paymentMethod: 'corporate_card', // 6,500,000 IRT
    },
    {
      ...SAMPLE_EXPENSES[2],
      purchaser: 'سارا کریمی',
      paymentMethod: 'petty_cash', // 12,000,000 IRT pending
    },
    {
      ...SAMPLE_EXPENSES[2],
      id: 'exp-4',
      purchaser: undefined,
      amount: 1000000,
      paymentMethod: 'bank_transfer',
      paymentStatus: 'paid',
    },
  ];

  const unique = getUniquePurchasers(withPurchasers);
  assert.equal(unique.length, 2);
  assert.ok(unique.includes('علی رضایی'));
  assert.ok(unique.includes('سارا کریمی'));

  const aliOnly = filterExpenses(
    withPurchasers,
    { ...DEFAULT_EXPENSE_FILTERS, purchaser: 'علی رضایی' },
    new Date('2026-11-25'),
    SAMPLE_RATES
  );
  assert.equal(aliOnly.length, 2);

  const unassignedOnly = filterExpenses(
    withPurchasers,
    { ...DEFAULT_EXPENSE_FILTERS, purchaser: '__unassigned__' },
    new Date('2026-11-25'),
    SAMPLE_RATES
  );
  assert.equal(unassignedOnly.length, 1);
  assert.equal(unassignedOnly[0].id, 'exp-4');

  const queryMatch = filterExpenses(
    withPurchasers,
    { ...DEFAULT_EXPENSE_FILTERS, query: 'سارا کریمی' },
    new Date('2026-11-25'),
    SAMPLE_RATES
  );
  assert.equal(queryMatch.length, 1);
  assert.equal(queryMatch[0].id, 'exp-3');

  const breakdown = computePurchaserBreakdown(withPurchasers, SAMPLE_RATES);
  assert.equal(breakdown.length, 3);
  const sara = breakdown.find((p) => p.purchaserKey === 'سارا کریمی');
  const ali = breakdown.find((p) => p.purchaserKey === 'علی رضایی');
  const unassigned = breakdown.find((p) => p.isUnassigned);
  assert.equal(sara?.totalIRT, 12000000);
  assert.equal(sara?.personalOutOfPocketIRT, 12000000);
  assert.equal(sara?.pendingIRT, 12000000);
  assert.equal(ali?.totalIRT, 11000000);
  assert.equal(ali?.personalOutOfPocketIRT, 4500000);
  assert.equal(ali?.count, 2);
  assert.equal(unassigned?.count, 1);

  const aiParsed = normalizeExtractedExpenseList(
    [
      {
        title: 'خرید کابل شبکه',
        vendor: 'فروشگاه رایانه',
        amount: 450000,
        currency: 'IRT',
        purchaser: '  مهدی   نوری ',
        paymentMethod: 'personal_card',
      },
    ],
    '2026-11-26'
  );
  assert.equal(aiParsed[0].purchaser, 'مهدی نوری');
  assert.equal(aiParsed[0].paymentMethod, 'personal_card');
});

test('dynamic categories support CRUD, reassignment on delete, breakdown, exports, JSON sync, and AI extraction', () => {
  const sanitized = sanitizeCategories([
    { id: 'infrastructure', label: 'زیرساخت و کلود', color: '#0f766e', isDefault: true },
    { id: 'cat_training', label: '  آموزش   سازمانی ', color: '#7c3aed', description: 'دوره، کارگاه، کتاب' },
    { id: 'cat_training', label: 'تکراری', color: '#111111' }, // duplicate id ignored
    { id: 'bad', label: '', color: '#000000' }, // empty label ignored
  ]);
  assert.equal(sanitized.length, 2);
  assert.equal(sanitized[1].label, 'آموزش سازمانی');

  const customCategories = [
    ...DEFAULT_CATEGORIES,
    {
      id: createCustomCategoryId(DEFAULT_CATEGORIES.map((c) => c.id)),
      label: 'آموزش سازمانی',
      color: '#7c3aed',
      description: 'دوره، کارگاه، کتاب',
    },
  ];
  const customCat = customCategories[customCategories.length - 1];
  assert.ok(customCat.id.startsWith('cat-'));
  assert.equal(getCategoryLabel(customCat.id, customCategories), 'آموزش سازمانی');

  const customExpenses: ExpenseRecord[] = [
    ...SAMPLE_EXPENSES,
    {
      ...SAMPLE_EXPENSES[0],
      id: 'exp-custom-1',
      title: 'ثبت‌نام دوره معماری نرم‌افزار',
      category: customCat.id,
      amount: 8000000,
      currency: 'IRT',
      taxAmount: 0,
      discountAmount: 0,
    },
  ];
  const customBudgets: CategoryBudget[] = [
    { category: 'infrastructure', monthlyLimitIRT: 20000000 },
    { category: customCat.id, monthlyLimitIRT: 15000000 },
  ];

  // Domain breakdown includes the custom category with custom label & color
  const breakdown = computeDomainBreakdown(
    customExpenses,
    customBudgets,
    SAMPLE_RATES,
    1,
    customCategories
  );
  const trainingRow = breakdown.find((row) => row.category === customCat.id);
  assert.equal(trainingRow?.label, 'آموزش سازمانی');
  assert.equal(trainingRow?.color, '#7c3aed');
  assert.equal(trainingRow?.totalIRT, 8000000);
  assert.equal(trainingRow?.monthlyLimitIRT, 15000000);

  // CSV & Excel use custom category label
  const csv = exportExpensesToCsv(customExpenses, SAMPLE_RATES, customCategories);
  assert.ok(csv.includes('آموزش سازمانی'));
  const wb = buildExpenseWorkbook(
    customExpenses,
    customBudgets,
    SAMPLE_RATES,
    'IRT',
    customCategories
  );
  const ledgerSheet = wb.Sheets['دفتر کل هزینه‌ها'] as Record<string, { v?: unknown }>;
  const hasCustomLabelInExcel = Object.values(ledgerSheet).some(
    (cell) => cell?.v === 'آموزش سازمانی'
  );
  assert.equal(hasCustomLabelInExcel, true);

  // AI prompt & extraction recognize the custom category ID & keywords
  const prompt = buildExtractionSystemInstruction('2026-11-26', true, customCategories);
  assert.ok(prompt.includes(customCat.id));
  assert.ok(prompt.includes('آموزش سازمانی'));
  const extracted = normalizeExtractedExpenseList(
    [
      {
        title: 'خرید دوره تخصصی React',
        vendor: 'مکتب‌خونه',
        amount: 2500000,
        currency: 'IRT',
        category: customCat.id,
      },
      {
        title: 'هزینه نامعلوم',
        vendor: 'متفرقه',
        amount: 100000,
        currency: 'IRT',
        category: 'nonexistent_cat_id',
      },
    ],
    '2026-11-26',
    customCategories
  );
  assert.equal(extracted[0].category, customCat.id);
  assert.equal(extracted[1].category, 'other');

  // JSON import/merge preserves custom categories and custom expense category IDs
  const exportedJson = JSON.stringify({
    categories: customCategories,
    budgets: customBudgets,
    expenses: customExpenses,
    rates: SAMPLE_RATES,
  });
  const imported = parseAndValidateLedgerImport(exportedJson);
  assert.equal(imported.categories?.length, customCategories.length);
  assert.equal(
    imported.expenses.find((e) => e.id === 'exp-custom-1')?.category,
    customCat.id
  );
  const merged = mergeLedgerData(
    { categories: DEFAULT_CATEGORIES, budgets: [], expenses: [], rates: SAMPLE_RATES },
    imported,
    'merge'
  );
  assert.equal(merged.next.categories?.length, customCategories.length);

  // Deleting custom category reassigns expenses cleanly and removes its budget
  const deleted = deleteCategoryAndReassign({
    categories: customCategories,
    budgets: customBudgets,
    expenses: customExpenses,
    targetId: customCat.id,
    reassignToId: 'hr_admin',
  });
  assert.equal(deleted.reassignedCount, 1);
  assert.equal(deleted.categories.some((c) => c.id === customCat.id), false);
  assert.equal(deleted.budgets.some((b) => b.category === customCat.id), false);
  assert.equal(
    deleted.expenses.find((e) => e.id === 'exp-custom-1')?.category,
    'hr_admin'
  );

  // Cannot delete the last remaining category
  assert.throws(
    () =>
      deleteCategoryAndReassign({
        categories: [{ id: 'only_one', label: 'فقط یکی', color: '#0f766e' }],
        budgets: [],
        expenses: [],
        targetId: 'only_one',
      }),
    /حداقل یک دسته‌بندی/
  );
});

test('one global unit preserves the original currency and individual rials', () => {
  assert.equal(formatDisplayAmount(100000000, 'IRR', SAMPLE_RATES, 'IRT'), '۱۰,۰۰۰,۰۰۰ تومان');
  assert.equal(formatDisplayAmount(10000000, 'IRT', SAMPLE_RATES, 'IRR'), '۱۰۰,۰۰۰,۰۰۰ ریال');
  assert.equal(formatDisplayAmount(1, 'IRR', SAMPLE_RATES, 'IRR'), '۱ ریال');
  assert.equal(formatDisplayAmount(1, 'IRR', SAMPLE_RATES, 'IRT'), '۰.۱ تومان');
  assert.equal(formatDisplayAmount(2, 'USD', SAMPLE_RATES, 'IRT', 65000), '۱۳۰,۰۰۰ تومان');
  for (const source of ['IRR','IRT'] as const) {
    for (const unit of ['IRR','IRT'] as const) {
      assert.equal(getEntryCurrency(source, unit), unit);
      assert.equal(fromEntryAmount(toEntryAmount(12345, source, unit), source, unit), 12345);
    }
  }
  assert.equal(getEntryCurrency('USD', 'IRT'), 'USD');
  assert.equal(fromEntryAmount(123.4, 'IRR', 'IRT'), 1234);
  assert.equal(fromEntryAmount(1234, 'IRT', 'IRR'), 123.4);
});

test('Tehran business day and Gregorian date validation', () => {
  assert.equal(businessDateIso(new Date('2026-11-26T21:00:00Z')), '2026-11-27');
  assert.equal(businessDateIso(new Date('2026-11-26T20:00:00Z')), '2026-11-26');
  assert.equal(addCalendarDays('2026-11-27', 1), '2026-11-28');
  assert.equal(parseIsoDate('2026-02-30'), null);
  assert.ok(parseIsoDate('2024-02-29'));
  assert.equal(getJalaliMonthLength(1403,12),30);
  assert.equal(getJalaliMonthLength(1404,12),29);
});
test('strict expense validation rejects invalid patch and preserves identity', () => {
  const current=SAMPLE_EXPENSES[0];
  const {id,createdAt,approvedAt,...fields}=current;
  assert.equal(validateExpenseFields(fields,DEFAULT_CATEGORIES,SAMPLE_RATES).amount,current.amount);
  for(const patch of [{amount:'abc'},{amount:-1},{currency:'XYZ'},{date:'2026-02-30'},{extra:true},{id:'bad'},{taxAmount:-1}]) {
    assert.throws(()=>validateExpensePatch(current,patch,DEFAULT_CATEGORIES,SAMPLE_RATES), /نامعتبر/);
  }
  assert.equal(validateExpensePatch(current,{amount:12345},DEFAULT_CATEGORIES,SAMPLE_RATES).id,id);
  assert.throws(()=>validateExpensePatch(current,{paymentTranches:[{id:'a',title:'قسط',amount:current.amount+1,method:'check',status:'pending'}]},DEFAULT_CATEGORIES,SAMPLE_RATES),/اقساط/);
  assert.throws(()=>parseAndValidateLedgerImport([{...current,currency:'XYZ'}]),/واحد پول/);
});
