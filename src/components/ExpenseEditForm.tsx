import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  Check,
  Plus,
  Trash2,
} from 'lucide-react';
import type {
  CostCenter,
  Currency,
  DocumentType,
  ExchangeRates,
  ExpenseCategory,
  ExpenseFields,
  ExpenseRecord,
  LineItem,
  PaymentMethod,
  PaymentStatus,
  PaymentTranche,
} from '../types/expense';
import {
  CATEGORY_LABELS,
  COST_CENTER_LABELS,
  CURRENCY_LABELS,
  DOCUMENT_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  convertRialTomanValues,
  derivePaymentStatusFromTranches,
  formatCurrency,
  normalizeToToman,
} from '../utils/finance';
import { formatJalaliDate, toPersianDigits } from '../utils/jalali';
import { JalaliDateInput } from './JalaliDateInput';
import { PaymentTranchesEditor } from './PaymentTranchesEditor';

interface ExpenseEditFormProps {
  expense: ExpenseRecord;
  rates: ExchangeRates;
  isSaving: boolean;
  onSave: (patch: Partial<ExpenseFields>) => Promise<void>;
  onCancel: () => void;
}

export const ExpenseEditForm: React.FC<ExpenseEditFormProps> = ({
  expense,
  rates,
  isSaving,
  onSave,
  onCancel,
}) => {
  const [title, setTitle] = useState(expense.title);
  const [vendor, setVendor] = useState(expense.vendor);
  const [vendorTaxId, setVendorTaxId] = useState(expense.vendorTaxId ?? '');
  const [documentType, setDocumentType] = useState<DocumentType>(expense.documentType);
  const [category, setCategory] = useState<ExpenseCategory>(expense.category);
  const [costCenter, setCostCenter] = useState<CostCenter>(expense.costCenter);
  const [amount, setAmount] = useState<number>(expense.amount);
  const [currency, setCurrency] = useState<Currency>(expense.currency);
  const [exchangeRateToToman, setExchangeRateToToman] = useState<number | undefined>(
    expense.currency === 'USD' || expense.currency === 'EUR'
      ? expense.exchangeRateToToman ?? rates[expense.currency]
      : undefined
  );
  const [taxAmount, setTaxAmount] = useState<number>(expense.taxAmount ?? 0);
  const [discountAmount, setDiscountAmount] = useState<number>(expense.discountAmount ?? 0);
  const [date, setDate] = useState<string>(expense.date);
  const [dueDate, setDueDate] = useState<string | undefined>(expense.dueDate);
  const [invoiceNumber, setInvoiceNumber] = useState(expense.invoiceNumber ?? '');
  const [trackingCode, setTrackingCode] = useState(expense.trackingCode ?? '');
  const [projectTag, setProjectTag] = useState(expense.projectTag ?? '');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(expense.paymentMethod);
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>(expense.paymentStatus);
  const [paymentTranches, setPaymentTranches] = useState<PaymentTranche[]>(
    expense.paymentTranches ?? []
  );
  const [notes, setNotes] = useState(expense.notes ?? '');
  const [lineItems, setLineItems] = useState<LineItem[]>(expense.lineItems ?? []);
  const [sourcePreviewUrl, setSourcePreviewUrl] = useState<string | undefined>(
    expense.sourcePreviewUrl
  );
  const [error, setError] = useState<string | null>(null);

  const isForeign = currency === 'USD' || currency === 'EUR';
  const effectiveRate = isForeign ? exchangeRateToToman ?? rates[currency] : undefined;
  const tomanEquivalent = normalizeToToman(amount, currency, rates, effectiveRate);

  const handleCurrencyChange = (nextCurrency: Currency) => {
    setCurrency(nextCurrency);
    if (nextCurrency === 'USD' || nextCurrency === 'EUR') {
      setExchangeRateToToman((prev) =>
        currency === nextCurrency && prev && prev > 0 ? prev : rates[nextCurrency]
      );
    } else {
      setExchangeRateToToman(undefined);
    }
  };

  const handleConvertRialToman = () => {
    if (currency !== 'IRR' && currency !== 'IRT') return;
    const toCurrency = currency === 'IRR' ? 'IRT' : 'IRR';
    const converted = convertRialTomanValues({
      amount,
      taxAmount,
      discountAmount,
      lineItems,
      paymentTranches,
      fromCurrency: currency,
      toCurrency,
    });
    setCurrency(converted.currency);
    setAmount(converted.amount);
    setTaxAmount(converted.taxAmount);
    setDiscountAmount(converted.discountAmount);
    setLineItems(converted.lineItems);
    if (converted.paymentTranches) {
      setPaymentTranches(converted.paymentTranches);
    }
  };

  const handleTranchesChange = (nextTranches: PaymentTranche[]) => {
    setPaymentTranches(nextTranches);
    if (nextTranches.length === 0) {
      setPaymentStatus((prev) => (prev === 'partial' ? 'pending' : prev));
      return;
    }
    const derived = derivePaymentStatusFromTranches(amount, nextTranches, paymentStatus);
    setPaymentStatus(derived);
    const unpaid = nextTranches.find((t) => t.status !== 'paid');
    if (unpaid) {
      setPaymentMethod(unpaid.method);
      if (unpaid.date) setDueDate(unpaid.date);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!title.trim() || !vendor.trim()) {
      setError('عنوان هزینه و نام فروشنده / طرف حساب الزامی است.');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('مبلغ کل فاکتور باید بزرگتر از صفر باشد.');
      return;
    }
    if (isForeign && (!effectiveRate || effectiveRate <= 0)) {
      setError('برای اسناد ارزی، ثبت نرخ تسعیر معتبر الزامی است.');
      return;
    }
    if (paymentTranches.length > 0) {
      const trancheSum = paymentTranches.reduce((s, t) => s + (t.amount || 0), 0);
      if (trancheSum > amount + 0.01) {
        setError('جمع بخش‌های پرداخت نمی‌تواند از مبلغ کل فاکتور بیشتر باشد.');
        return;
      }
    }

    const finalTranches = paymentTranches.length > 0 ? paymentTranches : undefined;
    const finalStatus = derivePaymentStatusFromTranches(amount, finalTranches, paymentStatus);

    await onSave({
      title: title.trim(),
      vendor: vendor.trim(),
      vendorTaxId: vendorTaxId.trim() || undefined,
      documentType,
      category,
      costCenter,
      amount,
      currency,
      exchangeRateToToman: isForeign ? effectiveRate : undefined,
      taxAmount: Math.max(0, taxAmount),
      discountAmount: Math.max(0, discountAmount),
      date,
      dueDate: dueDate || undefined,
      invoiceNumber: invoiceNumber.trim() || undefined,
      trackingCode: trackingCode.trim() || undefined,
      projectTag: projectTag.trim() || undefined,
      paymentMethod,
      paymentStatus: finalStatus,
      paymentTranches: finalTranches,
      notes: notes.trim() || undefined,
      lineItems: lineItems.filter((li) => li.description.trim() || li.totalPrice > 0),
      sourcePreviewUrl,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div
          role="alert"
          className="rounded-xl bg-red-50 border border-red-200 p-3 text-xs text-red-800 flex items-center gap-2"
        >
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        <div className="sm:col-span-2">
          <label htmlFor={`edit-title-${expense.id}`} className="block text-xs font-semibold text-slate-700 mb-1">
            عنوان / شرح فاکتور *
          </label>
          <input
            id={`edit-title-${expense.id}`}
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full min-h-[40px] rounded-xl border border-slate-200 px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
          />
        </div>

        <div>
          <label htmlFor={`edit-vendor-${expense.id}`} className="block text-xs font-semibold text-slate-700 mb-1">
            فروشنده / طرف حساب *
          </label>
          <input
            id={`edit-vendor-${expense.id}`}
            type="text"
            required
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
            className="w-full min-h-[40px] rounded-xl border border-slate-200 px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
          />
        </div>

        <div>
          <label htmlFor={`edit-taxid-${expense.id}`} className="block text-xs font-semibold text-slate-700 mb-1">
            شناسه ملی / کد اقتصادی فروشنده
          </label>
          <input
            id={`edit-taxid-${expense.id}`}
            type="text"
            value={vendorTaxId}
            onChange={(e) => setVendorTaxId(e.target.value)}
            placeholder="اختیاری"
            className="w-full min-h-[40px] rounded-xl border border-slate-200 px-3 text-sm font-mono-num text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
          />
        </div>

        <div>
          <label htmlFor={`edit-amount-${expense.id}`} className="block text-xs font-semibold text-slate-700 mb-1">
            مبلغ کل ({CURRENCY_LABELS[currency]}) *
          </label>
          <input
            id={`edit-amount-${expense.id}`}
            type="number"
            min={0}
            step="any"
            required
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value) || 0)}
            className="w-full min-h-[40px] rounded-xl border border-slate-200 px-3 text-sm font-mono-num text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
          />
          {currency !== 'IRT' && (
            <span className="block mt-1 text-[11px] text-slate-500 tabular-nums">
              معادل تومانی: {formatCurrency(tomanEquivalent, 'IRT')}
            </span>
          )}
        </div>

        <div>
          <label htmlFor={`edit-currency-${expense.id}`} className="block text-xs font-semibold text-slate-700 mb-1">
            واحد پول
          </label>
          <select
            id={`edit-currency-${expense.id}`}
            value={currency}
            onChange={(e) => handleCurrencyChange(e.target.value as Currency)}
            className="w-full min-h-[40px] rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
          >
            {(Object.keys(CURRENCY_LABELS) as Currency[]).map((c) => (
              <option key={c} value={c}>
                {CURRENCY_LABELS[c]}
              </option>
            ))}
          </select>
          {(currency === 'IRR' || currency === 'IRT') && (
            <button
              type="button"
              onClick={handleConvertRialToman}
              className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-teal-700 hover:text-teal-900 cursor-pointer"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
              <span>
                {currency === 'IRR' ? 'تبدیل مبالغ به تومان (÷۱۰)' : 'تبدیل مبالغ به ریال (×۱۰)'}
              </span>
            </button>
          )}
        </div>

        {isForeign && (
          <div className="sm:col-span-2">
            <label htmlFor={`edit-rate-${expense.id}`} className="block text-xs font-semibold text-slate-700 mb-1">
              نرخ تسعیر ثبت‌شده این سند (تومان) *
            </label>
            <input
              id={`edit-rate-${expense.id}`}
              type="number"
              min={1}
              step={100}
              required
              value={effectiveRate ?? 0}
              onChange={(e) => setExchangeRateToToman(Number(e.target.value) || 0)}
              className="w-full min-h-[40px] rounded-xl border border-teal-300 bg-teal-50/40 px-3 text-sm font-mono-num text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>
        )}

        <div>
          <label htmlFor={`edit-tax-${expense.id}`} className="block text-xs font-semibold text-slate-700 mb-1">
            مالیات ارزش افزوده ({CURRENCY_LABELS[currency]})
          </label>
          <input
            id={`edit-tax-${expense.id}`}
            type="number"
            min={0}
            step="any"
            value={taxAmount}
            onChange={(e) => setTaxAmount(Number(e.target.value) || 0)}
            className="w-full min-h-[40px] rounded-xl border border-slate-200 px-3 text-sm font-mono-num text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
          />
        </div>

        <div>
          <label htmlFor={`edit-discount-${expense.id}`} className="block text-xs font-semibold text-slate-700 mb-1">
            تخفیف ({CURRENCY_LABELS[currency]})
          </label>
          <input
            id={`edit-discount-${expense.id}`}
            type="number"
            min={0}
            step="any"
            value={discountAmount}
            onChange={(e) => setDiscountAmount(Number(e.target.value) || 0)}
            className="w-full min-h-[40px] rounded-xl border border-slate-200 px-3 text-sm font-mono-num text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
          />
        </div>

        <div className="sm:col-span-2">
          <JalaliDateInput
            idPrefix={`edit-date-${expense.id}`}
            label={`تاریخ سند (${formatJalaliDate(date)})`}
            value={date}
            onChange={setDate}
          />
        </div>

        <div>
          <label htmlFor={`edit-cat-${expense.id}`} className="block text-xs font-semibold text-slate-700 mb-1">
            حوزه هزینه
          </label>
          <select
            id={`edit-cat-${expense.id}`}
            value={category}
            onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
            className="w-full min-h-[40px] rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
          >
            {(Object.keys(CATEGORY_LABELS) as ExpenseCategory[]).map((cat) => (
              <option key={cat} value={cat}>
                {CATEGORY_LABELS[cat]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor={`edit-cc-${expense.id}`} className="block text-xs font-semibold text-slate-700 mb-1">
            مرکز هزینه / دپارتمان
          </label>
          <select
            id={`edit-cc-${expense.id}`}
            value={costCenter}
            onChange={(e) => setCostCenter(e.target.value as CostCenter)}
            className="w-full min-h-[40px] rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
          >
            {(Object.keys(COST_CENTER_LABELS) as CostCenter[]).map((cc) => (
              <option key={cc} value={cc}>
                {COST_CENTER_LABELS[cc]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor={`edit-doctype-${expense.id}`} className="block text-xs font-semibold text-slate-700 mb-1">
            نوع سند
          </label>
          <select
            id={`edit-doctype-${expense.id}`}
            value={documentType}
            onChange={(e) => setDocumentType(e.target.value as DocumentType)}
            className="w-full min-h-[40px] rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
          >
            {(Object.keys(DOCUMENT_TYPE_LABELS) as DocumentType[]).map((dt) => (
              <option key={dt} value={dt}>
                {DOCUMENT_TYPE_LABELS[dt]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor={`edit-method-${expense.id}`} className="block text-xs font-semibold text-slate-700 mb-1">
            روش پرداخت اصلی
          </label>
          <select
            id={`edit-method-${expense.id}`}
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
            className="w-full min-h-[40px] rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
          >
            {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((pm) => (
              <option key={pm} value={pm}>
                {PAYMENT_METHOD_LABELS[pm]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor={`edit-status-${expense.id}`} className="block text-xs font-semibold text-slate-700 mb-1">
            وضعیت تسویه
          </label>
          <select
            id={`edit-status-${expense.id}`}
            value={paymentStatus}
            onChange={(e) => setPaymentStatus(e.target.value as PaymentStatus)}
            className="w-full min-h-[40px] rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
          >
            {(Object.keys(PAYMENT_STATUS_LABELS) as PaymentStatus[]).map((ps) => (
              <option key={ps} value={ps}>
                {PAYMENT_STATUS_LABELS[ps]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor={`edit-inv-${expense.id}`} className="block text-xs font-semibold text-slate-700 mb-1">
            شماره فاکتور
          </label>
          <input
            id={`edit-inv-${expense.id}`}
            type="text"
            value={invoiceNumber}
            onChange={(e) => setInvoiceNumber(e.target.value)}
            className="w-full min-h-[40px] rounded-xl border border-slate-200 px-3 text-sm font-mono-num text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
          />
        </div>

        <div>
          <label htmlFor={`edit-trk-${expense.id}`} className="block text-xs font-semibold text-slate-700 mb-1">
            کد پیگیری / ارجاع
          </label>
          <input
            id={`edit-trk-${expense.id}`}
            type="text"
            value={trackingCode}
            onChange={(e) => setTrackingCode(e.target.value)}
            className="w-full min-h-[40px] rounded-xl border border-slate-200 px-3 text-sm font-mono-num text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
          />
        </div>

        <div>
          <label htmlFor={`edit-proj-${expense.id}`} className="block text-xs font-semibold text-slate-700 mb-1">
            برچسب پروژه / قرارداد
          </label>
          <input
            id={`edit-proj-${expense.id}`}
            type="text"
            value={projectTag}
            onChange={(e) => setProjectTag(e.target.value)}
            className="w-full min-h-[40px] rounded-xl border border-slate-200 px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
          />
        </div>

        <div className="sm:col-span-2">
          {dueDate ? (
            <JalaliDateInput
              idPrefix={`edit-due-${expense.id}`}
              label={`تاریخ سررسید (${formatJalaliDate(dueDate)})`}
              value={dueDate}
              onChange={setDueDate}
              allowClear
              onClear={() => setDueDate(undefined)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setDueDate(date)}
              className="text-xs font-semibold text-teal-700 hover:text-teal-900 cursor-pointer"
            >
              + افزودن تاریخ سررسید شمسی
            </button>
          )}
        </div>

        <div className="sm:col-span-2">
          <label htmlFor={`edit-notes-${expense.id}`} className="block text-xs font-semibold text-slate-700 mb-1">
            یادداشت حسابداری
          </label>
          <textarea
            id={`edit-notes-${expense.id}`}
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded-xl border border-slate-200 p-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
          />
        </div>
      </div>

      {/* Split Payments */}
      <PaymentTranchesEditor
        idPrefix={`edit-full-${expense.id}`}
        totalAmount={amount}
        currency={currency}
        rates={rates}
        documentExchangeRate={effectiveRate}
        baseDate={date}
        tranches={paymentTranches}
        onChange={handleTranchesChange}
      />

      {/* Line Items */}
      <div className="pt-3 border-t border-slate-100 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold text-slate-800">
            اقلام ریز فاکتور ({toPersianDigits(lineItems.length)})
          </span>
          <button
            type="button"
            onClick={() =>
              setLineItems((prev) => [
                ...prev,
                { description: '', quantity: 1, unitPrice: 0, totalPrice: 0 },
              ])
            }
            className="inline-flex items-center gap-1 min-h-[34px] px-2.5 rounded-lg bg-slate-100 text-xs font-semibold text-slate-700 hover:bg-slate-200 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>افزودن قلم</span>
          </button>
        </div>

        {lineItems.map((li, idx) => (
          <div
            key={idx}
            className="grid grid-cols-12 gap-2 items-center bg-slate-50 p-2 rounded-xl"
          >
            <input
              type="text"
              aria-label={`شرح قلم ${idx + 1}`}
              placeholder="شرح کالا یا خدمت"
              value={li.description}
              onChange={(e) => {
                const next = [...lineItems];
                next[idx] = { ...li, description: e.target.value };
                setLineItems(next);
              }}
              className="col-span-12 sm:col-span-5 min-h-[36px] rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-900"
            />
            <input
              type="number"
              aria-label={`تعداد قلم ${idx + 1}`}
              min={1}
              value={li.quantity}
              onChange={(e) => {
                const qty = Number(e.target.value) || 1;
                const next = [...lineItems];
                next[idx] = { ...li, quantity: qty, totalPrice: qty * li.unitPrice };
                setLineItems(next);
              }}
              className="col-span-4 sm:col-span-2 min-h-[36px] rounded-lg border border-slate-200 bg-white px-2 text-xs font-mono-num text-slate-900"
            />
            <input
              type="number"
              aria-label={`فی قلم ${idx + 1}`}
              min={0}
              step="any"
              value={li.unitPrice}
              onChange={(e) => {
                const up = Number(e.target.value) || 0;
                const next = [...lineItems];
                next[idx] = { ...li, unitPrice: up, totalPrice: li.quantity * up };
                setLineItems(next);
              }}
              className="col-span-6 sm:col-span-4 min-h-[36px] rounded-lg border border-slate-200 bg-white px-2 text-xs font-mono-num text-slate-900"
            />
            <button
              type="button"
              aria-label={`حذف قلم ${idx + 1}`}
              onClick={() => setLineItems((prev) => prev.filter((_, i) => i !== idx))}
              className="col-span-2 sm:col-span-1 min-h-[36px] flex items-center justify-center rounded-lg text-red-600 hover:bg-red-100 cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      {sourcePreviewUrl && (
        <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-3">
          <span className="text-xs text-slate-600">تصویر پیوست روی سند موجود است</span>
          <button
            type="button"
            onClick={() => setSourcePreviewUrl(undefined)}
            className="inline-flex items-center gap-1 min-h-[34px] px-3 rounded-lg border border-red-200 text-xs font-semibold text-red-700 hover:bg-red-50 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>حذف تصویر پیوست</span>
          </button>
        </div>
      )}

      <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-200">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSaving}
          className="min-h-[42px] px-4 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
        >
          انصراف
        </button>
        <button
          type="submit"
          disabled={isSaving}
          className="inline-flex items-center gap-1.5 min-h-[42px] px-5 py-2 rounded-xl bg-teal-700 text-white text-xs sm:text-sm font-semibold hover:bg-teal-800 disabled:opacity-50 cursor-pointer"
        >
          <Check className="w-4 h-4" />
          <span>{isSaving ? 'در حال ذخیره...' : 'ذخیره تغییرات فاکتور'}</span>
        </button>
      </div>
    </form>
  );
};
