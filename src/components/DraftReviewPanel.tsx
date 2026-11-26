import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import type {
  CategoryDefinition,
  CostCenter,
  Currency,
  DocumentType,
  ExchangeRates,
  ExpenseCategory,
  ExpenseFields,
  ExpenseRecord,
  ExtractedExpenseDraft,
  PaymentMethod,
  PaymentStatus,
  PaymentTranche,
} from '../types/expense';
import {
  COST_CENTER_LABELS,
  CURRENCY_LABELS,
  DOCUMENT_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  convertRialTomanValues,
  derivePaymentStatusFromTranches,
  detectPotentialDuplicates,
  formatCurrency,
  getCategoryLabel,
  getUniquePurchasers,
  normalizePurchaserName,
  normalizeToToman,
  resolveCategories,
} from '../utils/finance';
import { formatJalaliDate, toPersianDigits } from '../utils/jalali';
import { JalaliDateInput } from './JalaliDateInput';
import { PaymentTranchesEditor } from './PaymentTranchesEditor';

interface DraftReviewPanelProps {
  drafts: ExtractedExpenseDraft[];
  previewPages: string[];
  existingExpenses: ExpenseRecord[];
  categories?: CategoryDefinition[];
  rates: ExchangeRates;
  isSaving: boolean;
  saveError: string | null;
  onUpdateDrafts: (updated: ExtractedExpenseDraft[]) => void;
  onClearPreviewPages: () => void;
  onApprove: (approvedItems: ExpenseFields[]) => void;
  onCancel: () => void;
}

export const DraftReviewPanel: React.FC<DraftReviewPanelProps> = ({
  drafts,
  previewPages,
  existingExpenses,
  categories,
  rates,
  isSaving,
  saveError,
  onUpdateDrafts,
  onClearPreviewPages,
  onApprove,
  onCancel,
}) => {
  const activeCategories = useMemo(() => resolveCategories(categories), [categories]);
  const [activePageIndex, setActivePageIndex] = useState(0);
  const [validationError, setValidationError] = useState<string | null>(null);

  const selectedCount = useMemo(
    () => drafts.filter((d) => d.selected).length,
    [drafts]
  );

  const purchaserSuggestions = useMemo(
    () => getUniquePurchasers(existingExpenses),
    [existingExpenses]
  );

  const updateDraft = (tempId: string, patch: Partial<ExtractedExpenseDraft>) => {
    onUpdateDrafts(
      drafts.map((d) => (d.tempId === tempId ? { ...d, ...patch } : d))
    );
  };

  const handleCurrencyChange = (draft: ExtractedExpenseDraft, nextCurrency: Currency) => {
    if (nextCurrency === 'USD' || nextCurrency === 'EUR') {
      const existingValidRate =
        draft.currency === nextCurrency && draft.exchangeRateToToman && draft.exchangeRateToToman > 0
          ? draft.exchangeRateToToman
          : rates[nextCurrency];
      updateDraft(draft.tempId, {
        currency: nextCurrency,
        exchangeRateToToman: existingValidRate,
      });
    } else {
      updateDraft(draft.tempId, {
        currency: nextCurrency,
        exchangeRateToToman: undefined,
      });
    }
  };

  const handleConvertRialToman = (draft: ExtractedExpenseDraft) => {
    if (draft.currency !== 'IRR' && draft.currency !== 'IRT') return;
    const toCurrency = draft.currency === 'IRR' ? 'IRT' : 'IRR';
    const converted = convertRialTomanValues({
      amount: draft.amount,
      taxAmount: draft.taxAmount,
      discountAmount: draft.discountAmount,
      lineItems: draft.lineItems,
      paymentTranches: draft.paymentTranches,
      fromCurrency: draft.currency,
      toCurrency,
    });
    updateDraft(draft.tempId, converted);
  };

  const handleUpdateTranches = (draft: ExtractedExpenseDraft, nextTranches: PaymentTranche[]) => {
    if (nextTranches.length === 0) {
      updateDraft(draft.tempId, {
        paymentTranches: undefined,
        paymentStatus: draft.paymentStatus === 'partial' ? 'pending' : draft.paymentStatus,
      });
      return;
    }
    const derivedStatus = derivePaymentStatusFromTranches(
      draft.amount,
      nextTranches,
      draft.paymentStatus
    );
    const unpaidTranche = nextTranches.find((t) => t.status !== 'paid');
    updateDraft(draft.tempId, {
      paymentTranches: nextTranches,
      paymentStatus: derivedStatus,
      paymentMethod: unpaidTranche?.method ?? nextTranches[0].method,
      dueDate: unpaidTranche?.date ?? draft.dueDate,
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);
    const chosen = drafts.filter((d) => d.selected);
    if (chosen.length === 0) {
      setValidationError('حداقل یک مورد را برای ثبت انتخاب کنید.');
      return;
    }
    for (const item of chosen) {
      if (!item.title.trim() || !item.vendor.trim()) {
        setValidationError('عنوان هزینه و نام فروشنده برای همه موارد انتخاب‌شده الزامی است.');
        return;
      }
      if (!Number.isFinite(item.amount) || item.amount <= 0) {
        setValidationError('مبلغ هزینه باید عددی بزرگتر از صفر باشد.');
        return;
      }
      if (
        (item.currency === 'USD' || item.currency === 'EUR') &&
        (!item.exchangeRateToToman || item.exchangeRateToToman <= 0)
      ) {
        setValidationError('برای اسناد ارزی، ثبت نرخ تسعیر معتبر (به تومان) الزامی است.');
        return;
      }
      if (item.paymentTranches && item.paymentTranches.length > 0) {
        const trancheSum = item.paymentTranches.reduce((s, t) => s + (t.amount || 0), 0);
        if (trancheSum > item.amount + 0.01) {
          setValidationError(
            `جمع بخش‌های پرداخت در «${item.title}» از مبلغ کل سند بیشتر است.`
          );
          return;
        }
      }
    }

    const payload: ExpenseFields[] = chosen.map(({ tempId: _t, selected: _s, ...fields }) => ({
      ...fields,
      title: fields.title.trim(),
      vendor: fields.vendor.trim(),
      purchaser: normalizePurchaserName(fields.purchaser),
      exchangeRateToToman:
        fields.currency === 'USD' || fields.currency === 'EUR'
          ? fields.exchangeRateToToman ?? rates[fields.currency]
          : undefined,
      paymentStatus: derivePaymentStatusFromTranches(
        fields.amount,
        fields.paymentTranches,
        fields.paymentStatus
      ),
    }));
    onApprove(payload);
  };

  const hasPreviewSidebar = previewPages.length > 0;

  return (
    <form onSubmit={handleSubmit} className="max-w-6xl mx-auto space-y-6 pb-24 md:pb-6">
      <datalist id="draft-purchaser-suggestions">
        {purchaserSuggestions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
            بررسی و تایید نهایی پیش‌نویس
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            اطلاعات استخراج‌شده را بازبینی یا ویرایش کنید. تاریخ‌ها به شمسی است و نرخ تسعیر اسناد ارزی برای همین سند ذخیره می‌شود.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSaving}
            className="min-h-[42px] px-4 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            انصراف و بازگشت
          </button>
          <button
            type="submit"
            disabled={isSaving || selectedCount === 0}
            className="inline-flex items-center gap-2 min-h-[42px] px-5 py-2 rounded-xl bg-teal-700 text-white text-xs sm:text-sm font-semibold hover:bg-teal-800 disabled:opacity-50 cursor-pointer"
          >
            <Check className="w-4 h-4" />
            <span>
              {isSaving
                ? 'در حال ثبت...'
                : `تایید و ثبت (${toPersianDigits(selectedCount)} مورد)`}
            </span>
          </button>
        </div>
      </div>

      {(validationError || saveError) && (
        <div
          role="alert"
          className="rounded-2xl bg-red-50 border border-red-200 p-4 text-sm text-red-900 flex items-center gap-2"
        >
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
          <span>{validationError ?? saveError}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Source Image / Rendered PDF Pages Preview */}
        {hasPreviewSidebar && (
          <aside className="lg:col-span-4 rounded-2xl bg-white border border-slate-200 p-4 lg:sticky lg:top-20 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-slate-900">
                پیش‌نمایش تصویر سند
              </h2>
              <button
                type="button"
                onClick={onClearPreviewPages}
                className="inline-flex items-center gap-1 min-h-[34px] px-2.5 py-1 rounded-lg border border-red-200 bg-red-50/70 text-[11px] font-semibold text-red-700 hover:bg-red-100 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>حذف تصویر از این ثبت</span>
              </button>
            </div>

            {previewPages.length > 1 && (
              <div className="flex items-center justify-between text-xs text-slate-600 tabular-nums">
                <button
                  type="button"
                  aria-label="صفحه قبلی"
                  onClick={() => setActivePageIndex((i) => Math.max(0, i - 1))}
                  disabled={activePageIndex === 0}
                  className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg border border-slate-200 disabled:opacity-40 cursor-pointer"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
                <span className="px-2">
                  صفحه {toPersianDigits(activePageIndex + 1)} از {toPersianDigits(previewPages.length)}
                </span>
                <button
                  type="button"
                  aria-label="صفحه بعدی"
                  onClick={() =>
                    setActivePageIndex((i) => Math.min(previewPages.length - 1, i + 1))
                  }
                  disabled={activePageIndex === previewPages.length - 1}
                  className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg border border-slate-200 disabled:opacity-40 cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
              </div>
            )}

            <div className="rounded-xl overflow-hidden border border-slate-200 bg-slate-100">
              <img
                src={previewPages[activePageIndex]}
                alt={`صفحه ${activePageIndex + 1} سند`}
                className="w-full max-h-[440px] object-contain mx-auto"
              />
            </div>

            {previewPages.length > 1 && (
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {previewPages.map((src, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setActivePageIndex(idx)}
                    className={`shrink-0 rounded-lg border-2 overflow-hidden cursor-pointer ${
                      idx === activePageIndex ? 'border-teal-600' : 'border-transparent opacity-70'
                    }`}
                  >
                    <img
                      src={src}
                      alt={`بند انگشتی صفحه ${idx + 1}`}
                      className="h-14 w-11 object-cover bg-white"
                    />
                  </button>
                ))}
              </div>
            )}
          </aside>
        )}

        {/* Editable Structured Draft Cards */}
        <div className={`${hasPreviewSidebar ? 'lg:col-span-8' : 'lg:col-span-12'} space-y-5`}>
          {drafts.map((draft, index) => {
            const duplicates = detectPotentialDuplicates(draft, existingExpenses, rates);
            const isForeignCurrency = draft.currency === 'USD' || draft.currency === 'EUR';
            const effectiveRate =
              draft.currency === 'USD' || draft.currency === 'EUR'
                ? draft.exchangeRateToToman ?? rates[draft.currency]
                : undefined;
            const tomanEquivalent = normalizeToToman(
              draft.amount,
              draft.currency,
              rates,
              effectiveRate
            );

            return (
              <div
                key={draft.tempId}
                className={`rounded-2xl bg-white border p-5 space-y-5 transition-opacity ${
                  draft.selected ? 'border-slate-200' : 'border-slate-200 opacity-60'
                }`}
              >
                {/* Draft Card Header */}
                <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <label className="inline-flex items-center gap-2.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={draft.selected}
                        onChange={(e) => updateDraft(draft.tempId, { selected: e.target.checked })}
                        className="w-5 h-5 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                      />
                      <span className="text-sm font-bold text-slate-900">
                        ردیف {toPersianDigits(index + 1)}: {draft.title || 'پیش‌نویس هزینه جدید'}
                      </span>
                    </label>
                    <span
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${
                        (draft.paymentTranches?.length ?? 0) > 0
                          ? 'bg-sky-50 text-sky-700'
                          : draft.paymentStatus === 'paid'
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-amber-50 text-amber-700'
                      }`}
                    >
                      {(draft.paymentTranches?.length ?? 0) > 0
                        ? `پرداخت ترکیبی (${toPersianDigits(draft.paymentTranches!.length)} بخش)`
                        : draft.paymentStatus === 'paid'
                          ? 'تسویه یکجا و کامل'
                          : `یک‌مرحله‌ای · ${PAYMENT_STATUS_LABELS[draft.paymentStatus]}`}
                    </span>
                  </div>

                  {drafts.length > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateDrafts(drafts.filter((d) => d.tempId !== draft.tempId))
                      }
                      aria-label={`حذف پیش‌نویس ${draft.title || index + 1}`}
                      className="min-h-[36px] px-2.5 rounded-lg text-xs text-red-600 hover:bg-red-50 inline-flex items-center gap-1 cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                      <span>حذف این پیش‌نویس</span>
                    </button>
                  )}
                </div>

                {/* Extraction & Duplicate Alerts */}
                {draft.extractionNotes && (
                  <div className="rounded-xl bg-slate-50 border border-slate-200 px-3.5 py-2.5 text-xs text-slate-700 leading-relaxed">
                    <strong>یادداشت استخراج هوشمند:</strong> {draft.extractionNotes}
                  </div>
                )}

                {duplicates.length > 0 && (
                  <div className="rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-2.5 text-xs text-amber-950 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-bold">احتمال ثبت تکراری</div>
                      {duplicates.map((m) => (
                        <div key={m.existing.id} className="mt-0.5">
                          {m.reason} — «{m.existing.title}» ({formatJalaliDate(m.existing.date)})
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Main Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div className="sm:col-span-2">
                    <label
                      htmlFor={`title-${draft.tempId}`}
                      className="block text-xs font-semibold text-slate-700 mb-1.5"
                    >
                      عنوان یا شرح هزینه *
                    </label>
                    <input
                      id={`title-${draft.tempId}`}
                      type="text"
                      required
                      value={draft.title}
                      onChange={(e) => updateDraft(draft.tempId, { title: e.target.value })}
                      placeholder="مثلاً: خرید سرور ابری آبان"
                      className="w-full min-h-[42px] rounded-xl border border-slate-200 px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor={`vendor-${draft.tempId}`}
                      className="block text-xs font-semibold text-slate-700 mb-1.5"
                    >
                      فروشنده / طرف حساب *
                    </label>
                    <input
                      id={`vendor-${draft.tempId}`}
                      type="text"
                      required
                      value={draft.vendor}
                      onChange={(e) => updateDraft(draft.tempId, { vendor: e.target.value })}
                      placeholder="نام شرکت یا فروشگاه"
                      className="w-full min-h-[42px] rounded-xl border border-slate-200 px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor={`amount-${draft.tempId}`}
                      className="block text-xs font-semibold text-slate-700 mb-1.5"
                    >
                      مبلغ کل ({CURRENCY_LABELS[draft.currency]}) *
                    </label>
                    <input
                      id={`amount-${draft.tempId}`}
                      type="number"
                      min={0}
                      step="any"
                      required
                      value={draft.amount}
                      onChange={(e) =>
                        updateDraft(draft.tempId, { amount: Number(e.target.value) || 0 })
                      }
                      className="w-full min-h-[42px] rounded-xl border border-slate-200 px-3 text-sm font-mono-num text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                    {draft.currency !== 'IRT' && (
                      <span className="block mt-1 text-[11px] text-slate-500 tabular-nums">
                        معادل: {formatCurrency(tomanEquivalent, 'IRT')}
                      </span>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor={`currency-${draft.tempId}`}
                      className="block text-xs font-semibold text-slate-700 mb-1.5"
                    >
                      واحد پول سند
                    </label>
                    <select
                      id={`currency-${draft.tempId}`}
                      value={draft.currency}
                      onChange={(e) =>
                        handleCurrencyChange(draft, e.target.value as Currency)
                      }
                      className="w-full min-h-[42px] rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                    >
                      {(Object.keys(CURRENCY_LABELS) as Currency[]).map((c) => (
                        <option key={c} value={c}>
                          {CURRENCY_LABELS[c]}
                        </option>
                      ))}
                    </select>
                    {(draft.currency === 'IRR' || draft.currency === 'IRT') && (
                      <button
                        type="button"
                        onClick={() => handleConvertRialToman(draft)}
                        className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-teal-700 hover:text-teal-900 cursor-pointer"
                      >
                        <ArrowLeftRight className="w-3.5 h-3.5" />
                        <span>
                          {draft.currency === 'IRR'
                            ? 'تبدیل مبالغ به تومان (÷۱۰)'
                            : 'تبدیل مبالغ به ریال (×۱۰)'}
                        </span>
                      </button>
                    )}
                  </div>

                  {isForeignCurrency ? (
                    <div>
                      <label
                        htmlFor={`rate-${draft.tempId}`}
                        className="block text-xs font-semibold text-slate-700 mb-1.5"
                      >
                        نرخ تسعیر این سند (تومان) *
                      </label>
                      <input
                        id={`rate-${draft.tempId}`}
                        type="number"
                        min={1}
                        step={100}
                        required
                        value={effectiveRate ?? 0}
                        onChange={(e) =>
                          updateDraft(draft.tempId, {
                            exchangeRateToToman: Number(e.target.value) || 0,
                          })
                        }
                        className="w-full min-h-[42px] rounded-xl border border-teal-300 bg-teal-50/40 px-3 text-sm font-mono-num text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                      />
                      <span className="block mt-1 text-[11px] text-slate-500">
                        نرخ تاریخی مخصوص این سند (با تغییر نرخ روز عوض نمی‌شود)
                      </span>
                    </div>
                  ) : (
                    <JalaliDateInput
                      idPrefix={`date-${draft.tempId}`}
                      label={`تاریخ سند (${formatJalaliDate(draft.date)})`}
                      value={draft.date}
                      onChange={(iso) => updateDraft(draft.tempId, { date: iso })}
                    />
                  )}

                  {isForeignCurrency && (
                    <JalaliDateInput
                      idPrefix={`date-${draft.tempId}`}
                      label={`تاریخ سند (${formatJalaliDate(draft.date)})`}
                      value={draft.date}
                      onChange={(iso) => updateDraft(draft.tempId, { date: iso })}
                    />
                  )}

                  <div>
                    <label
                      htmlFor={`category-${draft.tempId}`}
                      className="block text-xs font-semibold text-slate-700 mb-1.5"
                    >
                      حوزه هزینه
                    </label>
                    <select
                      id={`category-${draft.tempId}`}
                      value={draft.category}
                      onChange={(e) =>
                        updateDraft(draft.tempId, { category: e.target.value as ExpenseCategory })
                      }
                      className="w-full min-h-[42px] rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                    >
                      {(activeCategories.some((c) => c.id === draft.category)
                        ? activeCategories
                        : [
                            ...activeCategories,
                            {
                              id: draft.category,
                              label: getCategoryLabel(draft.category, activeCategories),
                              color: '#64748B',
                            },
                          ]
                      ).map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {cat.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor={`costcenter-${draft.tempId}`}
                      className="block text-xs font-semibold text-slate-700 mb-1.5"
                    >
                      مرکز هزینه / دپارتمان
                    </label>
                    <select
                      id={`costcenter-${draft.tempId}`}
                      value={draft.costCenter}
                      onChange={(e) =>
                        updateDraft(draft.tempId, { costCenter: e.target.value as CostCenter })
                      }
                      className="w-full min-h-[42px] rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                    >
                      {(Object.keys(COST_CENTER_LABELS) as CostCenter[]).map((cc) => (
                        <option key={cc} value={cc}>
                          {COST_CENTER_LABELS[cc]}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor={`doctype-${draft.tempId}`}
                      className="block text-xs font-semibold text-slate-700 mb-1.5"
                    >
                      نوع سند
                    </label>
                    <select
                      id={`doctype-${draft.tempId}`}
                      value={draft.documentType}
                      onChange={(e) =>
                        updateDraft(draft.tempId, { documentType: e.target.value as DocumentType })
                      }
                      className="w-full min-h-[42px] rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                    >
                      {(Object.keys(DOCUMENT_TYPE_LABELS) as DocumentType[]).map((dt) => (
                        <option key={dt} value={dt}>
                          {DOCUMENT_TYPE_LABELS[dt]}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor={`paymethod-${draft.tempId}`}
                      className="block text-xs font-semibold text-slate-700 mb-1.5"
                    >
                      روش پرداخت
                    </label>
                    <select
                      id={`paymethod-${draft.tempId}`}
                      value={draft.paymentMethod}
                      onChange={(e) =>
                        updateDraft(draft.tempId, { paymentMethod: e.target.value as PaymentMethod })
                      }
                      className="w-full min-h-[42px] rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                    >
                      {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((pm) => (
                        <option key={pm} value={pm}>
                          {PAYMENT_METHOD_LABELS[pm]}
                        </option>
                      ))}
                    </select>
                    {(draft.paymentMethod === 'personal_card' || draft.paymentMethod === 'petty_cash') && (
                      <span className="block mt-1 text-[11px] text-teal-700">
                        برای محاسبه هزینه هر فرد، نام «مسئول خرید» را هم ثبت کنید.
                      </span>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor={`paystatus-${draft.tempId}`}
                      className="block text-xs font-semibold text-slate-700 mb-1.5"
                    >
                      وضعیت پرداخت
                    </label>
                    <select
                      id={`paystatus-${draft.tempId}`}
                      value={draft.paymentStatus}
                      onChange={(e) =>
                        updateDraft(draft.tempId, { paymentStatus: e.target.value as PaymentStatus })
                      }
                      className="w-full min-h-[42px] rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                    >
                      {(Object.keys(PAYMENT_STATUS_LABELS) as PaymentStatus[]).map((ps) => (
                        <option key={ps} value={ps}>
                          {PAYMENT_STATUS_LABELS[ps]}
                        </option>
                      ))}
                    </select>
                    {(draft.paymentTranches?.length ?? 0) > 0 && (
                      <span className="block mt-1 text-[11px] text-slate-500">
                        محاسبه‌شده از جدول پرداخت بخشی
                      </span>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor={`tax-${draft.tempId}`}
                      className="block text-xs font-semibold text-slate-700 mb-1.5"
                    >
                      مالیات ارزش افزوده ({CURRENCY_LABELS[draft.currency]})
                    </label>
                    <input
                      id={`tax-${draft.tempId}`}
                      type="number"
                      min={0}
                      step="any"
                      value={draft.taxAmount}
                      onChange={(e) =>
                        updateDraft(draft.tempId, { taxAmount: Number(e.target.value) || 0 })
                      }
                      className="w-full min-h-[42px] rounded-xl border border-slate-200 px-3 text-sm font-mono-num text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor={`inv-${draft.tempId}`}
                      className="block text-xs font-semibold text-slate-700 mb-1.5"
                    >
                      شماره فاکتور
                    </label>
                    <input
                      id={`inv-${draft.tempId}`}
                      type="text"
                      value={draft.invoiceNumber ?? ''}
                      onChange={(e) =>
                        updateDraft(draft.tempId, { invoiceNumber: e.target.value || undefined })
                      }
                      className="w-full min-h-[42px] rounded-xl border border-slate-200 px-3 text-sm font-mono-num text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor={`trk-${draft.tempId}`}
                      className="block text-xs font-semibold text-slate-700 mb-1.5"
                    >
                      کد پیگیری / ارجاع
                    </label>
                    <input
                      id={`trk-${draft.tempId}`}
                      type="text"
                      value={draft.trackingCode ?? ''}
                      onChange={(e) =>
                        updateDraft(draft.tempId, { trackingCode: e.target.value || undefined })
                      }
                      className="w-full min-h-[42px] rounded-xl border border-slate-200 px-3 text-sm font-mono-num text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor={`purchaser-${draft.tempId}`}
                      className="block text-xs font-semibold text-slate-700 mb-1.5"
                    >
                      مسئول خرید / پرداخت‌کننده
                    </label>
                    <input
                      id={`purchaser-${draft.tempId}`}
                      type="text"
                      list="draft-purchaser-suggestions"
                      value={draft.purchaser ?? ''}
                      onChange={(e) =>
                        updateDraft(draft.tempId, { purchaser: e.target.value || undefined })
                      }
                      placeholder="مثلاً: علی رضایی (اختیاری)"
                      className="w-full min-h-[42px] rounded-xl border border-slate-200 px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor={`proj-${draft.tempId}`}
                      className="block text-xs font-semibold text-slate-700 mb-1.5"
                    >
                      برچسب پروژه / قرارداد
                    </label>
                    <input
                      id={`proj-${draft.tempId}`}
                      type="text"
                      value={draft.projectTag ?? ''}
                      onChange={(e) =>
                        updateDraft(draft.tempId, { projectTag: e.target.value || undefined })
                      }
                      placeholder="اختیاری"
                      className="w-full min-h-[42px] rounded-xl border border-slate-200 px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>

                  {(draft.paymentStatus !== 'paid' || draft.dueDate) && (
                    <JalaliDateInput
                      idPrefix={`duedate-${draft.tempId}`}
                      label={`تاریخ سررسید (${draft.dueDate ? formatJalaliDate(draft.dueDate) : 'تعیین‌نشده'})`}
                      value={draft.dueDate || draft.date}
                      onChange={(iso) => updateDraft(draft.tempId, { dueDate: iso })}
                      allowClear={Boolean(draft.dueDate)}
                      onClear={() => updateDraft(draft.tempId, { dueDate: undefined })}
                    />
                  )}

                  <div className="sm:col-span-2 lg:col-span-3">
                    <label
                      htmlFor={`notes-${draft.tempId}`}
                      className="block text-xs font-semibold text-slate-700 mb-1.5"
                    >
                      یادداشت حسابداری
                    </label>
                    <input
                      id={`notes-${draft.tempId}`}
                      type="text"
                      value={draft.notes ?? ''}
                      onChange={(e) =>
                        updateDraft(draft.tempId, { notes: e.target.value || undefined })
                      }
                      placeholder="توضیحات تکمیلی برای بایگانی مالی"
                      className="w-full min-h-[42px] rounded-xl border border-slate-200 px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>
                </div>

                {/* Split / Partial Payment Tranches */}
                <PaymentTranchesEditor
                  idPrefix={draft.tempId}
                  totalAmount={draft.amount}
                  currency={draft.currency}
                  rates={rates}
                  documentExchangeRate={effectiveRate}
                  baseDate={draft.date}
                  paymentStatus={draft.paymentStatus}
                  tranches={draft.paymentTranches ?? []}
                  onChange={(nextTranches) => handleUpdateTranches(draft, nextTranches)}
                />

                {/* Line Items Section */}
                <div className="pt-3 border-t border-slate-100">
                  <div className="flex items-center justify-between gap-2 mb-2.5">
                    <span className="text-xs font-bold text-slate-800">
                      اقلام ریز فاکتور ({toPersianDigits(draft.lineItems.length)})
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        updateDraft(draft.tempId, {
                          lineItems: [
                            ...draft.lineItems,
                            { description: '', quantity: 1, unitPrice: 0, totalPrice: 0 },
                          ],
                        })
                      }
                      className="inline-flex items-center gap-1 min-h-[34px] px-2.5 rounded-lg bg-slate-100 text-xs font-semibold text-slate-700 hover:bg-slate-200 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>افزودن قلم</span>
                    </button>
                  </div>

                  {draft.lineItems.length > 0 && (
                    <div className="space-y-2">
                      {draft.lineItems.map((li, liIdx) => (
                        <div
                          key={liIdx}
                          className="grid grid-cols-12 gap-2 items-center bg-slate-50 p-2 rounded-xl"
                        >
                          <input
                            type="text"
                            aria-label={`شرح قلم ${liIdx + 1}`}
                            placeholder="شرح کالا یا خدمت"
                            value={li.description}
                            onChange={(e) => {
                              const next = [...draft.lineItems];
                              next[liIdx] = { ...li, description: e.target.value };
                              updateDraft(draft.tempId, { lineItems: next });
                            }}
                            className="col-span-12 sm:col-span-5 min-h-[36px] rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-900"
                          />
                          <input
                            type="number"
                            aria-label={`تعداد قلم ${liIdx + 1}`}
                            min={1}
                            value={li.quantity}
                            onChange={(e) => {
                              const qty = Number(e.target.value) || 1;
                              const next = [...draft.lineItems];
                              next[liIdx] = {
                                ...li,
                                quantity: qty,
                                totalPrice: qty * li.unitPrice,
                              };
                              updateDraft(draft.tempId, { lineItems: next });
                            }}
                            className="col-span-4 sm:col-span-2 min-h-[36px] rounded-lg border border-slate-200 bg-white px-2 text-xs font-mono-num text-slate-900"
                          />
                          <input
                            type="number"
                            aria-label={`فی قلم ${liIdx + 1}`}
                            min={0}
                            step="any"
                            value={li.unitPrice}
                            onChange={(e) => {
                              const up = Number(e.target.value) || 0;
                              const next = [...draft.lineItems];
                              next[liIdx] = {
                                ...li,
                                unitPrice: up,
                                totalPrice: li.quantity * up,
                              };
                              updateDraft(draft.tempId, { lineItems: next });
                            }}
                            className="col-span-6 sm:col-span-4 min-h-[36px] rounded-lg border border-slate-200 bg-white px-2 text-xs font-mono-num text-slate-900"
                          />
                          <button
                            type="button"
                            aria-label={`حذف قلم ${liIdx + 1}`}
                            onClick={() => {
                              const next = draft.lineItems.filter((_, idx) => idx !== liIdx);
                              updateDraft(draft.tempId, { lineItems: next });
                            }}
                            className="col-span-2 sm:col-span-1 min-h-[36px] flex items-center justify-center rounded-lg text-red-600 hover:bg-red-100 cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </form>
  );
};
