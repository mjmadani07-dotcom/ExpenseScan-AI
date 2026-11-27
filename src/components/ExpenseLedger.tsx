import { useWorkspaceBusy } from './WorkspaceActivity';
import { isAndroidRuntime,nativeExportAttachment } from '../storage/androidSnapshotStore';
import { AttachmentViewer } from './AttachmentViewer';
import { businessDateIso } from '../utils/jalali';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  ArrowUpDown,
  Check,
  CheckCircle2,
  Download,
  Edit3,
  FileJson,
  FileText,
  Filter,
  Search,
  Split,
  Trash2,
  User,
  X,
} from 'lucide-react';
import type {
  CategoryBudget,
  CategoryDefinition,
  CostCenter,
  Currency,
  DisplayUnit,
  DocumentType,
  ExchangeRates,
  ExpenseCategory,
  ExpenseFields,
  ExpenseFilters,
  ExpenseRecord,
  ExpenseSortBy,
  JsonImportMode,
  JsonImportStats,
  PaymentMethod,
  PaymentStatus,
  PaymentTranche,
  TimeframeFilter,
} from '../types/expense';
import {
  COST_CENTER_LABELS,
  CURRENCY_LABELS,
  DEFAULT_EXPENSE_FILTERS,
  DOCUMENT_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  SORT_BY_LABELS,
  computePurchaserBreakdown,
  convertRialTomanValues,
  countSeedExpenses,
  derivePaymentStatusFromTranches,
  filterExpenses,
  formatCompactCurrency,
  formatDisplayAmount,
  toEntryAmount,
  fromEntryAmount,
  getCategoryLabel,
  getUniquePurchasers,
  normalizePurchaserName,
  normalizeToToman,
  resolveCategories,
  summarizeExpensePayments,
} from '../utils/finance';
import { formatJalaliDate, formatJalaliLong, toPersianDigits } from '../utils/jalali';
import { ExpenseEditForm } from './ExpenseEditForm';
import { JalaliDateInput } from './JalaliDateInput';
import { JsonSyncPanel } from './JsonSyncPanel';
import { PaymentTranchesEditor } from './PaymentTranchesEditor';

interface ExpenseLedgerProps {
  expenses: ExpenseRecord[];
  categories?: CategoryDefinition[];
  budgets: CategoryBudget[];
  rates: ExchangeRates;
  displayUnit: DisplayUnit;
  onChangeDisplayUnit: (unit: DisplayUnit) => void;
  initialCategory?: ExpenseCategory | 'all';
  initialPurchaser?: string;
  selectedExpense: ExpenseRecord | null;
  onSelectExpense: (expense: ExpenseRecord | null) => void;
  onTogglePaid: (expense: ExpenseRecord) => Promise<void>;
  onUpdateExpense: (id: string, patch: Partial<ExpenseFields>) => Promise<void>;
  onDeleteExpense: (id: string) => Promise<void>;
  onImportJson: (data: unknown, mode: JsonImportMode) => Promise<JsonImportStats>;
  onClearSamples: () => Promise<number>;
}

const TIMEFRAME_FILTER_LABELS: Record<TimeframeFilter, string> = {
  all: 'همه زمان‌ها',
  '1m': '۱ ماه اخیر',
  '3m': '۳ ماه اخیر',
  '6m': '۶ ماه اخیر',
  '12m': '۱۲ ماه اخیر',
};

export const ExpenseLedger: React.FC<ExpenseLedgerProps> = ({
  expenses,
  categories,
  budgets,
  rates,
  displayUnit,
  onChangeDisplayUnit,
  initialCategory = 'all',
  initialPurchaser = 'all',
  selectedExpense,
  onSelectExpense,
  onTogglePaid,
  onUpdateExpense,
  onDeleteExpense,
  onImportJson,
  onClearSamples,
}) => {
  const activeCategories = useMemo(() => resolveCategories(categories), [categories]);
  const [filters, setFilters] = useState<ExpenseFilters>({
    ...DEFAULT_EXPENSE_FILTERS,
    category: initialCategory,
    purchaser: initialPurchaser,
  });
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [showJsonModal, setShowJsonModal] = useState(false);
  const [confirmClearSamples, setConfirmClearSamples] = useState(false);
  const [isClearingSamples, setIsClearingSamples] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmRemovePreview, setConfirmRemovePreview] = useState(false);
  const [viewOriginal,setViewOriginal]=useState<string|null>(null);
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [isExportingPdf,setIsExportingPdf]=useState(false);
  const [pdfNotice,setPdfNotice]=useState('');
  const [isMutating, setIsMutating] = useState(false);
  useWorkspaceBusy(isMutating||isExportingPdf||isExportingExcel||isClearingSamples);
  const [rateDraft, setRateDraft] = useState<number>(0);
  const [isEditingTranches, setIsEditingTranches] = useState(false);
  const [isEditingFull, setIsEditingFull] = useState(false);
  const [tranchesDraft, setTranchesDraft] = useState<PaymentTranche[]>([]);
  const [trancheError, setTrancheError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const runMutation = async (action: () => Promise<void>) => {
    setMutationError(null); setIsMutating(true);
    try { await action(); return true; } catch (err) { setMutationError(err instanceof Error ? err.message : 'خطا در ذخیره اطلاعات'); return false; } finally { setIsMutating(false); }
  };

  const seedCount = useMemo(() => countSeedExpenses(expenses), [expenses]);

  useEffect(() => {
    setFilters((prev) => ({
      ...prev,
      category: initialCategory,
      purchaser: initialPurchaser,
    }));
  }, [initialCategory, initialPurchaser]);

  useEffect(() => {
    if (selectedExpense && (selectedExpense.currency === 'USD' || selectedExpense.currency === 'EUR')) {
      setRateDraft(selectedExpense.exchangeRateToToman ?? rates[selectedExpense.currency]);
    } else {
      setRateDraft(0);
    }
    setIsEditingTranches(false);
    setIsEditingFull(false);
    setConfirmDeleteId(null);
    setConfirmRemovePreview(false);
    setViewOriginal(null);
    setTrancheError(null);
    setTranchesDraft(selectedExpense?.paymentTranches ?? []);
  }, [selectedExpense?.id, rates]);

  const advancedFilterCount = useMemo(() => {
    let count = 0;
    if (filters.documentType !== 'all') count += 1;
    if (filters.paymentMethod !== 'all') count += 1;
    if (filters.currency !== 'all') count += 1;
    if (filters.timeframe !== 'all') count += 1;
    if (filters.dateFrom) count += 1;
    if (filters.dateTo) count += 1;
    return count;
  }, [filters]);

  const hasAnyActiveFilter = useMemo(
    () =>
      Boolean(filters.query.trim()) ||
      filters.category !== 'all' ||
      filters.costCenter !== 'all' ||
      filters.paymentStatus !== 'all' ||
      filters.purchaser !== 'all' ||
      advancedFilterCount > 0,
    [filters, advancedFilterCount]
  );

  const uniquePurchasers = useMemo(() => getUniquePurchasers(expenses), [expenses]);

  const expensesWithoutPurchaserFilter = useMemo(
    () => filterExpenses(expenses, { ...filters, purchaser: 'all' }, new Date(), rates),
    [expenses, filters, rates]
  );

  const purchaserBreakdown = useMemo(
    () => computePurchaserBreakdown(expensesWithoutPurchaserFilter, rates),
    [expensesWithoutPurchaserFilter, rates]
  );

  const filtered = useMemo(
    () => filterExpenses(expenses, filters, new Date(), rates),
    [expenses, filters, rates]
  );

  const PAGE_SIZE=30;
  const [page,setPage]=useState(0);
  useEffect(()=>setPage(0),[filters]);
  const pageCount=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));
  const currentPage=Math.min(page,pageCount-1);
  const visibleExpenses=filtered.slice(currentPage*PAGE_SIZE,(currentPage+1)*PAGE_SIZE);
  const filteredTotalIRT = useMemo(
    () =>
      filtered.reduce(
        (sum, e) => sum + normalizeToToman(e.amount, e.currency, rates, e.exchangeRateToToman),
        0
      ),
    [filtered, rates]
  );

  const handleResetFilters = () => {
    setFilters({ ...DEFAULT_EXPENSE_FILTERS });
  };

  const handleExportPdf=async()=>{
    setIsExportingPdf(true);setPdfNotice('');setMutationError(null);
    try{const {downloadExpensePdf}=await import('../utils/pdfReport');setPdfNotice(await downloadExpensePdf(filtered,rates,displayUnit,activeCategories,'گزارش دفتر هزینه‌ها','تمام اسناد مطابق فیلترهای جاری دفتر (نه فقط صفحه فعلی)')??'');}
    catch(err){setMutationError(err instanceof Error?err.message:'خطا در ذخیره PDF');}
    finally{setIsExportingPdf(false);}
  };
  const handleExportExcel = async () => {
    setIsExportingExcel(true);
    try {
      const { downloadExpensesExcel } = await import('../utils/excelExport');
      const jalaliSlug = formatJalaliDate(businessDateIso()).replace(/\//g, '-');
      await downloadExpensesExcel(
        filtered,
        budgets,
        rates,
        displayUnit,
        `hesabyar-expenses-${jalaliSlug}.xlsx`,
        activeCategories
      );
    } catch(err) {setMutationError(err instanceof Error?err.message:'خطا در ذخیره Excel');} finally {
      setIsExportingExcel(false);
    }
  };

  const handleConvertSelectedRialToman = async (exp: ExpenseRecord) => {
    if (exp.currency !== 'IRR' && exp.currency !== 'IRT') return;
    const toCurrency = exp.currency === 'IRR' ? 'IRT' : 'IRR';
    const converted = convertRialTomanValues({
      amount: exp.amount,
      taxAmount: exp.taxAmount,
      discountAmount: exp.discountAmount,
      lineItems: exp.lineItems,
      paymentTranches: exp.paymentTranches,
      fromCurrency: exp.currency,
      toCurrency,
    });
    if (!await runMutation(() => onUpdateExpense(exp.id, converted))) return;
  };

  const handleToggleTrancheStatus = async (exp: ExpenseRecord, trancheId: string) => {
    const current = exp.paymentTranches ?? [];
    const nextTranches = current.map((t) =>
      t.id === trancheId
        ? { ...t, status: t.status === 'paid' ? ('pending' as const) : ('paid' as const) }
        : t
    );
    const nextStatus = derivePaymentStatusFromTranches(
      exp.amount,
      nextTranches,
      exp.paymentStatus
    );
    if (!await runMutation(() => onUpdateExpense(exp.id, {
      paymentTranches: nextTranches,
      paymentStatus: nextStatus,
    }))) return;
  };

  const handleSaveTranchesEdit = async (exp: ExpenseRecord) => {
    setTrancheError(null);
    const totalSum = tranchesDraft.reduce((s, t) => s + (t.amount || 0), 0);
    if (totalSum > exp.amount + 0.01) {
      setTrancheError('جمع بخش‌های پرداخت نمی‌تواند از مبلغ کل سند بیشتر باشد.');
      return;
    }
    const nextTranches = tranchesDraft.length > 0 ? tranchesDraft : undefined;
    const nextStatus = derivePaymentStatusFromTranches(
      exp.amount,
      nextTranches,
      exp.paymentStatus === 'partial' ? 'pending' : exp.paymentStatus
    );
    const unpaidTranche = nextTranches?.find((t) => t.status !== 'paid');
    if (!await runMutation(() => onUpdateExpense(exp.id, {
      paymentTranches: nextTranches,
      paymentStatus: nextStatus,
      ...(unpaidTranche ? { paymentMethod: unpaidTranche.method, dueDate: unpaidTranche.date ?? exp.dueDate } : {}),
    }))) return;
    setIsEditingTranches(false);
  };

  const selectedSummary = selectedExpense
    ? summarizeExpensePayments(selectedExpense, rates)
    : null;

  return (
    <div className="space-y-5">
      {pdfNotice&&<p role="status" className="rounded-xl bg-teal-50 p-3 text-sm text-teal-800">{pdfNotice}</p>}
      {mutationError && <div role="alert" className="fixed bottom-24 left-4 right-4 z-[100] rounded-xl bg-red-100 border border-red-300 p-3 text-sm text-red-900 shadow-lg">{mutationError}<button type="button" className="mr-3 underline" onClick={() => setMutationError(null)}>بستن</button></div>}
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
            دفتر کل هزینه‌ها و فاکتورها
          </h1>
          <p className="mt-1 text-sm text-slate-600 tabular-nums">
            {filters.purchaser !== 'all' && (
              <>
                <span className="font-semibold text-teal-800">
                  مسئول خرید:{' '}
                  {filters.purchaser === '__unassigned__'
                    ? 'بدون مسئول ثبت‌شده'
                    : filters.purchaser}
                </span>{' '}
                ·{' '}
              </>
            )}
            {toPersianDigits(filtered.length)} سند یافت شد · مجموع:{' '}
            {formatCompactCurrency(filteredTotalIRT, displayUnit)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <div
            className="inline-flex items-center p-1 bg-slate-100 rounded-xl border border-slate-200/80"
            role="group"
            aria-label="واحد نمایش دفتر کل"
          >
            <button
              type="button"
              onClick={() => onChangeDisplayUnit('IRT')}
              className={`min-h-[34px] px-3 py-1 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
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
              className={`min-h-[34px] px-3 py-1 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                displayUnit === 'IRR'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              ریال
            </button>
          </div>

          <button
            type="button"
            onClick={() => setShowJsonModal(true)}
            className="inline-flex items-center justify-center gap-2 min-h-[42px] px-4 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-800 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <FileJson className="w-4 h-4 text-teal-700" />
            <span>خروجی / ورود JSON</span>
          </button>

          <button
            type="button"
            onClick={handleExportExcel}
            disabled={filtered.length === 0 || isExportingExcel}
            className="inline-flex items-center justify-center gap-2 min-h-[42px] px-4 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-4 h-4 text-teal-700" />
            <span>{isExportingExcel ? 'در حال ساخت اکسل...' : 'خروجی اکسل (.xlsx)'}</span>
          </button>
          {isAndroidRuntime()&&<button type="button" onClick={()=>void handleExportPdf()} disabled={!filtered.length||isExportingPdf||isExportingExcel} className="min-h-11 px-4 rounded-xl border border-slate-200 bg-white text-xs font-semibold disabled:opacity-40">{isExportingPdf?'در حال ساخت PDF…':'خروجی گزارش PDF'}</button>}
        </div>
      </div>

      {/* Sample Data Cleanup Banner */}
      {seedCount > 0 && (
        <div className="rounded-2xl bg-amber-50/80 border border-amber-200 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="text-xs text-amber-950 leading-relaxed">
            <strong>{toPersianDigits(seedCount)} سند نمونه</strong> برای آشنایی با امکانات برنامه ثبت شده است. پس از بررسی می‌توانید مثال‌ها را پاک کنید و کار واقعی را شروع نمایید.
          </div>
          {confirmClearSamples ? (
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={isClearingSamples}
                onClick={async () => {
                  setIsClearingSamples(true);
                  try {
                    await onClearSamples();
                    setConfirmClearSamples(false);
                  } catch (err) { setMutationError(err instanceof Error ? err.message : 'خطا در پاکسازی'); } finally {
                    setIsClearingSamples(false);
                  }
                }}
                className="min-h-[36px] px-3.5 py-1.5 rounded-xl bg-red-600 text-white text-xs font-semibold hover:bg-red-700 disabled:opacity-50 cursor-pointer"
              >
                {isClearingSamples ? 'در حال پاکسازی...' : 'تایید حذف مثال‌ها'}
              </button>
              <button
                type="button"
                disabled={isClearingSamples}
                onClick={() => setConfirmClearSamples(false)}
                className="min-h-[36px] px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                انصراف
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmClearSamples(true)}
              className="inline-flex items-center justify-center gap-1.5 min-h-[36px] px-3.5 py-1.5 rounded-xl bg-white border border-amber-300 text-xs font-semibold text-amber-900 hover:bg-amber-100 shrink-0 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5 text-amber-700" />
              <span>پاکسازی مثال‌ها</span>
            </button>
          )}
        </div>
      )}

      {/* Filters & Sort Toolbar */}
      <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <div className="relative sm:col-span-2 lg:col-span-2">
            <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              aria-label="جستجو در هزینه‌ها"
              value={filters.query}
              onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
              placeholder="جستجو بر اساس عنوان، فروشنده، مسئول خرید، فاکتور یا چک..."
              className="w-full min-h-[42px] rounded-xl border border-slate-200 bg-slate-50/60 pr-10 pl-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:bg-white"
            />
          </div>

          <select
            aria-label="فیلتر مسئول خرید"
            value={filters.purchaser}
            onChange={(e) => setFilters((f) => ({ ...f, purchaser: e.target.value }))}
            className="min-h-[42px] rounded-xl border border-slate-200 bg-white px-3 text-xs sm:text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-600"
          >
            <option value="all">همه مسئولان خرید</option>
            {uniquePurchasers.map((person) => (
              <option key={person} value={person}>
                {person}
              </option>
            ))}
            <option value="__unassigned__">بدون مسئول ثبت‌شده</option>
          </select>

          <select
            aria-label="فیلتر حوزه هزینه"
            value={filters.category}
            onChange={(e) =>
              setFilters((f) => ({ ...f, category: e.target.value as ExpenseCategory | 'all' }))
            }
            className="min-h-[42px] rounded-xl border border-slate-200 bg-white px-3 text-xs sm:text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-600"
          >
            <option value="all">همه حوزه‌های هزینه</option>
            {activeCategories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.label}
              </option>
            ))}
          </select>

          <select
            aria-label="فیلتر مرکز هزینه"
            value={filters.costCenter}
            onChange={(e) =>
              setFilters((f) => ({ ...f, costCenter: e.target.value as CostCenter | 'all' }))
            }
            className="min-h-[42px] rounded-xl border border-slate-200 bg-white px-3 text-xs sm:text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-600"
          >
            <option value="all">همه دپارتمان‌ها</option>
            {(Object.keys(COST_CENTER_LABELS) as CostCenter[]).map((cc) => (
              <option key={cc} value={cc}>
                {COST_CENTER_LABELS[cc]}
              </option>
            ))}
          </select>

          <select
            aria-label="فیلتر وضعیت پرداخت"
            value={filters.paymentStatus}
            onChange={(e) =>
              setFilters((f) => ({
                ...f,
                paymentStatus: e.target.value as PaymentStatus | 'all',
              }))
            }
            className="min-h-[42px] rounded-xl border border-slate-200 bg-white px-3 text-xs sm:text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-600"
          >
            <option value="all">همه وضعیت‌ها</option>
            {(Object.keys(PAYMENT_STATUS_LABELS) as PaymentStatus[]).map((st) => (
              <option key={st} value={st}>
                {PAYMENT_STATUS_LABELS[st]}
              </option>
            ))}
          </select>
        </div>

        {/* Advanced Filters Toggle Strip + Always-Visible Sort */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowAdvancedFilters((v) => !v)}
              className={`inline-flex items-center gap-1.5 min-h-[36px] px-3 py-1.5 rounded-xl border text-xs font-semibold transition-colors cursor-pointer ${
                showAdvancedFilters || advancedFilterCount > 0
                  ? 'border-teal-300 bg-teal-50/70 text-teal-800'
                  : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Filter className="w-3.5 h-3.5" />
              <span>
                فیلترهای پیشرفته
                {advancedFilterCount > 0 ? ` (${toPersianDigits(advancedFilterCount)})` : ''}
              </span>
            </button>

            {hasAnyActiveFilter && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="min-h-[34px] px-3 py-1 rounded-lg text-xs font-semibold text-red-600 hover:bg-red-50 cursor-pointer"
              >
                پاک کردن همه فیلترها
              </button>
            )}
          </div>

          <div className="relative">
            <ArrowUpDown className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <select
              aria-label="مرتب‌سازی هزینه‌ها"
              value={filters.sortBy}
              onChange={(e) =>
                setFilters((f) => ({ ...f, sortBy: e.target.value as ExpenseSortBy }))
              }
              className="min-h-[38px] rounded-xl border border-slate-200 bg-white pr-8 pl-3 text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-600"
            >
              {(Object.keys(SORT_BY_LABELS) as ExpenseSortBy[]).map((sb) => (
                <option key={sb} value={sb}>
                  مرتب‌سازی: {SORT_BY_LABELS[sb]}
                </option>
              ))}
            </select>
          </div>
        </div>

        {showAdvancedFilters && (
          <div className="pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label htmlFor="filter-timeframe" className="block text-[11px] font-semibold text-slate-600 mb-1">
                بازه زمانی
              </label>
              <select
                id="filter-timeframe"
                value={filters.timeframe}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, timeframe: e.target.value as TimeframeFilter }))
                }
                className="w-full min-h-[40px] rounded-xl border border-slate-200 bg-white px-3 text-xs sm:text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-600"
              >
                {(Object.keys(TIMEFRAME_FILTER_LABELS) as TimeframeFilter[]).map((tf) => (
                  <option key={tf} value={tf}>
                    {TIMEFRAME_FILTER_LABELS[tf]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="filter-doctype" className="block text-[11px] font-semibold text-slate-600 mb-1">
                نوع سند
              </label>
              <select
                id="filter-doctype"
                value={filters.documentType}
                onChange={(e) =>
                  setFilters((f) => ({
                    ...f,
                    documentType: e.target.value as DocumentType | 'all',
                  }))
                }
                className="w-full min-h-[40px] rounded-xl border border-slate-200 bg-white px-3 text-xs sm:text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-600"
              >
                <option value="all">همه انواع سند</option>
                {(Object.keys(DOCUMENT_TYPE_LABELS) as DocumentType[]).map((dt) => (
                  <option key={dt} value={dt}>
                    {DOCUMENT_TYPE_LABELS[dt]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="filter-paymethod" className="block text-[11px] font-semibold text-slate-600 mb-1">
                روش پرداخت (یا چک/بخش‌ها)
              </label>
              <select
                id="filter-paymethod"
                value={filters.paymentMethod}
                onChange={(e) =>
                  setFilters((f) => ({
                    ...f,
                    paymentMethod: e.target.value as PaymentMethod | 'all',
                  }))
                }
                className="w-full min-h-[40px] rounded-xl border border-slate-200 bg-white px-3 text-xs sm:text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-600"
              >
                <option value="all">همه روش‌های پرداخت</option>
                {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((pm) => (
                  <option key={pm} value={pm}>
                    {PAYMENT_METHOD_LABELS[pm]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="filter-currency" className="block text-[11px] font-semibold text-slate-600 mb-1">
                واحد پول سند
              </label>
              <select
                id="filter-currency"
                value={filters.currency}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, currency: e.target.value as Currency | 'all' }))
                }
                className="w-full min-h-[40px] rounded-xl border border-slate-200 bg-white px-3 text-xs sm:text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-600"
              >
                <option value="all">همه ارزها</option>
                {(Object.keys(CURRENCY_LABELS) as Currency[]).map((c) => (
                  <option key={c} value={c}>
                    {CURRENCY_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-2">
              {filters.dateFrom ? (
                <JalaliDateInput
                  idPrefix="filter-date-from"
                  label={`از تاریخ شمسی (${formatJalaliDate(filters.dateFrom)})`}
                  value={filters.dateFrom}
                  onChange={(iso) => setFilters((f) => ({ ...f, dateFrom: iso }))}
                  allowClear
                  onClear={() => setFilters((f) => ({ ...f, dateFrom: undefined }))}
                />
              ) : (
                <div>
                  <span className="block text-[11px] font-semibold text-slate-600 mb-1">
                    از تاریخ (شمسی)
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setFilters((f) => ({ ...f, dateFrom: businessDateIso() }))
                    }
                    className="w-full min-h-[42px] rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 text-xs font-medium text-slate-600 hover:border-teal-500 hover:text-teal-800 cursor-pointer"
                  >
                    انتخاب تاریخ شروع (شمسی)
                  </button>
                </div>
              )}
            </div>

            <div className="sm:col-span-2">
              {filters.dateTo ? (
                <JalaliDateInput
                  idPrefix="filter-date-to"
                  label={`تا تاریخ شمسی (${formatJalaliDate(filters.dateTo)})`}
                  value={filters.dateTo}
                  onChange={(iso) => setFilters((f) => ({ ...f, dateTo: iso }))}
                  allowClear
                  onClear={() => setFilters((f) => ({ ...f, dateTo: undefined }))}
                />
              ) : (
                <div>
                  <span className="block text-[11px] font-semibold text-slate-600 mb-1">
                    تا تاریخ (شمسی)
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setFilters((f) => ({ ...f, dateTo: businessDateIso() }))
                    }
                    className="w-full min-h-[42px] rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 text-xs font-medium text-slate-600 hover:border-teal-500 hover:text-teal-800 cursor-pointer"
                  >
                    انتخاب تاریخ پایان (شمسی)
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Per-Purchaser Spending Summary Strip */}
      {purchaserBreakdown.some((p) => !p.isUnassigned) && (
        <section
          aria-label="گزارش جمع هزینه هر مسئول خرید"
          className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <User className="w-4 h-4 text-teal-700 shrink-0" />
              <h2 className="text-xs sm:text-sm font-bold text-slate-900">
                مجموع هزینه به تفکیک مسئول خرید
              </h2>
              <span className="text-[11px] text-slate-500">
                (برای فیلتر کردن اسناد روی نام هر فرد کلیک کنید)
              </span>
            </div>
            {filters.purchaser !== 'all' && (
              <button
                type="button"
                onClick={() => setFilters((f) => ({ ...f, purchaser: 'all' }))}
                className="text-xs font-semibold text-teal-700 hover:text-teal-900 cursor-pointer"
              >
                نمایش همه افراد
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            {purchaserBreakdown.map((person) => {
              const isSelected = filters.purchaser === person.purchaserKey;
              return (
                <button
                  key={person.purchaserKey}
                  type="button"
                  onClick={() =>
                    setFilters((f) => ({
                      ...f,
                      purchaser: isSelected ? 'all' : person.purchaserKey,
                    }))
                  }
                  className={`text-right rounded-xl border p-3 transition-colors cursor-pointer ${
                    isSelected
                      ? 'border-teal-600 bg-teal-50/70'
                      : 'border-slate-200 bg-slate-50/50 hover:bg-slate-50 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-900 truncate">
                      {person.label}
                    </span>
                    <span className="text-[11px] font-medium text-slate-500 tabular-nums shrink-0">
                      {toPersianDigits(person.count)} سند
                    </span>
                  </div>
                  <div className="mt-1.5 text-sm font-bold text-slate-900 tabular-nums">
                    {formatCompactCurrency(person.totalIRT, displayUnit)}
                  </div>
                  {person.personalOutOfPocketIRT > 0 && (
                    <div className="mt-1 text-[11px] font-medium text-teal-700 tabular-nums">
                      از کارت/جیب شخصی:{' '}
                      {formatCompactCurrency(person.personalOutOfPocketIRT, displayUnit)}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Expense List / Table */}
      <div className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="py-12 px-4 text-center">
            <FileText className="w-8 h-8 text-slate-400 mx-auto mb-2" />
            {expenses.length === 0 ? (
              <>
                <div className="text-sm font-semibold text-slate-800">
                  دفتر هزینه‌ها خالی است
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  از بخش «ثبت سند» اولین فاکتور، رسید یا هزینه واقعی شرکت را اضافه کنید.
                </p>
              </>
            ) : (
              <>
                <div className="text-sm font-semibold text-slate-800">
                  هیچ سندی با فیلترهای انتخابی پیدا نشد
                </div>
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="mt-3 min-h-[38px] px-4 py-1.5 rounded-xl bg-slate-100 text-xs font-semibold text-slate-700 hover:bg-slate-200 cursor-pointer"
                >
                  پاک کردن فیلترها
                </button>
              </>
            )}
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-right border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-4">تاریخ (شمسی)</th>
                    <th className="py-3 px-4">شرح و طرف حساب</th>
                    <th className="py-3 px-4">حوزه / دپارتمان</th>
                    <th className="py-3 px-4">سند / روش</th>
                    <th className="py-3 px-4">وضعیت</th>
                    <th className="py-3 px-4 text-left">مبلغ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {visibleExpenses.map((exp) => {
                    const paySummary = summarizeExpensePayments(exp, rates);

                    const trancheCount = exp.paymentTranches?.length ?? 0;
                    return (
                      <tr
                        key={exp.id}
                        onClick={() => onSelectExpense(exp)}
                        className="hover:bg-slate-50/80 transition-colors cursor-pointer"
                      >
                        <td className="py-3.5 px-4 text-xs text-slate-600 tabular-nums whitespace-nowrap">
                          {formatJalaliDate(exp.date)}
                        </td>
                        <td className="py-3.5 px-4 max-w-[280px]">
                          <div className="font-semibold text-slate-900 truncate">
                            {exp.title}
                          </div>
                          <div className="text-xs text-slate-500 truncate mt-0.5">
                            {exp.vendor}
                            {normalizePurchaserName(exp.purchaser)
                              ? ` · مسئول: ${normalizePurchaserName(exp.purchaser)}`
                              : ''}
                            {exp.invoiceNumber ? ` · شماره ${exp.invoiceNumber}` : ''}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-xs text-slate-600 whitespace-nowrap">
                          <div>{getCategoryLabel(exp.category, activeCategories)}</div>
                          <div className="text-slate-400 mt-0.5">
                            {COST_CENTER_LABELS[exp.costCenter]}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-xs text-slate-600 whitespace-nowrap">
                          <div>{DOCUMENT_TYPE_LABELS[exp.documentType]}</div>
                          <div className="text-slate-400 mt-0.5">
                            {trancheCount > 1
                              ? `ترکیبی (${toPersianDigits(trancheCount)} بخش)`
                              : PAYMENT_METHOD_LABELS[exp.paymentMethod]}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-xs font-semibold whitespace-nowrap">
                          <div
                            className={
                              exp.paymentStatus === 'paid'
                                ? 'text-emerald-700'
                                : exp.paymentStatus === 'partial'
                                  ? 'text-sky-700'
                                  : exp.paymentStatus === 'overdue'
                                    ? 'text-red-600'
                                    : 'text-amber-700'
                            }
                          >
                            {PAYMENT_STATUS_LABELS[exp.paymentStatus]}
                          </div>
                          {exp.paymentStatus === 'partial' && paySummary.remainingIRT > 0 && (
                            <div className="text-[11px] font-normal text-slate-500 mt-0.5 tabular-nums">
                              مانده: {formatCompactCurrency(paySummary.remainingIRT, displayUnit)}
                            </div>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-left whitespace-nowrap">
                          <div className="font-bold text-slate-900 tabular-nums">
                            {formatDisplayAmount(exp.amount, exp.currency, rates, displayUnit, exp.exchangeRateToToman)}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Tap Rows */}
            <div className="md:hidden divide-y divide-slate-100">
              {visibleExpenses.map((exp) => {
                const paySummary = summarizeExpensePayments(exp, rates);

                return (
                  <button
                    key={exp.id}
                    type="button"
                    onClick={() => onSelectExpense(exp)}
                    className="w-full p-4 text-right flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors cursor-pointer"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-slate-900 truncate">
                        {exp.title}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-500">
                        <span>{exp.vendor}</span>
                        {normalizePurchaserName(exp.purchaser) && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-medium text-slate-700">
                              {normalizePurchaserName(exp.purchaser)}
                            </span>
                          </>
                        )}
                        <span aria-hidden="true">·</span>
                        <span>{formatJalaliDate(exp.date)}</span>
                        <span aria-hidden="true">·</span>
                        <span>{getCategoryLabel(exp.category, activeCategories)}</span>
                      </div>
                    </div>
                    <div className="text-left shrink-0">
                      <div className="text-sm font-bold text-slate-900 tabular-nums">
                        {formatDisplayAmount(exp.amount, exp.currency, rates, displayUnit, exp.exchangeRateToToman)}
                      </div>
                      <div
                        className={`mt-0.5 text-[11px] font-semibold ${
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
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {filtered.length>PAGE_SIZE&&<div className="flex items-center justify-between gap-2 rounded-xl border bg-white p-3 text-xs"><button type="button" disabled={currentPage===0} onClick={()=>setPage(currentPage-1)} className="min-h-11 px-3 border rounded-lg disabled:opacity-40">قبلی</button><span>صفحه {toPersianDigits(currentPage+1)} از {toPersianDigits(pageCount)} · {toPersianDigits(filtered.length)} سند</span><button type="button" disabled={currentPage>=pageCount-1} onClick={()=>setPage(currentPage+1)} className="min-h-11 px-3 border rounded-lg disabled:opacity-40">بعدی</button></div>}
      {/* JSON Export/Import Modal */}
      {showJsonModal && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-sm p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="خروجی و ورود JSON"
        >
          <div className="w-full sm:max-w-xl max-h-[90vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl bg-white border border-slate-200 shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-bold text-slate-900">
                مدیریت فایل JSON دفتر هزینه‌ها
              </h2>
              <button
                type="button"
                aria-label="بستن پنجره JSON"
                onClick={() => setShowJsonModal(false)}
                className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <JsonSyncPanel
              expenses={expenses}
              categories={activeCategories}
              budgets={budgets}
              rates={rates}
              onImportJson={onImportJson}
            />
          </div>
        </div>
      )}

      {/* Expense Detail / Full Edit Modal */}
      {selectedExpense && selectedSummary && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-sm p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="expense-detail-title"
        >
          <div className="w-full sm:max-w-2xl max-h-[90vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl bg-white border border-slate-200 shadow-2xl p-6 space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="expense-detail-title" className="text-lg font-bold text-slate-900">
                  {isEditingFull ? 'ویرایش کامل فاکتور و سند' : selectedExpense.title}
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  {selectedExpense.vendor} · {formatJalaliLong(selectedExpense.date)}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {!isEditingFull && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditingFull(true);
                      setIsEditingTranches(false);
                    }}
                    className="inline-flex items-center gap-1.5 min-h-[38px] px-3 py-1.5 rounded-xl bg-teal-50 border border-teal-200 text-xs font-semibold text-teal-800 hover:bg-teal-100 cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>ویرایش کامل فاکتور</span>
                  </button>
                )}
                <button
                  type="button"
                  aria-label="بستن جزئیات سند"
                  onClick={() => {
                    setConfirmDeleteId(null);
                    setConfirmRemovePreview(false);
                    setIsEditingTranches(false);
                    setIsEditingFull(false);
                    onSelectExpense(null);
                  }}
                  className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {isEditingFull ? (
              <ExpenseEditForm
                expense={selectedExpense}
                displayUnit={displayUnit}
                categories={activeCategories}
                rates={rates}
                purchaserSuggestions={uniquePurchasers}
                isSaving={isMutating}
                onCancel={() => setIsEditingFull(false)}
                onSave={async (patch) => {
                  if (!await runMutation(() => onUpdateExpense(selectedExpense.id, patch))) return;
                  setIsEditingFull(false);
                }}
              />
            ) : (
              <>
                <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-3">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-xs text-slate-500">مبلغ کل سند</div>
                      <div className="mt-1 text-xl font-bold text-slate-900 tabular-nums">
                        {formatDisplayAmount(selectedExpense.amount, selectedExpense.currency, rates, displayUnit, selectedExpense.exchangeRateToToman)}
                      </div>
                    </div>
                    <div className="text-left">
                      <div className="text-xs text-slate-500">وضعیت تسویه</div>
                      <div
                        className={`mt-1 text-sm font-bold ${
                          selectedExpense.paymentStatus === 'paid'
                            ? 'text-emerald-700'
                            : selectedExpense.paymentStatus === 'partial'
                              ? 'text-sky-700'
                              : selectedExpense.paymentStatus === 'overdue'
                                ? 'text-red-600'
                                : 'text-amber-700'
                        }`}
                      >
                        {PAYMENT_STATUS_LABELS[selectedExpense.paymentStatus]}
                      </div>
                    </div>
                  </div>

                  {selectedSummary.hasSchedule && (
                    <div className="pt-2 border-t border-slate-200/80 space-y-1.5">
                      <div className="flex items-center justify-between text-xs tabular-nums">
                        <span className="text-emerald-700 font-semibold">
                          پرداخت‌شده: {formatDisplayAmount(selectedSummary.paidInDocCurrency, selectedExpense.currency, rates, displayUnit, selectedExpense.exchangeRateToToman)} ({toPersianDigits(selectedSummary.paidPercent)}٪)
                        </span>
                        <span className="text-amber-700 font-semibold">
                          مانده: {formatDisplayAmount(selectedSummary.remainingInDocCurrency, selectedExpense.currency, rates, displayUnit, selectedExpense.exchangeRateToToman)}
                        </span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-slate-200 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-teal-600 transition-all duration-300"
                          style={{ width: `${selectedSummary.paidPercent}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {(selectedExpense.currency === 'IRR' || selectedExpense.currency === 'IRT') && (
                    <div className="pt-2 border-t border-slate-200/80 flex items-center justify-between gap-2">
                      <span className="text-[11px] text-slate-500">
                        واحد ذخیره شده: {selectedExpense.currency === 'IRR' ? 'ریال' : 'تومان'}
                      </span>
                      <button
                        type="button"
                        disabled={isMutating}
                        onClick={() => handleConvertSelectedRialToman(selectedExpense)}
                        className="inline-flex items-center gap-1.5 min-h-[34px] px-3 py-1 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-teal-700 hover:bg-teal-50 disabled:opacity-50 cursor-pointer"
                      >
                        <ArrowLeftRight className="w-3.5 h-3.5" />
                        <span>
                          {selectedExpense.currency === 'IRR'
                            ? 'تبدیل سند به تومان (÷۱۰)'
                            : 'تبدیل سند به ریال (×۱۰)'}
                        </span>
                      </button>
                    </div>
                  )}

                  {(selectedExpense.currency === 'USD' || selectedExpense.currency === 'EUR') && (
                    <div className="pt-2 border-t border-slate-200/80 flex flex-wrap items-center justify-between gap-2">
                      <label
                        htmlFor="detail-historical-rate"
                        className="text-xs font-semibold text-slate-700"
                      >
                        نرخ تسعیر ثبت‌شده این سند ({CURRENCY_LABELS[displayUnit]}):
                      </label>
                      <div className="flex items-center gap-1.5">
                        <input
                          id="detail-historical-rate"
                          type="number"
                          min={1}
                          step={100}
                          value={toEntryAmount(rateDraft, 'IRT', displayUnit)}
                          onChange={(e) => setRateDraft(fromEntryAmount(Number(e.target.value) || 0, 'IRT', displayUnit))}
                          className="w-28 min-h-[36px] rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-mono-num text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                        />
                        <button
                          type="button"
                          disabled={isMutating || rateDraft <= 0}
                          onClick={async () => {
                            if (!await runMutation(() => onUpdateExpense(selectedExpense.id, {
                              exchangeRateToToman: rateDraft,
                            }))) return;
                          }}
                          className="inline-flex items-center gap-1 min-h-[36px] px-3 rounded-lg bg-teal-700 text-white text-xs font-semibold hover:bg-teal-800 disabled:opacity-40 cursor-pointer"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>ذخیره نرخ</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Split / Partial Payment Schedule Section */}
                <div className="rounded-xl border border-slate-200 p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-xs font-bold text-slate-800">
                      {selectedSummary.hasSchedule || isEditingTranches
                        ? 'بخش‌های پرداخت (پیش‌پرداخت / چک / اقساط)'
                        : 'نحوه تسویه سند'}
                    </h3>
                    {!isEditingTranches && (
                      <button
                        type="button"
                        onClick={() => {
                          setTranchesDraft(selectedExpense.paymentTranches ?? []);
                          setTrancheError(null);
                          setIsEditingTranches(true);
                        }}
                        className="inline-flex items-center gap-1.5 min-h-[34px] px-3 py-1 rounded-lg bg-slate-100 text-xs font-semibold text-slate-700 hover:bg-slate-200 cursor-pointer"
                      >
                        <Split className="w-3.5 h-3.5" />
                        <span>
                          {selectedSummary.hasSchedule
                            ? 'ویرایش یا افزودن بخش پرداخت'
                            : 'تغییر به پرداخت بخشی / چک'}
                        </span>
                      </button>
                    )}
                  </div>

                  {isEditingTranches ? (
                    <div className="space-y-3">
                      {trancheError && (
                        <div className="text-xs font-semibold text-red-600">{trancheError}</div>
                      )}
                      <PaymentTranchesEditor
                        idPrefix={`detail-${selectedExpense.id}`}
                        totalAmount={selectedExpense.amount}
                        currency={selectedExpense.currency}
                        displayUnit={displayUnit}
                        rates={rates}
                        documentExchangeRate={selectedExpense.exchangeRateToToman}
                        baseDate={selectedExpense.date}
                        paymentStatus={selectedExpense.paymentStatus}
                        tranches={tranchesDraft}
                        onChange={setTranchesDraft}
                      />
                      <div className="flex items-center justify-end gap-2 pt-2">
                        <button
                          type="button"
                          onClick={() => {
                            setIsEditingTranches(false);
                            setTrancheError(null);
                          }}
                          className="min-h-[36px] px-3.5 py-1.5 rounded-lg bg-slate-100 text-xs font-semibold text-slate-700 cursor-pointer"
                        >
                          انصراف از ویرایش
                        </button>
                        <button
                          type="button"
                          disabled={isMutating}
                          onClick={() => handleSaveTranchesEdit(selectedExpense)}
                          className="inline-flex items-center gap-1.5 min-h-[36px] px-4 py-1.5 rounded-lg bg-teal-700 text-white text-xs font-semibold hover:bg-teal-800 disabled:opacity-50 cursor-pointer"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>ذخیره برنامه پرداخت</span>
                        </button>
                      </div>
                    </div>
                  ) : selectedSummary.hasSchedule ? (
                    <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 overflow-hidden">
                      {(selectedExpense.paymentTranches ?? []).map((tr) => (
                        <div
                          key={tr.id}
                          className="p-3 bg-white flex flex-wrap items-center justify-between gap-2 text-xs"
                        >
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-900">{tr.title}</div>
                            <div className="text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-1.5">
                              <span>{PAYMENT_METHOD_LABELS[tr.method]}</span>
                              {tr.date && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="tabular-nums">{formatJalaliDate(tr.date)}</span>
                                </>
                              )}
                              {tr.referenceCode && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="font-mono-num">شماره {tr.referenceCode}</span>
                                </>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-3 shrink-0">
                            <div className="text-left">
                              <div className="font-bold text-slate-900 tabular-nums">
                                {formatDisplayAmount(tr.amount, selectedExpense.currency, rates, displayUnit, selectedExpense.exchangeRateToToman)}
                              </div>
                              <div
                                className={`text-[11px] font-semibold ${
                                  tr.status === 'paid'
                                    ? 'text-emerald-700'
                                    : tr.status === 'overdue'
                                      ? 'text-red-600'
                                      : 'text-amber-700'
                                }`}
                              >
                                {tr.status === 'paid' ? 'تسویه‌شده' : 'در انتظار پرداخت / وصول'}
                              </div>
                            </div>
                            <button
                              type="button"
                              disabled={isMutating}
                              onClick={() => handleToggleTrancheStatus(selectedExpense, tr.id)}
                              className={`min-h-[34px] px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors cursor-pointer ${
                                tr.status === 'paid'
                                  ? 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                                  : 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                              }`}
                            >
                              {tr.status === 'paid' ? 'بازگشت به در انتظار' : 'ثبت تسویه / پاس'}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">
                      {selectedExpense.paymentStatus === 'paid'
                        ? 'این سند به صورت یکجا و کامل تسویه شده است (بدون پیش‌پرداخت یا چک بعدی).'
                        : 'این سند به صورت یک‌مرحله‌ای ثبت شده است. در صورت پرداخت در چند مرحله می‌توانید آن را به بخش‌های مجزا تقسیم کنید.'}
                    </p>
                  )}
                </div>

                {selectedExpense.attachmentId && <div className="rounded-xl border p-3 space-y-2 text-xs"><p className="font-semibold">فایل اصلی رمزگذاری‌شده</p><p className="break-all">{selectedExpense.sourceFileName??'پیوست سند'}</p>{selectedExpense.attachmentMime&&<AttachmentViewer id={selectedExpense.attachmentId} mime={selectedExpense.attachmentMime} name={selectedExpense.sourceFileName} open={viewOriginal===selectedExpense.id} onToggle={()=>setViewOriginal(v=>v===selectedExpense.id?null:selectedExpense.id)}/>}{isAndroidRuntime()&&<button type="button" disabled={isMutating} className="border rounded-lg p-2" onClick={()=>{if(window.confirm('فایل اصلی بدون رمزگذاری در مسیر انتخابی ذخیره شود؟'))void runMutation(()=>nativeExportAttachment(selectedExpense.attachmentId!,selectedExpense.attachmentMime!));}}>ذخیره فایل اصلی خارج از برنامه</button>}<button type="button" disabled={isMutating} className="text-red-700 border rounded-lg p-2 mr-2" onClick={()=>{if(window.confirm('اتصال فایل اصلی به این سند حذف شود؟ نسخه‌های بازیابی ممکن است همچنان آن را داشته باشند.'))void runMutation(()=>onUpdateExpense(selectedExpense.id,{attachmentId:undefined,attachmentMime:undefined}));}}>قطع اتصال پیوست</button></div>}
                {selectedExpense.sourcePreviewUrl && (
                  <div className="rounded-xl border border-slate-200 overflow-hidden bg-slate-100 relative">
                    <img
                      src={selectedExpense.sourcePreviewUrl}
                      alt={selectedExpense.title}
                      className="max-h-56 w-full object-contain mx-auto"
                    />
                    {confirmRemovePreview ? (
                      <div className="absolute top-2 left-2 flex items-center gap-1.5 rounded-lg bg-white/95 border border-red-200 p-1.5 shadow-sm">
                        <button
                          type="button"
                          disabled={isMutating}
                          onClick={async () => {
                            if (!await runMutation(() => onUpdateExpense(selectedExpense.id, { sourcePreviewUrl: undefined }))) return;
                            setConfirmRemovePreview(false);
                          }}
                          className="min-h-[30px] px-2.5 py-1 rounded-md bg-red-600 text-white text-[11px] font-semibold hover:bg-red-700 cursor-pointer"
                        >
                          تایید حذف تصویر
                        </button>
                        <button
                          type="button"
                          disabled={isMutating}
                          onClick={() => setConfirmRemovePreview(false)}
                          className="min-h-[30px] px-2 py-1 rounded-md bg-slate-100 text-[11px] font-semibold text-slate-700 hover:bg-slate-200 cursor-pointer"
                        >
                          انصراف
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={isMutating}
                        onClick={() => setConfirmRemovePreview(true)}
                        className="absolute top-2 left-2 inline-flex items-center gap-1 min-h-[32px] px-2.5 py-1 rounded-lg bg-white/95 border border-red-200 text-[11px] font-semibold text-red-700 hover:bg-red-50 shadow-sm cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>حذف تصویر پیوست</span>
                      </button>
                    )}
                  </div>
                )}

                <dl className="grid grid-cols-2 gap-3 text-xs">
                  <div className="p-2.5 rounded-xl bg-slate-50">
                    <dt className="text-slate-500">حوزه هزینه</dt>
                    <dd className="mt-1 font-semibold text-slate-900">
                      {getCategoryLabel(selectedExpense.category, activeCategories)}
                    </dd>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-50">
                    <dt className="text-slate-500">مرکز هزینه</dt>
                    <dd className="mt-1 font-semibold text-slate-900">
                      {COST_CENTER_LABELS[selectedExpense.costCenter]}
                    </dd>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-50">
                    <dt className="text-slate-500">نوع سند و پرداخت</dt>
                    <dd className="mt-1 font-semibold text-slate-900">
                      {DOCUMENT_TYPE_LABELS[selectedExpense.documentType]} ·{' '}
                      {selectedSummary.hasSchedule
                        ? `پرداخت ترکیبی (${toPersianDigits((selectedExpense.paymentTranches ?? []).length)} بخش)`
                        : PAYMENT_METHOD_LABELS[selectedExpense.paymentMethod]}
                    </dd>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-50">
                    <dt className="text-slate-500">مالیات / تخفیف</dt>
                    <dd className="mt-1 font-semibold text-slate-900 tabular-nums">
                      {formatDisplayAmount(selectedExpense.taxAmount, selectedExpense.currency, rates, displayUnit, selectedExpense.exchangeRateToToman)}
                      {selectedExpense.discountAmount > 0
                        ? ` · تخفیف ${formatDisplayAmount(selectedExpense.discountAmount, selectedExpense.currency, rates, displayUnit, selectedExpense.exchangeRateToToman)}`
                        : ''}
                    </dd>
                  </div>
                  {selectedExpense.dueDate && (
                    <div className="p-2.5 rounded-xl bg-slate-50">
                      <dt className="text-slate-500">تاریخ سررسید (شمسی)</dt>
                      <dd className="mt-1 font-semibold text-slate-900 tabular-nums">
                        {formatJalaliDate(selectedExpense.dueDate)}
                      </dd>
                    </div>
                  )}
                  {selectedExpense.invoiceNumber && (
                    <div className="p-2.5 rounded-xl bg-slate-50">
                      <dt className="text-slate-500">شماره فاکتور</dt>
                      <dd className="mt-1 font-mono-num font-semibold text-slate-900">
                        {selectedExpense.invoiceNumber}
                      </dd>
                    </div>
                  )}
                  {selectedExpense.trackingCode && (
                    <div className="p-2.5 rounded-xl bg-slate-50">
                      <dt className="text-slate-500">کد پیگیری</dt>
                      <dd className="mt-1 font-mono-num font-semibold text-slate-900">
                        {selectedExpense.trackingCode}
                      </dd>
                    </div>
                  )}
                  {normalizePurchaserName(selectedExpense.purchaser) && (
                    <div className="p-2.5 rounded-xl bg-teal-50/70 border border-teal-200/70">
                      <dt className="text-teal-800">مسئول خرید / پرداخت‌کننده</dt>
                      <dd className="mt-1 font-bold text-teal-950">
                        {normalizePurchaserName(selectedExpense.purchaser)}
                      </dd>
                    </div>
                  )}
                  {selectedExpense.projectTag && (
                    <div className="p-2.5 rounded-xl bg-slate-50">
                      <dt className="text-slate-500">برچسب پروژه</dt>
                      <dd className="mt-1 font-semibold text-slate-900">
                        {selectedExpense.projectTag}
                      </dd>
                    </div>
                  )}
                </dl>

                {selectedExpense.lineItems.length > 0 && (
                  <div>
                    <h3 className="text-xs font-bold text-slate-800 mb-2">اقلام فاکتور</h3>
                    <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 text-xs">
                      {selectedExpense.lineItems.map((li, idx) => (
                        <div key={idx} className="p-2.5 flex items-center justify-between gap-2">
                          <span className="text-slate-800">
                            {li.description} ({toPersianDigits(li.quantity)} عدد)
                          </span>
                          <span className="font-semibold text-slate-900 tabular-nums">
                            {formatDisplayAmount(li.totalPrice, selectedExpense.currency, rates, displayUnit, selectedExpense.exchangeRateToToman)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedExpense.notes && (
                  <div className="text-xs text-slate-700 bg-slate-50 p-3 rounded-xl">
                    <strong>یادداشت:</strong> {selectedExpense.notes}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    disabled={isMutating}
                    onClick={async () => {
                      if (!await runMutation(() => onTogglePaid(selectedExpense))) return;
                    }}
                    className="inline-flex items-center gap-2 min-h-[42px] px-4 py-2 rounded-xl bg-teal-700 text-white text-xs font-semibold hover:bg-teal-800 disabled:opacity-50 cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>
                      {selectedExpense.paymentStatus === 'paid'
                        ? selectedSummary.hasSchedule
                          ? 'بازگرداندن همه بخش‌ها به در انتظار'
                          : 'تغییر کل سند به در انتظار پرداخت'
                        : selectedSummary.hasSchedule
                          ? 'تسویه کامل همه بخش‌های سند'
                          : 'تسویه کامل کل سند'}
                    </span>
                  </button>

                  {confirmDeleteId === selectedExpense.id ? (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={isMutating}
                        onClick={async () => {
                          if (!await runMutation(() => onDeleteExpense(selectedExpense.id))) return;
                          setConfirmDeleteId(null);
                        }}
                        className="min-h-[42px] px-3.5 py-2 rounded-xl bg-red-600 text-white text-xs font-semibold hover:bg-red-700 cursor-pointer"
                      >
                        حذف قطعی شود
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="min-h-[42px] px-3 py-2 rounded-xl bg-slate-100 text-xs font-semibold text-slate-700 cursor-pointer"
                      >
                        لغو
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(selectedExpense.id)}
                      className="inline-flex items-center gap-1.5 min-h-[42px] px-3.5 py-2 rounded-xl border border-red-200 text-red-600 text-xs font-semibold hover:bg-red-50 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                      <span>حذف سند</span>
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
