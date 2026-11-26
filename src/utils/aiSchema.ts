import type {
  CostCenter,
  Currency,
  DocumentType,
  ExpenseCategory,
  ExpenseFields,
  PaymentMethod,
  PaymentStatus,
  PaymentTrancheStatus,
} from '../types/expense.ts';

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
  includeJsonContract = false
): string {
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
4. دسته‌بندی حوزه هزینه (category):
   - infrastructure: سرور، دامنه، اینترنت، نرم‌افزار، کلود، API
   - operations: حمل‌ونقل، پیک، بسته‌بندی، انبار، نگهداری
   - marketing: تبلیغات، رویداد، طراحی، تولید محتوا، سئو
   - hr_admin: حقوق، پذیرایی، ملزومات اداری، اجاره، قبوض آب و برق
   - equipment: لپ‌تاپ، مانیتور، سخت‌افزار، مبلمان اداری
   - tax_legal: مالیات، بیمه تامین اجتماعی، عوارض، مشاوره حقوقی/مالیاتی
   - travel: بلیط، هتل، ایاب‌وذهاب ماموریت
   - other: سایر موارد
5. پرداخت بخشی، پیش‌پرداخت و چک (paymentTranches):
   - اگر در فاکتور یا متن اشاره شده باشد که خرید به صورت مرحله‌ای یا ترکیبی است (مثلاً پیش‌پرداخت نقدی/کارت/حواله و مابقی به صورت چک یا قسط، یا چند فقره چک با سررسیدهای متفاوت)، حتماً paymentStatus را 'partial' (اگر بخشی پرداخت شده و بخشی مانده) یا 'pending' بگذارید و تمام بخش‌های پرداخت را در آرایه paymentTranches استخراج کنید.
6. فیلدهای title و vendor را به فارسی روان و شفاف بنویسید (نام برند خارجی را می‌توان انگلیسی یا فارسی نوشت).`;

  if (!includeJsonContract) return base;

  return `${base}

خروجی را منحصراً به صورت یک JSON معتبر (بدون متن اضافی) با ساختار دقیق زیر برگردانید:
{
  "expenses": [
    {
      "title": "string",
      "vendor": "string",
      "vendorTaxId": "string | null",
      "documentType": "invoice | receipt | bank_transfer | bill | proforma | payroll | petty_cash | other",
      "category": "infrastructure | operations | marketing | hr_admin | equipment | tax_legal | travel | other",
      "costCenter": "engineering | sales | operations | finance | executive | general",
      "amount": 0,
      "currency": "IRT | IRR | USD | EUR",
      "exchangeRateToToman": 0,
      "taxAmount": 0,
      "discountAmount": 0,
      "date": "YYYY-MM-DD",
      "invoiceNumber": "string | null",
      "trackingCode": "string | null",
      "paymentMethod": "corporate_card | bank_transfer | petty_cash | online_gateway | cash | check",
      "paymentStatus": "paid | partial | pending | overdue",
      "paymentTranches": [
        {
          "title": "string",
          "amount": 0,
          "method": "corporate_card | bank_transfer | petty_cash | online_gateway | cash | check",
          "status": "paid | pending | overdue",
          "date": "YYYY-MM-DD",
          "referenceCode": "string",
          "notes": "string"
        }
      ],
      "dueDate": "YYYY-MM-DD | null",
      "projectTag": "string | null",
      "notes": "string | null",
      "extractionNotes": "string | null",
      "lineItems": [
        { "description": "string", "quantity": 1, "unitPrice": 0, "totalPrice": 0 }
      ]
    }
  ]
}`;
}

export function normalizeExtractedExpenseList(
  list: Array<Record<string, unknown>>,
  todayIso: string
): Omit<ExpenseFields, 'sourceType' | 'sourceFileName' | 'sourcePreviewUrl' | 'pageCount'>[] {
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
      typeof item.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.date)
        ? item.date
        : todayIso;

    const rawTranches = Array.isArray(item.paymentTranches) ? item.paymentTranches : [];
    const paymentTranches = rawTranches
      .filter((tr): tr is Record<string, unknown> => Boolean(tr && typeof tr === 'object'))
      .map((tr, idx) => ({
        id: `tr-${Date.now()}-${idx}`,
        title: String(tr.title ?? `بخش ${idx + 1}`),
        amount: Number.isFinite(Number(tr.amount)) ? Math.max(0, Number(tr.amount)) : 0,
        method: clampAiEnum(tr.method, VALID_PAYMENT_METHODS, 'bank_transfer'),
        status: clampAiEnum(tr.status, VALID_TRANCHE_STATUSES, 'pending'),
        date:
          typeof tr.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(tr.date)
            ? tr.date
            : undefined,
        referenceCode: tr.referenceCode ? String(tr.referenceCode) : undefined,
        notes: tr.notes ? String(tr.notes) : undefined,
      }));

    return {
      title: String(item.title || 'هزینه بدون عنوان'),
      vendor: String(item.vendor || 'نامشخص'),
      vendorTaxId: item.vendorTaxId ? String(item.vendorTaxId) : undefined,
      documentType: clampAiEnum(item.documentType, VALID_DOC_TYPES, 'invoice'),
      category: clampAiEnum(item.category, VALID_CATEGORIES, 'other'),
      costCenter: clampAiEnum(item.costCenter, VALID_COST_CENTERS, 'general'),
      amount: Number.isFinite(Number(item.amount)) ? Math.max(0, Number(item.amount)) : 0,
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
      paymentStatus: clampAiEnum(item.paymentStatus, VALID_STATUSES, 'paid'),
      paymentTranches: paymentTranches.length > 0 ? paymentTranches : undefined,
      dueDate:
        typeof item.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.dueDate)
          ? item.dueDate
          : undefined,
      projectTag: item.projectTag ? String(item.projectTag) : undefined,
      notes: item.notes ? String(item.notes) : undefined,
      extractionNotes: item.extractionNotes ? String(item.extractionNotes) : undefined,
      lineItems,
    };
  });
}
