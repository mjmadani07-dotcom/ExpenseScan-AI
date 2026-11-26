import fs from 'node:fs';
import path from 'node:path';
import type {
  AiConfig,
  AiProviderId,
  CategoryBudget,
  ExchangeRates,
  ExpenseFields,
  ExpenseRecord,
  JsonImportMode,
  JsonImportStats,
  LedgerData,
} from '../src/types/expense.ts';
import {
  clearLedgerExpenses,
  mergeLedgerData,
  parseAndValidateLedgerImport,
} from '../src/utils/finance.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const LEDGER_FILE = path.join(DATA_DIR, 'ledger.json');

const DEFAULT_RATES: ExchangeRates = {
  USD: 70000,
  EUR: 76000,
};

export const DEFAULT_AI_CONFIG: AiConfig = {
  provider: 'gemini',
  model: 'gemini-4-hydrogen',
};

const VALID_PROVIDERS: readonly AiProviderId[] = ['gemini', 'openai', 'openrouter'];

function sanitizeAiConfig(input?: Partial<AiConfig>): AiConfig {
  const provider: AiProviderId =
    input?.provider && VALID_PROVIDERS.includes(input.provider)
      ? input.provider
      : DEFAULT_AI_CONFIG.provider;
  const fallbackModel =
    provider === 'openai'
      ? 'gpt-4o-mini'
      : provider === 'openrouter'
        ? 'google/gemini-2.5-flash'
        : DEFAULT_AI_CONFIG.model;
  const model =
    typeof input?.model === 'string' && input.model.trim()
      ? input.model.trim().slice(0, 120)
      : fallbackModel;
  return { provider, model };
}

const DEFAULT_BUDGETS: CategoryBudget[] = [
  { category: 'infrastructure', monthlyLimitIRT: 35000000 },
  { category: 'operations', monthlyLimitIRT: 40000000 },
  { category: 'marketing', monthlyLimitIRT: 28000000 },
  { category: 'hr_admin', monthlyLimitIRT: 25000000 },
  { category: 'equipment', monthlyLimitIRT: 45000000 },
  { category: 'tax_legal', monthlyLimitIRT: 30000000 },
  { category: 'travel', monthlyLimitIRT: 18000000 },
  { category: 'other', monthlyLimitIRT: 10000000 },
];

const SEED_EXPENSES: ExpenseRecord[] = [
  {
    id: 'seed-1',
    title: 'زیرساخت سرورهای ابری و ترافیک شبکه',
    vendor: 'ابر آروان',
    vendorTaxId: '14006123456',
    documentType: 'invoice',
    category: 'infrastructure',
    costCenter: 'engineering',
    amount: 148500000,
    currency: 'IRR',
    taxAmount: 13500000,
    discountAmount: 0,
    date: '2026-11-19',
    invoiceNumber: 'ARV-1405-4412',
    trackingCode: '88492014',
    paymentMethod: 'bank_transfer',
    paymentStatus: 'paid',
    projectTag: 'پلتفرم اصلی',
    notes: 'تمدید خوشه سرورهای تولید و شبکه توزیع محتوا',
    lineItems: [
      { description: 'سرور ابری پردازشی (۳ نود)', quantity: 3, unitPrice: 38000000, totalPrice: 114000000 },
      { description: 'ترافیک و CDN ماهانه', quantity: 1, unitPrice: 21000000, totalPrice: 21000000 },
    ],
    sourceType: 'pdf',
    sourceFileName: 'arvancloud-aban-1405.pdf',
    pageCount: 2,
    createdAt: '2026-11-19T08:30:00.000Z',
    approvedAt: '2026-11-19T08:35:00.000Z',
  },
  {
    id: 'seed-2',
    title: 'کمپین تبلیغات همسان و کلیکی آبان‌ماه',
    vendor: 'یکتانت',
    documentType: 'proforma',
    category: 'marketing',
    costCenter: 'sales',
    amount: 22500000,
    currency: 'IRT',
    taxAmount: 2025000,
    discountAmount: 500000,
    date: '2026-11-14',
    invoiceNumber: 'YKT-90421',
    paymentMethod: 'check',
    paymentStatus: 'partial',
    paymentTranches: [
      {
        id: 'seed-2-tr1',
        title: 'پیش‌پرداخت توافقی',
        amount: 9000000,
        method: 'bank_transfer',
        status: 'paid',
        date: '2026-11-14',
        referenceCode: '44901822',
      },
      {
        id: 'seed-2-tr2',
        title: 'چک صیادی تسویه کمپین',
        amount: 13500000,
        method: 'check',
        status: 'pending',
        date: '2026-12-14',
        referenceCode: 'SYD-882014',
      },
    ],
    dueDate: '2026-12-14',
    projectTag: 'جذب سرنخ B2B',
    notes: '۴۰ درصد پیش‌پرداخت حواله شد و مابقی با چک صیادی یک‌ماهه تسویه می‌شود',
    lineItems: [
      { description: 'شارژ کمپین بنری و همسان', quantity: 1, unitPrice: 20975000, totalPrice: 20975000 },
    ],
    sourceType: 'pdf',
    sourceFileName: 'yektanet-proforma.pdf',
    pageCount: 1,
    createdAt: '2026-11-14T11:20:00.000Z',
    approvedAt: '2026-11-14T11:25:00.000Z',
  },
  {
    id: 'seed-3',
    title: 'خرید دو دستگاه مانیتور ۴K واحد فنی',
    vendor: 'دیجی‌کالا بیزینس',
    documentType: 'invoice',
    category: 'equipment',
    costCenter: 'engineering',
    amount: 34600000,
    currency: 'IRT',
    taxAmount: 3114000,
    discountAmount: 800000,
    date: '2026-11-08',
    invoiceNumber: 'DKB-771209',
    trackingCode: '55109382',
    paymentMethod: 'corporate_card',
    paymentStatus: 'paid',
    projectTag: 'تجهیز ایستگاه کار',
    lineItems: [
      { description: 'مانیتور ۲۷ اینچ صنعتی', quantity: 2, unitPrice: 16143000, totalPrice: 32286000 },
    ],
    sourceType: 'image',
    sourceFileName: 'digikala-monitors.jpg',
    createdAt: '2026-11-08T14:15:00.000Z',
    approvedAt: '2026-11-08T14:20:00.000Z',
  },
  {
    id: 'seed-4',
    title: 'سرویس‌های API و امنیت لبه Cloudflare',
    vendor: 'Cloudflare Inc.',
    documentType: 'receipt',
    category: 'infrastructure',
    costCenter: 'engineering',
    amount: 145,
    currency: 'USD',
    exchangeRateToToman: 68500,
    taxAmount: 0,
    discountAmount: 0,
    date: '2026-11-03',
    invoiceNumber: 'CF-2026-1103',
    paymentMethod: 'corporate_card',
    paymentStatus: 'paid',
    projectTag: 'پلتفرم اصلی',
    lineItems: [
      { description: 'Pro Plan + Workers Paid', quantity: 1, unitPrice: 145, totalPrice: 145 },
    ],
    sourceType: 'text',
    createdAt: '2026-11-03T07:45:00.000Z',
    approvedAt: '2026-11-03T07:50:00.000Z',
  },
  {
    id: 'seed-5',
    title: 'ارسال مرسولات و پیک قراردادی مهرماه',
    vendor: 'الوپیک سازمانی',
    documentType: 'invoice',
    category: 'operations',
    costCenter: 'operations',
    amount: 18400000,
    currency: 'IRT',
    taxAmount: 1656000,
    discountAmount: 0,
    date: '2026-10-24',
    invoiceNumber: 'ALO-1405-712',
    trackingCode: '31094822',
    paymentMethod: 'bank_transfer',
    paymentStatus: 'paid',
    lineItems: [
      { description: 'حمل‌ونقل درون‌شهری قرارداد سازمانی', quantity: 1, unitPrice: 16744000, totalPrice: 16744000 },
    ],
    sourceType: 'pdf',
    sourceFileName: 'alopeyk-mehr.pdf',
    pageCount: 3,
    createdAt: '2026-10-24T16:10:00.000Z',
    approvedAt: '2026-10-24T16:12:00.000Z',
  },
  {
    id: 'seed-6',
    title: 'بیمه تامین اجتماعی و مالیات حقوق پرسنل',
    vendor: 'سازمان تامین اجتماعی',
    documentType: 'bill',
    category: 'tax_legal',
    costCenter: 'finance',
    amount: 26800000,
    currency: 'IRT',
    taxAmount: 0,
    discountAmount: 0,
    date: '2026-10-18',
    trackingCode: '9920184712',
    paymentMethod: 'online_gateway',
    paymentStatus: 'paid',
    lineItems: [
      { description: 'حق بیمه لیست مهرماه', quantity: 1, unitPrice: 26800000, totalPrice: 26800000 },
    ],
    sourceType: 'image',
    sourceFileName: 'tamin-receipt.png',
    createdAt: '2026-10-18T10:05:00.000Z',
    approvedAt: '2026-10-18T10:07:00.000Z',
  },
  {
    id: 'seed-7',
    title: 'اقلام مصرفی اداری، کاغذ و پذیرایی جلسات',
    vendor: 'شهروند و تنخواه اداری',
    documentType: 'petty_cash',
    category: 'hr_admin',
    costCenter: 'general',
    amount: 6750000,
    currency: 'IRT',
    taxAmount: 0,
    discountAmount: 0,
    date: '2026-10-09',
    paymentMethod: 'petty_cash',
    paymentStatus: 'paid',
    lineItems: [
      { description: 'کاغذ A4، تونر و ملزومات اداری', quantity: 1, unitPrice: 4350000, totalPrice: 4350000 },
      { description: 'پذیرایی جلسات مشتریان', quantity: 1, unitPrice: 2400000, totalPrice: 2400000 },
    ],
    sourceType: 'text_file',
    sourceFileName: 'tankhah-mehr.txt',
    createdAt: '2026-10-09T13:40:00.000Z',
    approvedAt: '2026-10-09T13:42:00.000Z',
  },
  {
    id: 'seed-8',
    title: 'پرواز و اقامت نمایشگاه تجاری اصفهان',
    vendor: 'علی‌بابا سازمانی',
    documentType: 'invoice',
    category: 'travel',
    costCenter: 'sales',
    amount: 14200000,
    currency: 'IRT',
    taxAmount: 0,
    discountAmount: 0,
    date: '2026-09-27',
    invoiceNumber: 'ALB-33091',
    trackingCode: '77410293',
    paymentMethod: 'corporate_card',
    paymentStatus: 'paid',
    projectTag: 'نمایشگاه صنعت',
    lineItems: [
      { description: 'بلیط رفت و برگشت تیم فروش (۲ نفر)', quantity: 2, unitPrice: 4100000, totalPrice: 8200000 },
      { description: 'اقامت هتل ۲ شب', quantity: 2, unitPrice: 3000000, totalPrice: 6000000 },
    ],
    sourceType: 'pdf',
    sourceFileName: 'alibaba-isfahan.pdf',
    pageCount: 2,
    createdAt: '2026-09-27T09:15:00.000Z',
    approvedAt: '2026-09-27T09:18:00.000Z',
  },
  {
    id: 'seed-9',
    title: 'توسعه و شارژ سرورهای ابری شهریور',
    vendor: 'ابر آروان',
    documentType: 'invoice',
    category: 'infrastructure',
    costCenter: 'engineering',
    amount: 12900000,
    currency: 'IRT',
    taxAmount: 1161000,
    discountAmount: 0,
    date: '2026-09-12',
    invoiceNumber: 'ARV-1405-3890',
    trackingCode: '66120944',
    paymentMethod: 'bank_transfer',
    paymentStatus: 'paid',
    lineItems: [],
    sourceType: 'pdf',
    sourceFileName: 'arvancloud-shahrivar.pdf',
    pageCount: 1,
    createdAt: '2026-09-12T10:00:00.000Z',
    approvedAt: '2026-09-12T10:05:00.000Z',
  },
  {
    id: 'seed-10',
    title: 'مشاوره حقوقی قراردادهای سازمانی',
    vendor: 'موسسه حقوقی دادآفرین',
    documentType: 'invoice',
    category: 'tax_legal',
    costCenter: 'executive',
    amount: 19500000,
    currency: 'IRT',
    taxAmount: 0,
    discountAmount: 0,
    date: '2026-08-29',
    invoiceNumber: 'DAD-502',
    paymentMethod: 'bank_transfer',
    paymentStatus: 'paid',
    lineItems: [
      { description: 'تنظیم و بازبینی قراردادهای SLA مشتریان', quantity: 1, unitPrice: 19500000, totalPrice: 19500000 },
    ],
    sourceType: 'image',
    createdAt: '2026-08-29T15:00:00.000Z',
    approvedAt: '2026-08-29T15:03:00.000Z',
  },
  {
    id: 'seed-11',
    title: 'تولید محتوا و طراحی موشن‌گرافیک محصول',
    vendor: 'استودیو رهنما',
    documentType: 'invoice',
    category: 'marketing',
    costCenter: 'sales',
    amount: 16000000,
    currency: 'IRT',
    taxAmount: 0,
    discountAmount: 0,
    date: '2026-08-15',
    invoiceNumber: 'RHN-118',
    paymentMethod: 'bank_transfer',
    paymentStatus: 'paid',
    lineItems: [],
    sourceType: 'text',
    createdAt: '2026-08-15T12:00:00.000Z',
    approvedAt: '2026-08-15T12:10:00.000Z',
  },
];

function ensureLedgerFile(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(LEDGER_FILE)) {
    const initial: LedgerData = {
      expenses: SEED_EXPENSES,
      budgets: DEFAULT_BUDGETS,
      rates: DEFAULT_RATES,
      aiConfig: DEFAULT_AI_CONFIG,
    };
    fs.writeFileSync(LEDGER_FILE, JSON.stringify(initial, null, 2), 'utf8');
  }
}

export function readLedger(): LedgerData {
  ensureLedgerFile();
  try {
    const raw = fs.readFileSync(LEDGER_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<LedgerData>;
    const rates = parsed.rates ?? DEFAULT_RATES;
    const rawExpenses = Array.isArray(parsed.expenses) ? parsed.expenses : SEED_EXPENSES;
    const expenses = rawExpenses.map((e) => {
      if ((e.currency === 'USD' || e.currency === 'EUR') && (!e.exchangeRateToToman || e.exchangeRateToToman <= 0)) {
        return {
          ...e,
          exchangeRateToToman: e.id === 'seed-4' ? 68500 : rates[e.currency],
        };
      }
      return e;
    });
    return {
      expenses,
      budgets: Array.isArray(parsed.budgets) ? parsed.budgets : DEFAULT_BUDGETS,
      rates,
      aiConfig: sanitizeAiConfig(parsed.aiConfig),
    };
  } catch {
    return {
      expenses: SEED_EXPENSES,
      budgets: DEFAULT_BUDGETS,
      rates: DEFAULT_RATES,
      aiConfig: DEFAULT_AI_CONFIG,
    };
  }
}

export function writeLedger(data: LedgerData): void {
  ensureLedgerFile();
  const tmpFile = `${LEDGER_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmpFile, LEDGER_FILE);
}

export function addExpensesBatch(items: ExpenseFields[]): ExpenseRecord[] {
  const ledger = readLedger();
  const now = new Date().toISOString();
  const created: ExpenseRecord[] = items.map((item, idx) => ({
    ...item,
    id: `exp-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: now,
    approvedAt: now,
  }));
  ledger.expenses = [...created, ...ledger.expenses];
  writeLedger(ledger);
  return created;
}

export function updateExpense(id: string, patch: Partial<ExpenseFields>): ExpenseRecord | null {
  const ledger = readLedger();
  const index = ledger.expenses.findIndex((e) => e.id === id);
  if (index === -1) return null;
  const updated: ExpenseRecord = {
    ...ledger.expenses[index],
    ...patch,
    id: ledger.expenses[index].id,
    createdAt: ledger.expenses[index].createdAt,
    approvedAt: ledger.expenses[index].approvedAt,
  };
  ledger.expenses[index] = updated;
  writeLedger(ledger);
  return updated;
}

export function deleteExpense(id: string): boolean {
  const ledger = readLedger();
  const before = ledger.expenses.length;
  ledger.expenses = ledger.expenses.filter((e) => e.id !== id);
  if (ledger.expenses.length === before) return false;
  writeLedger(ledger);
  return true;
}

export function updateSettings(params: {
  budgets?: CategoryBudget[];
  rates?: ExchangeRates;
  aiConfig?: Partial<AiConfig>;
}): LedgerData {
  const ledger = readLedger();
  if (Array.isArray(params.budgets)) ledger.budgets = params.budgets;
  if (params.rates) ledger.rates = params.rates;
  if (params.aiConfig) ledger.aiConfig = sanitizeAiConfig(params.aiConfig);
  writeLedger(ledger);
  return ledger;
}

export function importLedgerOnServer(
  rawData: unknown,
  mode: JsonImportMode
): { ledger: LedgerData; stats: JsonImportStats } {
  const current = readLedger();
  const validated = parseAndValidateLedgerImport(rawData);
  const { next, stats } = mergeLedgerData(current, validated, mode);
  writeLedger(next);
  return { ledger: next, stats };
}

export function clearExpensesOnServer(
  scope: 'samples' | 'all'
): { ledger: LedgerData; removedCount: number } {
  const current = readLedger();
  const { next, removedCount } = clearLedgerExpenses(current, scope);
  writeLedger(next);
  return { ledger: next, removedCount };
}
