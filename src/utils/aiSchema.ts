import { parseIsoDate } from './jalali';
import type {
  CategoryDefinition,
  CostCenter,
  Currency,
  DocumentType,
  ExpenseCategory,
  ExpenseFields,
  PaymentMethod,
  PaymentStatus,
  PaymentTrancheStatus,
} from '../types/expense.ts';
import {
  DEFAULT_CATEGORIES,
  derivePaymentStatusFromTranches,
  resolveCategories,
} from './finance.ts';

export const VALID_CURRENCIES: Currency[] = ['IRT', 'IRR', 'USD', 'EUR'];
export const VALID_DOC_TYPES: DocumentType[] = [
  'invoice',
  'receipt',
  'bank_transfer',
  'bill',
  'proforma',
  'payroll',
  'petty_cash',
  'other',
];
export const VALID_CATEGORIES: ExpenseCategory[] = [
  'infrastructure',
  'operations',
  'marketing',
  'hr_admin',
  'equipment',
  'tax_legal',
  'travel',
  'other',
];
export const VALID_COST_CENTERS: CostCenter[] = [
  'engineering',
  'sales',
  'operations',
  'finance',
  'executive',
  'general',
];
export const VALID_PAYMENT_METHODS: PaymentMethod[] = [
  'corporate_card',
  'personal_card',
  'bank_transfer',
  'petty_cash',
  'online_gateway',
  'cash',
  'check',
];
export const VALID_STATUSES: PaymentStatus[] = ['paid', 'partial', 'pending', 'overdue'];
export const VALID_TRANCHE_STATUSES: PaymentTrancheStatus[] = ['paid', 'pending', 'overdue'];

export function clampAiEnum<T extends string>(val: unknown, allowed: readonly T[], fallback: T): T {
  return typeof val === 'string' && (allowed as readonly string[]).includes(val)
    ? (val as T)
    : fallback;
}

export function stripJsonCodeFences(raw: string): string {
  const trimmed = raw.trim();
  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fencedMatch && fencedMatch[1]) {
    return fencedMatch[1].trim();
  }
  return trimmed;
}

export function buildExtractionSystemInstruction(
  todayIso: string,
  includeJsonContract = false,
  categories?: CategoryDefinition[]
): string {
  const activeCategories = resolveCategories(categories);
  const categoryPromptLines = activeCategories
    .map(
      (cat) =>
        `   - ${cat.id}: ${cat.label}${cat.description ? ` (${cat.description})` : ''}`
    )
    .join('\n');
  const categoryUnion = activeCategories.map((c) => c.id).join(' | ');

  const base = `شما یک حسابدار ارشد و متخصص استخراج اطلاعات اسناد مالی شرکتی (فاکتورهای رسمی و غیررسمی، پیش‌فاکتور، رسید کارتخوان، فیش و پیامک‌های بانکی، قبوض، تنخواه و گزارش‌های متنی خرید) هستید.
وظیفه شما استخراج دقیق و ساختاریافته هزینه‌ها از تصاویر (از جمله صفحات PDF تبدیل‌شده به تصویر) یا متن‌های ورودی است.

قوانین مهم:
1. اگر یک سند یا متن شامل چند تراکنش یا فاکتور مجزا است، همه آن‌ها را به صورت آیتم‌های جداگانه در آرایه expenses برگردانید. اما اگر یک فاکتور واحد دارای چند قلم کالا/خدمت است، آن را به صورت یک هزینه با آرایه lineItems برگردانید.
2. تاریخ‌های شمسی (مثلاً 1404/08/15 یا ۱۴۰۵/۰۹/۰۴) را دقیقاً به تاریخ میلادی ISO (YYYY-MM-DD) تبدیل کنید. تاریخ امروز میلادی ${todayIso} است. اگر سال یا تاریخ در سند نبود، از ${todayIso} استفاده کنید.
3. واحد پول را با دقت تشخیص دهید:
   - در پیامک‌های بانکی ایران و فاکتورهای رسمی معمولاً «ریال» (IRR) است.
   - در رسیدهای روزمره، فاکتورهای فروشگاه‌ها و یادداشت‌ها معمولاً «تومان» (IRT) است.
   - برای سرویس‌های خارجی دلار (USD) یا یورو (EUR) استفاده کنید.
   - هرگز مبلغ ریال را خودسرانه به تومان تقسیم نکنید؛ مبلغ دقیق مندرج را با currency='IRR' یا 'IRT' ثبت کنید و در extractionNotes توضیح دهید.
4. دسته‌بندی حوزه هزینه (category) — فقط یکی از شناسه‌های زیر را انتخاب کنید:
${categoryPromptLines}
5. تشخیص پرداخت یکجا در مقابل پیش‌پرداخت و چک (بسیار مهم):
   - ابتدا بررسی کنید آیا سند به صورت یکجا و کامل پرداخت شده یا واقعاً دارای پیش‌پرداخت / چک / اقساط چندمرحله‌ای است.
   - اگر کل مبلغ فاکتور یا رسید در یک نوبت کامل پرداخت شده است (مثل رسید کارتخوان، فیش واریز یکجا، فاکتور نقدی یا کارتی تسویه‌شده بدون قسط یا چک بعدی)، حتماً paymentStatus را 'paid' و آرایه paymentTranches را دقیقاً خالی [] بگذارید (به هیچ وجه برای پرداخت کامل و یکجا آیتم پیش‌پرداخت یا چک نسازید).
   - اگر سند فقط یک پرداخت معوق یا یک چک واحد بابت کل مبلغ است (بدون پیش‌پرداخت یا بخش‌بندی)، باز هم paymentTranches را خالی [] بگذارید و فقط paymentMethod (مثلاً 'check') و paymentStatus ('pending' یا 'overdue') را تنظیم کنید.
   - تنها زمانی paymentTranches را پر کنید که در فاکتور یا متن واقعاً به پرداخت مرحله‌ای اشاره شده باشد (مثلاً پیش‌پرداخت نقدی/حواله + مابقی به صورت چک یا قسط، یا چند فقره چک با سررسیدهای متفاوت، یا پرداخت جزئی با مانده بدهی). در این حالت در صورت پرداخت بخشی و باقی ماندن مابقی، paymentStatus را 'partial' بگذارید.
6. اگر در سند، فیش یا متن اشاره شده که خرید توسط فرد مشخصی انجام شده یا با کارت/حساب شخصی فردی پرداخت شده است، نام آن فرد را در purchaser بنویسید و در صورت پرداخت با کارت یا جیب شخصی فرد، paymentMethod را 'personal_card' بگذارید؛ در غیر این صورت purchaser را null بگذارید.
7. فیلدهای title و vendor را به فارسی روان و شفاف بنویسید (نام برند خارجی را می‌توان انگلیسی یا فارسی نوشت).`;

  if (!includeJsonContract) return base;

  return `${base}

خروجی را منحصراً به صورت یک JSON معتبر (بدون متن اضافی) با ساختار دقیق زیر برگردانید:
{
  "expenses": [
    {
      "title": "string",
      "vendor": "string",
      "vendorTaxId": "string | null",
      "purchaser": "string | null",
      "documentType": "invoice | receipt | bank_transfer | bill | proforma | payroll | petty_cash | other",
      "category": "${categoryUnion}",
      "costCenter": "engineering | sales | operations | finance | executive | general",
      "amount": 0,
      "currency": "IRT | IRR | USD | EUR",
      "exchangeRateToToman": 0,
      "taxAmount": 0,
      "discountAmount": 0,
      "date": "YYYY-MM-DD",
      "invoiceNumber": "string | null",
      "trackingCode": "string | null",
      "paymentMethod": "corporate_card | personal_card | bank_transfer | petty_cash | online_gateway | cash | check",
      "paymentStatus": "paid | partial | pending | overdue",
      "paymentTranches": [],
      "dueDate": "YYYY-MM-DD | null",
      "projectTag": "string | null",
      "notes": "string | null",
      "extractionNotes": "string | null",
      "lineItems": [
        { "description": "string", "quantity": 1, "unitPrice": 0, "totalPrice": 0 }
      ]
    }
  ]
}
تبصره paymentTranches: برای پرداخت‌های یکجا حتماً [] باشد. تنها در صورت وجود پیش‌پرداخت یا چک‌های چندمرحله‌ای، هر آیتم را با کلیدهای { "title", "amount", "method", "status": "paid | pending | overdue", "date": "YYYY-MM-DD", "referenceCode", "notes" } قرار دهید.`;
}

export function normalizeExtractedExpenseList(
  list: Array<Record<string, unknown>>,
  todayIso: string,
  categories?: CategoryDefinition[]
): Omit<ExpenseFields, 'sourceType' | 'sourceFileName' | 'sourcePreviewUrl' | 'pageCount'>[] {
  const activeCategories = categories && categories.length > 0 ? resolveCategories(categories) : DEFAULT_CATEGORIES;
  const allowedCategoryIds = activeCategories.map((c) => c.id);
  const fallbackCategory = allowedCategoryIds.includes('other')
    ? 'other'
    : allowedCategoryIds[0] ?? 'other';
  return list.map((item) => {
    const rawItems = Array.isArray(item.lineItems) ? item.lineItems : [];
    const lineItems = rawItems
      .filter((li): li is Record<string, unknown> => Boolean(li && typeof li === 'object'))
      .map((li) => ({
        description: String(li.description ?? 'قلم هزینه'),
        quantity: Number(li.quantity) > 0 ? Number(li.quantity) : 1,
        unitPrice: Number.isFinite(Number(li.unitPrice)) ? Number(li.unitPrice) : 0,
        totalPrice: Number.isFinite(Number(li.totalPrice)) ? Number(li.totalPrice) : 0,
      }));

    const dateStr =
      typeof item.date === 'string' && parseIsoDate(item.date)
        ? item.date
        : todayIso;

    const amount = Number.isFinite(Number(item.amount)) ? Math.max(0, Number(item.amount)) : 0;
    const rawStatus = clampAiEnum(item.paymentStatus, VALID_STATUSES, 'paid');

    const rawTranches = Array.isArray(item.paymentTranches) ? item.paymentTranches : [];
    let paymentTranches = rawTranches
      .filter((tr): tr is Record<string, unknown> => Boolean(tr && typeof tr === 'object'))
      .map((tr, idx) => ({
        id: `tr-${Date.now()}-${idx}`,
        title: String(tr.title ?? `بخش ${idx + 1}`),
        amount: Number.isFinite(Number(tr.amount)) ? Math.max(0, Number(tr.amount)) : 0,
        method: clampAiEnum(tr.method, VALID_PAYMENT_METHODS, 'bank_transfer'),
        status: clampAiEnum(tr.status, VALID_TRANCHE_STATUSES, 'pending'),
        date:
          typeof tr.date === 'string' && parseIsoDate(tr.date)
            ? tr.date
            : undefined,
        referenceCode: tr.referenceCode ? String(tr.referenceCode) : undefined,
        notes: tr.notes ? String(tr.notes) : undefined,
      }))
      .filter((tr) => tr.amount > 0);

    // Strip redundant single-tranche wrapper when the document was paid in full (or settled in one payment for 100% of amount)
    if (
      paymentTranches.length === 1 &&
      amount > 0 &&
      Math.abs(paymentTranches[0].amount - amount) <= 1 &&
      (rawStatus === 'paid' || rawStatus !== 'partial')
    ) {
      paymentTranches = [];
    }

    const finalTranches = paymentTranches.length > 0 ? paymentTranches : undefined;
    const paymentStatus = finalTranches
      ? derivePaymentStatusFromTranches(amount, finalTranches, rawStatus)
      : rawStatus === 'partial'
        ? 'pending'
        : rawStatus;

    return {
      title: String(item.title || 'هزینه بدون عنوان'),
      vendor: String(item.vendor || 'نامشخص'),
      vendorTaxId: item.vendorTaxId ? String(item.vendorTaxId) : undefined,
      documentType: clampAiEnum(item.documentType, VALID_DOC_TYPES, 'invoice'),
      category: clampAiEnum(item.category, allowedCategoryIds, fallbackCategory),
      costCenter: clampAiEnum(item.costCenter, VALID_COST_CENTERS, 'general'),
      amount,
      currency: clampAiEnum(item.currency, VALID_CURRENCIES, 'IRT'),
      exchangeRateToToman:
        Number.isFinite(Number(item.exchangeRateToToman)) && Number(item.exchangeRateToToman) > 0
          ? Math.round(Number(item.exchangeRateToToman))
          : undefined,
      taxAmount: Number.isFinite(Number(item.taxAmount)) ? Math.max(0, Number(item.taxAmount)) : 0,
      discountAmount: Number.isFinite(Number(item.discountAmount))
        ? Math.max(0, Number(item.discountAmount))
        : 0,
      date: dateStr,
      invoiceNumber: item.invoiceNumber ? String(item.invoiceNumber) : undefined,
      trackingCode: item.trackingCode ? String(item.trackingCode) : undefined,
      paymentMethod: clampAiEnum(item.paymentMethod, VALID_PAYMENT_METHODS, 'corporate_card'),
      paymentStatus,
      paymentTranches: finalTranches,
      dueDate:
        typeof item.dueDate === 'string' && parseIsoDate(item.dueDate)
          ? item.dueDate
          : undefined,
      purchaser:
        typeof item.purchaser === 'string' && item.purchaser.trim()
          ? item.purchaser.trim().replace(/\s+/g, ' ').slice(0, 80)
          : undefined,
      projectTag: item.projectTag ? String(item.projectTag) : undefined,
      notes: item.notes ? String(item.notes) : undefined,
      extractionNotes: item.extractionNotes ? String(item.extractionNotes) : undefined,
      lineItems,
    };
  });
}
