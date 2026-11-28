import { MoneyInput } from './MoneyInput';
import { addCalendarDays, businessDateIso } from '../utils/jalali';
import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Plus, Split, Trash2 } from 'lucide-react';
import type {
  Currency,
  DisplayUnit,
  ExchangeRates,
  PaymentMethod,
  PaymentStatus,
  PaymentTranche,
  PaymentTrancheStatus,
} from '../types/expense';
import {
  PAYMENT_METHOD_LABELS,
  formatDisplayAmount,
  getEntryCurrency,
  toEntryAmount,
  fromEntryAmount,
  CURRENCY_LABELS,
  summarizeExpensePayments,
} from '../utils/finance';
import { formatJalaliDate, toPersianDigits } from '../utils/jalali';
import { JalaliDateInput } from './JalaliDateInput';

interface PaymentTranchesEditorProps {
  idPrefix: string;
  totalAmount: number;
  currency: Currency;
  displayUnit: DisplayUnit;
  rates: ExchangeRates;
  documentExchangeRate?: number;
  baseDate: string;
  paymentStatus?: PaymentStatus;
  tranches: PaymentTranche[];
  onChange: (next: PaymentTranche[]) => void;
}

const TRANCHE_STATUS_LABELS: Record<PaymentTrancheStatus, string> = {
  paid: 'پرداخت شده',
  pending: 'در انتظار پرداخت / وصول',
  overdue: 'سررسید گذشته',
};

function addDaysIso(isoDate: string, days: number): string {
  return addCalendarDays(isoDate || businessDateIso(), days);
}

export const PaymentTranchesEditor: React.FC<PaymentTranchesEditorProps> = ({
  idPrefix,
  totalAmount,
  currency,
  displayUnit,
  rates,
  documentExchangeRate,
  baseDate,
  paymentStatus = 'paid',
  tranches,
  onChange,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [showSplitChooser, setShowSplitChooser] = useState(false);

  const summary = summarizeExpensePayments(
    {
      amount: totalAmount,
      currency,
      exchangeRateToToman: documentExchangeRate,
      paymentStatus: tranches.length > 0 ? 'partial' : paymentStatus,
      paymentTranches: tranches,
    },
    rates
  );

  const handlePresetAdvancePlusCheck = () => {
    const advance = Math.round(totalAmount * 0.3);
    const remainder = Math.max(0, totalAmount - advance);
    const now = Date.now();
    setIsCollapsed(false);
    setConfirmClearAll(false);
    setShowSplitChooser(false);
    onChange([
      {
        id: `tr-${now}-1`,
        title: 'پیش‌پرداخت',
        amount: advance,
        method: 'bank_transfer',
        status: 'paid',
        date: baseDate,
      },
      {
        id: `tr-${now}-2`,
        title: 'چک تسویه مابقی',
        amount: remainder,
        method: 'check',
        status: 'pending',
        date: addDaysIso(baseDate, 30),
      },
    ]);
  };

  const handleAddTranche = (prefillRemaining = false) => {
    const remainingToAllocate = Math.max(0, summary.unallocatedInDocCurrency);
    const defaultAmount =
      tranches.length === 0
        ? totalAmount
        : prefillRemaining
          ? remainingToAllocate
          : remainingToAllocate > 0
            ? remainingToAllocate
            : 0;

    setIsCollapsed(false);
    setConfirmClearAll(false);
    setShowSplitChooser(false);
    onChange([
      ...tranches,
      {
        id: `tr-${Date.now()}-${tranches.length + 1}`,
        title: tranches.length === 0 ? 'پیش‌پرداخت' : `قسط / چک ${toPersianDigits(tranches.length + 1)}`,
        amount: defaultAmount,
        method: tranches.length === 0 ? 'bank_transfer' : 'check',
        status: tranches.length === 0 ? 'paid' : 'pending',
        date: tranches.length === 0 ? baseDate : addDaysIso(baseDate, 30 * tranches.length),
      },
    ]);
  };

  const updateTranche = (id: string, patch: Partial<PaymentTranche>) => {
    onChange(tranches.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  };

  const removeTranche = (id: string) => {
    const next = tranches.filter((t) => t.id !== id);
    if (next.length === 0) {
      setConfirmClearAll(false);
      setIsCollapsed(false);
      setShowSplitChooser(false);
    }
    onChange(next);
  };

  const singlePaymentSubtitle =
    paymentStatus === 'paid'
      ? 'کل مبلغ این سند به صورت یکجا و کامل پرداخت شده است (بدون پیش‌پرداخت یا چک بعدی).'
      : paymentStatus === 'overdue'
        ? 'کل مبلغ به صورت یک‌مرحله‌ای در وضعیت سررسید گذشته ثبت شده است.'
        : 'کل مبلغ به صورت یک‌مرحله‌ای ثبت شده است (یکجا و بدون تقسیم به چند قسط).';

  return (
    <div className="pt-3 border-t border-slate-100 space-y-3">
      {tranches.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-block w-2 h-2 rounded-full ${
                    paymentStatus === 'paid'
                      ? 'bg-emerald-500'
                      : paymentStatus === 'overdue'
                        ? 'bg-red-500'
                        : 'bg-amber-500'
                  }`}
                />
                <span className="text-xs font-bold text-slate-800">
                  نحوه تسویه:{' '}
                  {paymentStatus === 'paid'
                    ? 'پرداخت یکجا و کامل'
                    : paymentStatus === 'overdue'
                      ? 'یک‌مرحله‌ای (سررسید گذشته)'
                      : 'یک‌مرحله‌ای (در انتظار پرداخت)'}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                {singlePaymentSubtitle}
              </p>
            </div>

            <button
              type="button"
              onClick={() => setShowSplitChooser((v) => !v)}
              className="inline-flex items-center gap-1.5 min-h-[34px] px-3 py-1 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-100 cursor-pointer shrink-0"
            >
              <Split className="w-3.5 h-3.5 text-slate-500" />
              <span>
                {showSplitChooser ? 'بستن گزینه‌های تقسیط' : 'تغییر به پرداخت بخشی / چکی'}
              </span>
            </button>
          </div>

          {showSplitChooser && (
            <div className="pt-2.5 border-t border-slate-200/80 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] text-slate-600">
                اگر واقعاً این سند شامل پیش‌پرداخت و مابقی چک/قسط است، یکی از گزینه‌ها را انتخاب کنید:
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handlePresetAdvancePlusCheck}
                  className="inline-flex items-center gap-1.5 min-h-[34px] px-3 py-1 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-800 hover:bg-slate-100 cursor-pointer"
                >
                  <Split className="w-3.5 h-3.5 text-slate-600" />
                  <span>پیش‌پرداخت (۳۰٪) + مابقی چک</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleAddTranche(false)}
                  className="inline-flex items-center gap-1 min-h-[34px] px-3 py-1 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-800 hover:bg-slate-100 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5 text-slate-600" />
                  <span>افزودن بخش / چک دلخواه</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowSplitChooser(false)}
                  className="min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-medium text-slate-500 hover:bg-slate-200/60 cursor-pointer"
                >
                  انصراف (ماندن در حالت یکجا)
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <span className="text-xs font-bold text-slate-800">
              پرداخت بخشی / ترکیبی (پیش‌پرداخت، چک، اقساط) — {toPersianDigits(tranches.length)} بخش
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => handleAddTranche(true)}
              className="inline-flex items-center gap-1 min-h-[34px] px-2.5 rounded-lg bg-slate-100 text-xs font-semibold text-slate-700 hover:bg-slate-200 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>افزودن بخش / چک</span>
            </button>
            <button
              type="button"
              onClick={() => setIsCollapsed((v) => !v)}
              className="inline-flex items-center gap-1 min-h-[34px] px-2.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              {isCollapsed ? (
                <>
                  <ChevronDown className="w-3.5 h-3.5" />
                  <span>نمایش جزئیات بخش‌ها</span>
                </>
              ) : (
                <>
                  <ChevronUp className="w-3.5 h-3.5" />
                  <span>بستن نما (با حفظ اطلاعات)</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => setConfirmClearAll(true)}
              className="min-h-[34px] px-2.5 rounded-lg text-xs font-medium text-red-600 hover:bg-red-50 cursor-pointer"
            >
              پاک کردن همه بخش‌ها (تبدیل به یکجا)
            </button>
          </div>
        </div>
      )}

      {confirmClearAll && tranches.length > 0 && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
          <span className="text-xs font-semibold text-red-900 leading-relaxed">
            آیا می‌خواهید تمام {toPersianDigits(tranches.length)} بخش پرداخت (پیش‌پرداخت / چک / قسط) این سند پاک شده و پرداخت به صورت یکجا ثبت شود؟
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setConfirmClearAll(false);
                setIsCollapsed(false);
                setShowSplitChooser(false);
                onChange([]);
              }}
              className="min-h-[34px] px-3 py-1 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 cursor-pointer"
            >
              تایید حذف بخش‌ها
            </button>
            <button
              type="button"
              onClick={() => setConfirmClearAll(false)}
              className="min-h-[34px] px-3 py-1 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              انصراف (حفظ اطلاعات)
            </button>
          </div>
        </div>
      )}

      {tranches.length > 0 && (
        <>
          {/* Summary Strip */}
          <div className="rounded-xl bg-slate-50 border border-slate-200 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs tabular-nums">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="text-emerald-700 font-semibold">
                پرداخت‌شده: {formatDisplayAmount(summary.paidInDocCurrency, currency, rates, displayUnit, documentExchangeRate)}
              </span>
              <span className="text-amber-700 font-semibold">
                مانده تسویه: {formatDisplayAmount(summary.remainingInDocCurrency, currency, rates, displayUnit, documentExchangeRate)}
              </span>
              <span className="text-slate-600">
                جمع بخش‌ها: {formatDisplayAmount(summary.tranchesTotalInDocCurrency, currency, rates, displayUnit, documentExchangeRate)}
              </span>
            </div>

            {summary.unallocatedInDocCurrency > 0.01 && (
              <button
                type="button"
                onClick={() => handleAddTranche(true)}
                className="text-[11px] font-semibold text-teal-700 hover:text-teal-900 underline cursor-pointer"
              >
                ثبت مانده ({formatDisplayAmount(summary.unallocatedInDocCurrency, currency, rates, displayUnit, documentExchangeRate)}) به عنوان چک/قسط جدید
              </button>
            )}

            {summary.unallocatedInDocCurrency < -0.01 && (
              <span className="text-[11px] font-semibold text-red-600">
                جمع بخش‌ها از مبلغ کل سند بیشتر است
              </span>
            )}
          </div>

          {!isCollapsed && (
            <div className="space-y-3">
            {tranches.map((tr, idx) => (
              <div
                key={tr.id}
                className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-700">
                    بخش {toPersianDigits(idx + 1)}
                  </span>
                  <button
                    type="button"
                    aria-label={`حذف بخش پرداخت ${tr.title || idx + 1}`}
                    onClick={() => removeTranche(tr.id)}
                    className="inline-flex items-center gap-1 min-h-[32px] px-2 rounded-lg text-xs text-red-600 hover:bg-red-100 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>حذف این بخش</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  <div>
                    <label
                      htmlFor={`${idPrefix}-tr-title-${tr.id}`}
                      className="block text-[11px] font-semibold text-slate-600 mb-1"
                    >
                      عنوان بخش (مثلاً پیش‌پرداخت، چک ۱)
                    </label>
                    <input
                      id={`${idPrefix}-tr-title-${tr.id}`}
                      type="text"
                      value={tr.title}
                      onChange={(e) => updateTranche(tr.id, { title: e.target.value })}
                      className="w-full min-h-[38px] rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor={`${idPrefix}-tr-amount-${tr.id}`}
                      className="block text-[11px] font-semibold text-slate-600 mb-1"
                    >
                      مبلغ این بخش ({CURRENCY_LABELS[getEntryCurrency(currency, displayUnit)]})
                    </label>
                    <MoneyInput
                      id={`${idPrefix}-tr-amount-${tr.id}`}
                      min={0}
                      step="any"
                      value={toEntryAmount(tr.amount, currency, displayUnit)}
                      onValueChange={(value) =>
                        updateTranche(tr.id, { amount: fromEntryAmount(value || 0, currency, displayUnit) })
                      }
                      className="w-full min-h-[38px] rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-mono-num text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor={`${idPrefix}-tr-method-${tr.id}`}
                      className="block text-[11px] font-semibold text-slate-600 mb-1"
                    >
                      روش پرداخت
                    </label>
                    <select
                      id={`${idPrefix}-tr-method-${tr.id}`}
                      value={tr.method}
                      onChange={(e) =>
                        updateTranche(tr.id, { method: e.target.value as PaymentMethod })
                      }
                      className="w-full min-h-[38px] rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                    >
                      {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((pm) => (
                        <option key={pm} value={pm}>
                          {PAYMENT_METHOD_LABELS[pm]}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor={`${idPrefix}-tr-status-${tr.id}`}
                      className="block text-[11px] font-semibold text-slate-600 mb-1"
                    >
                      وضعیت این بخش
                    </label>
                    <select
                      id={`${idPrefix}-tr-status-${tr.id}`}
                      value={tr.status}
                      onChange={(e) =>
                        updateTranche(tr.id, { status: e.target.value as PaymentTrancheStatus })
                      }
                      className="w-full min-h-[38px] rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                    >
                      {(Object.keys(TRANCHE_STATUS_LABELS) as PaymentTrancheStatus[]).map((st) => (
                        <option key={st} value={st}>
                          {TRANCHE_STATUS_LABELS[st]}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor={`${idPrefix}-tr-ref-${tr.id}`}
                      className="block text-[11px] font-semibold text-slate-600 mb-1"
                    >
                      شماره چک / صیاد / پیگیری
                    </label>
                    <input
                      id={`${idPrefix}-tr-ref-${tr.id}`}
                      type="text"
                      value={tr.referenceCode ?? ''}
                      onChange={(e) =>
                        updateTranche(tr.id, { referenceCode: e.target.value || undefined })
                      }
                      placeholder="اختیاری"
                      className="w-full min-h-[38px] rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-mono-num text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>

                  <JalaliDateInput
                    idPrefix={`${idPrefix}-tr-date-${tr.id}`}
                    label={`تاریخ / سررسید (${tr.date ? formatJalaliDate(tr.date) : formatJalaliDate(baseDate)})`}
                    value={tr.date || baseDate}
                    onChange={(iso) => updateTranche(tr.id, { date: iso })}
                  />
                </div>
              </div>
            ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};
