import { BackupPanel } from './components/BackupPanel';
import { minimizeAndroid } from './storage/androidSnapshotStore';
import { WebLedgerRepository, type LedgerRepository, type DraftSession } from './storage/ledgerRepository';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  LayoutDashboard,
  ListOrdered,
  Plus,
  Settings,
} from 'lucide-react';
import type {
  AiConfig,
  AiProviderId,
  AiProviderStatus,
  CategoryBudget,
  CategoryDefinition,
  DisplayUnit,
  ExchangeRates,
  ExpenseCategory,
  ExpenseFields,
  ExpenseRecord,
  ExtractedExpenseDraft,
  JsonImportMode,
  JsonImportStats,
  LedgerData,
} from './types/expense';
import { OverviewDashboard } from './components/OverviewDashboard';
import { CaptureWorkspace } from './components/CaptureWorkspace';
import { DraftReviewPanel } from './components/DraftReviewPanel';
import { ExpenseLedger } from './components/ExpenseLedger';
import { SettingsBudgets } from './components/SettingsBudgets';
import { PWAInstallButton } from './components/PWAInstallButton';
import { OfflineIndicator } from './components/OfflineIndicator';
import { toPersianDigits } from './utils/jalali';
import {
  CATEGORY_PALETTE_COLORS,
  clearLedgerExpenses,
  createCustomCategoryId,
  DEFAULT_CATEGORIES,
  deleteCategoryAndReassign,
  mergeLedgerData,
  normalizeCategoryDescription,
  normalizeCategoryLabel,
  parseAndValidateLedgerImport,
  resolveCategories,
} from './utils/finance';
import {
  loadLocalApiKeys,
  removeLocalApiKey,
  saveLocalApiKey,
} from './utils/localKeyVault';

type ActiveTab = 'overview' | 'capture' | 'ledger' | 'settings';

const CACHE_KEY = 'hesabyar_ledger_cache_v1';
const DISPLAY_UNIT_KEY = 'hesabyar_display_unit_v1';

const webRepository = new WebLedgerRepository();
export default function App({ repository = webRepository, onLock }: { repository?: LedgerRepository; onLock?:()=>void }) {
  const [activeTab, setActiveTab] = useState<ActiveTab>('overview');
  const [displayUnit, setDisplayUnit] = useState<DisplayUnit>(() => {
    try {
      const saved = localStorage.getItem(DISPLAY_UNIT_KEY);
      return saved === 'IRR' ? 'IRR' : 'IRT';
    } catch {
      return 'IRT';
    }
  });
  const [ledger, setLedger] = useState<LedgerData>({
    expenses: [],
    budgets: [],
    categories: DEFAULT_CATEGORIES,
    rates: { USD: 70000, EUR: 76000 },
    aiConfig: { provider: 'gemini', model: 'gemini-4-hydrogen' },
  });
  const [aiStatus, setAiStatus] = useState<AiProviderStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cachedOnly, setCachedOnly] = useState(false);

  const [pendingDrafts, setPendingDrafts] = useState<ExtractedExpenseDraft[] | null>(null);
  const draftRef = useRef<DraftSession | null>(null);
  const [previewPages, setPreviewPages] = useState<string[]>([]);
  const [isSavingBatch, setIsSavingBatch] = useState(false);
  const approvalInFlight=useRef(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [ledgerCategoryFilter, setLedgerCategoryFilter] = useState<ExpenseCategory | 'all'>('all');
  const [ledgerPurchaserFilter, setLedgerPurchaserFilter] = useState<string>('all');
  const [selectedExpense, setSelectedExpense] = useState<ExpenseRecord | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [localApiKeys, setLocalApiKeys] = useState<Partial<Record<AiProviderId, string>>>({});

  const handleChangeDisplayUnit = useCallback((unit: DisplayUnit) => {
    setDisplayUnit(unit);
    try {
      localStorage.setItem(DISPLAY_UNIT_KEY, unit);
    } catch {
      // ignore storage errors
    }
  }, []);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 3500);
  }, []);

  const saveCache = (next: LedgerData) => {
    if (repository.mode !== 'web') return;
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage quota errors
    }
  };

  const loadLedger = useCallback(async () => {
    setLoadError(null);
    try {
      const [active,statusData]=await Promise.all([
        repository.loadActive?repository.loadActive():Promise.all([repository.load(),repository.loadDraft?repository.loadDraft():Promise.resolve(null)]).then(([ledger,draft])=>({ledger,draft})),
        repository.aiStatus(),
      ]);
      const {ledger:data,draft:recovered}=active;
      if (repository.mode === 'local') {
        draftRef.current = recovered;
        setPendingDrafts(recovered?.drafts ?? null);
        setPreviewPages(recovered?.previewPages ?? []);
        if (recovered) setActiveTab('capture');
      }
      setLedger(data);
      setCachedOnly(false);
      saveCache(data);
      setAiStatus(statusData);
    } catch (err) {
      const cached = repository.mode === 'web' ? localStorage.getItem(CACHE_KEY) : null;
      if (cached) {
        try {
          setLedger(JSON.parse(cached) as LedgerData);
          setCachedOnly(true);
        } catch {
          setLoadError(err instanceof Error ? err.message : 'خطا در بارگذاری داده‌ها');
        }
      } else {
        setLoadError(err instanceof Error ? err.message : 'خطا در بارگذاری داده‌ها');
      }
    } finally {
      setIsLoading(false);
    }
  }, [repository]);

  useEffect(() => {
    loadLedger();
    loadLocalApiKeys().then(setLocalApiKeys).catch(() => showToast('خطا در خواندن کلیدهای دستگاه؛ کلیدهای موجود حذف نشده‌اند.'));
  }, [loadLedger]);

  const handleSaveLocalApiKey = async (provider: AiProviderId, key: string) => {
    const next = await saveLocalApiKey(provider, key);
    setLocalApiKeys(next);
    showToast('کلید امنیتی شخصی روی همین دستگاه ذخیره شد.');
  };

  const handleRemoveLocalApiKey = async (provider: AiProviderId) => {
    const next = await removeLocalApiKey(provider);
    setLocalApiKeys(next);
    showToast('کلید امنیتی شخصی از این دستگاه حذف شد.');
  };

  const persistDraft = (session:DraftSession|null) => {
    if(approvalInFlight.current)return;
    draftRef.current=session;
    setPendingDrafts(session?.drafts ?? null);
    setPreviewPages(session?.previewPages ?? []);
    if (repository.saveDraft) {
      void repository.saveDraft(session).catch(err=>{
        setSaveError('ذخیره پیش‌نویس ناموفق بود: '+(err instanceof Error ? err.message : 'خطای ذخیره‌سازی'));
      });
    }
  };

  const handleDraftsReady = async (drafts:ExtractedExpenseDraft[],pages:string[]) => {
    setSaveError(null);
    persistDraft({id:globalThis.crypto.randomUUID(),drafts,previewPages:pages});
  };
  const handleUpdateDrafts = (drafts:ExtractedExpenseDraft[]) => {
    if (!draftRef.current) return;
    persistDraft({...draftRef.current,drafts});
  };
  const handleDiscardDrafts = async () => {
    if(approvalInFlight.current)return;
    if (!window.confirm('پیش‌نویس‌ها حذف شوند؟')) return;
    try {
      if (repository.saveDraft) await repository.saveDraft(null);
      draftRef.current=null;setPendingDrafts(null);setPreviewPages([]);setSaveError(null);
    } catch(err) {setSaveError(err instanceof Error ? err.message : 'حذف پیش‌نویس ناموفق بود');}
  };

  const handleApproveBatch = async (approvedItems: ExpenseFields[]) => {
    if(approvalInFlight.current)return;
    approvalInFlight.current=true;
    setIsSavingBatch(true);
    setSaveError(null);
    try {
      const session = draftRef.current;
      // Local queued edits precede approval. Do not write an already-approved
      // draft back to storage on retry after a lost response.
      if(repository.mode==='local'&&!session)throw new Error('پیش‌نویس فعال موجود نیست؛ دفتر را دوباره بارگذاری کنید.');
      const created = await repository.add(approvedItems, session?.id);
      if (!Array.isArray(created) || created.length !== approvedItems.length) throw new Error('پاسخ ثبت سند نامعتبر است؛ قبل از تلاش مجدد دفتر را بررسی کنید.');

      if(repository.mode==='local'){
        // Reload authoritative order and values. If reload fails, retry uses
        // the committed approval token rather than creating duplicate records.
        setLedger(await repository.load());
      }else{
        setLedger((prev) => {
          const createdIds = new Set(created.map(item=>item.id));
          const next = { ...prev, expenses: [...created, ...prev.expenses.filter(item=>!createdIds.has(item.id))] };
          saveCache(next);
          return next;
        });
      }
      draftRef.current=null;
      setPendingDrafts(null);
      setPreviewPages([]);
      setLedgerCategoryFilter('all');
      setLedgerPurchaserFilter('all');
      setActiveTab('ledger');
      showToast(`${toPersianDigits(created.length)} سند هزینه با موفقیت تایید و ثبت شد.`);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'خطا در ثبت نهایی');
    } finally {
      approvalInFlight.current=false;
      setIsSavingBatch(false);
    }
  };

  const handleUpdateExpense = async (id: string, patch: Partial<ExpenseFields>) => {
    try {
      const updated = await repository.update(id, patch);
      {
        setLedger((prev) => {
          const next = {
            ...prev,
            expenses: prev.expenses.map((e) => (e.id === updated.id ? updated : e)),
          };
          saveCache(next);
          return next;
        });
        setSelectedExpense(updated);
        showToast('اطلاعات سند بروزرسانی شد.');
      }
    } catch (err) {
      throw new Error(err instanceof TypeError ? 'ارتباط با محل ذخیره‌سازی برقرار نشد؛ تغییر ثبت نشده یا نتیجه آن نامشخص است. دفتر را دوباره بارگذاری کنید.' : err instanceof Error ? err.message : 'خطا در ذخیره اطلاعات');
    }
  };

  const handleTogglePaid = async (expense: ExpenseRecord) => {
    const nextStatus = expense.paymentStatus === 'paid' ? 'pending' : 'paid';
    const nextTranches = expense.paymentTranches?.map((tr) => ({
      ...tr,
      status: nextStatus === 'paid' ? ('paid' as const) : ('pending' as const),
    }));
    await handleUpdateExpense(expense.id, {
      paymentStatus: nextStatus,
      ...(nextTranches ? { paymentTranches: nextTranches } : {}),
    });
  };

  const handleDeleteExpense = async (id: string) => {
    try {
      await repository.remove(id);
      {
        setLedger((prev) => {
          const next = {
            ...prev,
            expenses: prev.expenses.filter((e) => e.id !== id),
          };
          saveCache(next);
          return next;
        });
        setSelectedExpense(null);
        showToast('سند هزینه حذف شد.');
      }
    } catch (err) {
      throw new Error(err instanceof TypeError ? 'ارتباط با محل ذخیره‌سازی برقرار نشد؛ تغییر ثبت نشده یا نتیجه آن نامشخص است. دفتر را دوباره بارگذاری کنید.' : err instanceof Error ? err.message : 'خطا در ذخیره اطلاعات');
    }
  };

  const handleSaveSettings = async (
    budgets: CategoryBudget[],
    rates: ExchangeRates,
    aiConfig: AiConfig
  ) => {
    try {
      const updated = await repository.settings(budgets, rates, aiConfig);
      const nextLedger: LedgerData = {
        expenses: updated.expenses,
        budgets: updated.budgets,
        categories: resolveCategories(updated.categories),
        rates: updated.rates,
        aiConfig: updated.aiConfig,
      };
      setLedger(nextLedger);
      saveCache(nextLedger);
      if (updated.aiStatus) {
        setAiStatus(updated.aiStatus);
      }
      showToast('تنظیمات هوش مصنوعی، بودجه‌ها و نرخ ارز ذخیره شدند.');
    } catch (err) {
      throw new Error(err instanceof TypeError ? 'ارتباط با محل ذخیره‌سازی برقرار نشد؛ تغییر ثبت نشده یا نتیجه آن نامشخص است. دفتر را دوباره بارگذاری کنید.' : err instanceof Error ? err.message : 'خطا در ذخیره اطلاعات');
    }
  };

  const handleImportJson = async (
    data: unknown,
    mode: JsonImportMode
  ): Promise<JsonImportStats> => {
    try {
      const payload = await repository.import(data, mode);
      const nextLedger = payload.ledger as LedgerData;
      const stats = payload.stats as JsonImportStats;
      setLedger(nextLedger);
      saveCache(nextLedger);
      setSelectedExpense(null);
      showToast(
        mode === 'replace'
          ? `${toPersianDigits(stats.total)} سند با موفقیت جایگزین شد.`
          : `${toPersianDigits(stats.added)} سند جدید اضافه و ${toPersianDigits(stats.updated)} سند بروزرسانی شد.`
      );
      return stats;
    } catch (err) {
      throw new Error(err instanceof TypeError ? 'ارتباط با محل ذخیره‌سازی برقرار نشد؛ تغییر ثبت نشده یا نتیجه آن نامشخص است. دفتر را دوباره بارگذاری کنید.' : err instanceof Error ? err.message : 'خطا در ذخیره اطلاعات');
    }
  };

  const handleClearLedger = async (scope: 'samples' | 'all'): Promise<number> => {
    try {
      const payload = await repository.clear(scope);
      const nextLedger = payload.ledger as LedgerData;
      const removedCount = Number(payload.removedCount) || 0;
      setLedger(nextLedger);
      saveCache(nextLedger);
      setSelectedExpense((prev) =>
        prev && nextLedger.expenses.some((e) => e.id === prev.id) ? prev : null
      );
      showToast(
        scope === 'all'
          ? `همه ${toPersianDigits(removedCount)} سند از دفتر پاکسازی شدند.`
          : `${toPersianDigits(removedCount)} سند نمونه پاکسازی شد؛ برنامه آماده ثبت اطلاعات واقعی است.`
      );
      return removedCount;
    } catch (err) {
      throw new Error(err instanceof TypeError ? 'ارتباط با محل ذخیره‌سازی برقرار نشد؛ تغییر ثبت نشده یا نتیجه آن نامشخص است. دفتر را دوباره بارگذاری کنید.' : err instanceof Error ? err.message : 'خطا در ذخیره اطلاعات');
    }
  };

  const activeCategories = useMemo(
    () => resolveCategories(ledger.categories),
    [ledger.categories]
  );

  const handleAddCategory = async (input: {
    label: string;
    color: string;
    description?: string;
    monthlyLimitIRT: number;
  }) => {
    try {
      const payload = await repository.addCategory(input);
      const nextLedger = payload.ledger as LedgerData;
      const created = payload.category as CategoryDefinition;
      setLedger(nextLedger);
      saveCache(nextLedger);
      showToast(`دسته‌بندی «${created.label}» اضافه شد.`);
    } catch (err) {
      throw new Error(err instanceof TypeError ? 'ارتباط با محل ذخیره‌سازی برقرار نشد؛ تغییر ثبت نشده یا نتیجه آن نامشخص است. دفتر را دوباره بارگذاری کنید.' : err instanceof Error ? err.message : 'خطا در ذخیره اطلاعات');
    }
  };

  const handleUpdateCategory = async (
    id: string,
    patch: { label: string; color: string; description?: string }
  ) => {
    try {
      const payload = await repository.updateCategory(id, patch);
      const nextLedger = payload.ledger as LedgerData;
      const updated = payload.category as CategoryDefinition;
      setLedger(nextLedger);
      saveCache(nextLedger);
      showToast(`دسته‌بندی «${updated.label}» بروزرسانی شد.`);
    } catch (err) {
      throw new Error(err instanceof TypeError ? 'ارتباط با محل ذخیره‌سازی برقرار نشد؛ تغییر ثبت نشده یا نتیجه آن نامشخص است. دفتر را دوباره بارگذاری کنید.' : err instanceof Error ? err.message : 'خطا در ذخیره اطلاعات');
    }
  };

  const handleDeleteCategory = async (id: string, reassignToId?: string) => {
    try {
      const payload = await repository.deleteCategory(id, reassignToId);
      const nextLedger = payload.ledger as LedgerData;
      const reassignedCount = Number(payload.reassignedCount) || 0;
      setLedger(nextLedger);
      saveCache(nextLedger);
      if (ledgerCategoryFilter === id) {
        setLedgerCategoryFilter('all');
      }
      setSelectedExpense((prev) =>
        prev ? (nextLedger.expenses.find((e) => e.id === prev.id) ?? null) : null
      );
      showToast(
        reassignedCount > 0
          ? `دسته‌بندی حذف شد و ${toPersianDigits(reassignedCount)} سند به دسته‌بندی مقصد منتقل گردید.`
          : 'دسته‌بندی با موفقیت حذف شد.'
      );
    } catch (err) {
      throw new Error(err instanceof TypeError ? 'ارتباط با محل ذخیره‌سازی برقرار نشد؛ تغییر ثبت نشده یا نتیجه آن نامشخص است. دفتر را دوباره بارگذاری کنید.' : err instanceof Error ? err.message : 'خطا در ذخیره اطلاعات');
    }
  };

  useEffect(()=>{
    if(repository.mode!=='local')return;
    const back=()=>{
      if(isSavingBatch)return;
      if(selectedExpense){setSelectedExpense(null);return;}
      if(activeTab!=='overview'){setActiveTab('overview');return;}
      void minimizeAndroid().catch(()=>{});
    };
    window.addEventListener('expensescan-native-back',back);
    return ()=>window.removeEventListener('expensescan-native-back',back);
  },[repository,selectedExpense,activeTab,isSavingBatch]);

  const navigateTab = (tab: ActiveTab) => {
    // Preserve reviewed/paid AI drafts while navigating between tabs.
    if (isSavingBatch) return;
    setActiveTab(tab);
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Desktop Top Navigation (Strict 3-zone contract) */}
      <header className="hidden md:flex sticky top-0 z-30 h-16 bg-white/95 backdrop-blur-md border-b border-slate-200 px-6 lg:px-10 items-center justify-between gap-8">
        <a
          href="#overview"
          onClick={(e) => {
            e.preventDefault();
            navigateTab('overview');
          }}
          className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
        >
          حساب‌یار
        </a>

        <nav aria-label="منوی اصلی" className="flex items-center gap-7 text-sm font-medium">
          <button
            type="button"
            onClick={() => navigateTab('overview')}
            className={`py-5 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'overview'
                ? 'border-teal-700 text-teal-800 font-semibold'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            نمای کلی
          </button>
          <button
            type="button"
            onClick={() => navigateTab('capture')}
            className={`py-5 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'capture'
                ? 'border-teal-700 text-teal-800 font-semibold'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            ثبت سند
          </button>
          <button
            type="button"
            onClick={() => {
              setLedgerCategoryFilter('all');
              setLedgerPurchaserFilter('all');
              navigateTab('ledger');
            }}
            className={`py-5 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'ledger'
                ? 'border-teal-700 text-teal-800 font-semibold'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            دفتر هزینه‌ها
          </button>
          <button
            type="button"
            onClick={() => navigateTab('settings')}
            className={`py-5 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'settings'
                ? 'border-teal-700 text-teal-800 font-semibold'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            بودجه و تنظیمات
          </button>
        </nav>

        <div className="shrink-0">
          <button
            type="button"
            onClick={() => navigateTab('capture')}
            className="inline-flex items-center gap-2 min-h-[40px] px-4 py-2 rounded-xl bg-teal-700 text-white text-xs font-semibold hover:bg-teal-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>ثبت هزینه جدید</span>
          </button>
        </div>
      </header>

      {/* Mobile Compact Sticky Top Bar (56px) */}
      <header className="md:hidden sticky top-0 z-30 h-14 shrink-0 bg-white/95 backdrop-blur-md border-b border-slate-200 px-4 flex items-center justify-between gap-3">
        <span className="text-base font-bold text-slate-900 truncate">حساب‌یار</span>
        {repository.mode==='web' && <PWAInstallButton compact />}
        {onLock&&<button type="button" onClick={onLock} className="min-h-10 px-3 text-xs border rounded-lg">قفل</button>}
      </header>

      {/* Toast Confirmation */}
      {toastMessage && (
        <div
          role="status"
          className="fixed top-16 md:top-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white shadow-lg"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 py-6 pb-24 md:pb-10">
        {isLoading ? (
          <div className="space-y-4">
            <div className="h-8 w-56 rounded-lg bg-slate-200 animate-pulse" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-28 rounded-2xl bg-white border border-slate-200 animate-pulse" />
              ))}
            </div>
            <div className="h-72 rounded-2xl bg-white border border-slate-200 animate-pulse" />
          </div>
        ) : loadError ? (
          <div className="rounded-2xl bg-white border border-red-200 p-6 text-center max-w-md mx-auto mt-8">
            <p className="text-sm font-semibold text-red-700">{loadError}</p>
            <button
              type="button"
              onClick={loadLedger}
              className="mt-4 min-h-[40px] px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold cursor-pointer"
            >
              تلاش مجدد
            </button>
          </div>
        ) : (
          <>
            {cachedOnly && <div role="alert" className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">دفتر از حافظه موقت خوانده شده است؛ ذخیره فقط پس از تأیید سرور انجام می‌شود. <button type="button" className="underline" onClick={loadLedger}>بارگذاری مجدد</button></div>}
            {activeTab === 'overview' && (
              <OverviewDashboard
                expenses={ledger.expenses}
                budgets={ledger.budgets}
                categories={activeCategories}
                rates={ledger.rates}
                displayUnit={displayUnit}
                onChangeDisplayUnit={handleChangeDisplayUnit}
                onNavigateCapture={() => navigateTab('capture')}
                onOpenLedgerWithCategory={(cat) => {
                  setLedgerCategoryFilter(cat);
                  setLedgerPurchaserFilter('all');
                  navigateTab('ledger');
                }}
                onOpenLedgerWithPurchaser={(person) => {
                  setLedgerCategoryFilter('all');
                  setLedgerPurchaserFilter(person);
                  navigateTab('ledger');
                }}
                onSelectExpense={(exp) => {
                  setSelectedExpense(exp);
                  navigateTab('ledger');
                }}
              />
            )}

            {activeTab === 'capture' && !pendingDrafts && (
              <CaptureWorkspace
                localMode={repository.mode === 'local'}
                displayUnit={displayUnit}
                categories={activeCategories}
                rates={ledger.rates}
                aiConfig={ledger.aiConfig ?? { provider: 'gemini', model: 'gemini-4-hydrogen' }}
                aiStatus={aiStatus}
                localApiKeys={localApiKeys}
                onSaveLocalApiKey={handleSaveLocalApiKey}
                onRemoveLocalApiKey={handleRemoveLocalApiKey}
                onSaveAiConfig={(nextAiConfig) =>
                  handleSaveSettings(ledger.budgets, ledger.rates, nextAiConfig)
                }
                onOpenSettings={() => navigateTab('settings')}
                onDraftsReady={handleDraftsReady}
              />
            )}

            {activeTab === 'capture' && pendingDrafts && (
              <DraftReviewPanel
                displayUnit={displayUnit}
                drafts={pendingDrafts}
                previewPages={previewPages}
                existingExpenses={ledger.expenses}
                categories={activeCategories}
                rates={ledger.rates}
                isSaving={isSavingBatch}
                saveError={saveError}
                onUpdateDrafts={handleUpdateDrafts}
                onClearPreviewPages={() => {
                  if (draftRef.current) persistDraft({...draftRef.current,previewPages:[],drafts:draftRef.current.drafts.map(d=>({...d,sourcePreviewUrl:undefined}))});
                }}
                onApprove={handleApproveBatch}
                onCancel={() => void handleDiscardDrafts()}
              />
            )}

            {activeTab === 'ledger' && (
              <ExpenseLedger
                expenses={ledger.expenses}
                budgets={ledger.budgets}
                categories={activeCategories}
                rates={ledger.rates}
                displayUnit={displayUnit}
                onChangeDisplayUnit={handleChangeDisplayUnit}
                initialCategory={ledgerCategoryFilter}
                initialPurchaser={ledgerPurchaserFilter}
                selectedExpense={selectedExpense}
                onSelectExpense={setSelectedExpense}
                onTogglePaid={handleTogglePaid}
                onUpdateExpense={handleUpdateExpense}
                onDeleteExpense={handleDeleteExpense}
                onImportJson={handleImportJson}
                onClearSamples={() => handleClearLedger('samples')}
              />
            )}

            {activeTab === 'settings' && (
              <>
              <SettingsBudgets
                localMode={repository.mode==='local'}
                securityContent={<>{onLock && <button type="button" onClick={onLock} className="w-full bg-slate-900 text-white rounded-xl p-3 text-sm">قفل فوری برنامه</button>}{repository.exportBackup && <BackupPanel repository={repository} onRestored={loadLedger}/>}</>}
                displayUnit={displayUnit}
                categories={activeCategories}
                budgets={ledger.budgets}
                rates={ledger.rates}
                expenses={ledger.expenses}
                aiConfig={ledger.aiConfig ?? { provider: 'gemini', model: 'gemini-4-hydrogen' }}
                aiStatus={aiStatus}
                localApiKeys={localApiKeys}
                onSaveLocalApiKey={handleSaveLocalApiKey}
                onRemoveLocalApiKey={handleRemoveLocalApiKey}
                onClearLedger={handleClearLedger}
                onAddCategory={handleAddCategory}
                onUpdateCategory={handleUpdateCategory}
                onDeleteCategory={handleDeleteCategory}
                onSaveSettings={handleSaveSettings}
                onImportJson={handleImportJson}
              />
              </>
            )}
          </>
        )}
      </main>

      {/* Mobile Fixed Bottom Thumb-Zone Tab Bar (64px) */}
      <nav
        aria-label="ناوبری موبایل"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 grid grid-cols-4 h-16"
      >
        <button
          type="button"
          onClick={() => navigateTab('overview')}
          className={`flex flex-col items-center justify-center gap-1 text-[11px] font-medium cursor-pointer ${
            activeTab === 'overview' ? 'text-teal-700 font-bold' : 'text-slate-500'
          }`}
        >
          <LayoutDashboard className="w-5 h-5" />
          <span>داشبورد</span>
        </button>

        <button
          type="button"
          onClick={() => navigateTab('capture')}
          className={`flex flex-col items-center justify-center gap-1 text-[11px] font-medium cursor-pointer ${
            activeTab === 'capture' ? 'text-teal-700 font-bold' : 'text-slate-500'
          }`}
        >
          <Camera className="w-5 h-5" />
          <span>ثبت سند</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setLedgerCategoryFilter('all');
            setLedgerPurchaserFilter('all');
            navigateTab('ledger');
          }}
          className={`flex flex-col items-center justify-center gap-1 text-[11px] font-medium cursor-pointer ${
            activeTab === 'ledger' ? 'text-teal-700 font-bold' : 'text-slate-500'
          }`}
        >
          <ListOrdered className="w-5 h-5" />
          <span>هزینه‌ها</span>
        </button>

        <button
          type="button"
          onClick={() => navigateTab('settings')}
          className={`flex flex-col items-center justify-center gap-1 text-[11px] font-medium cursor-pointer ${
            activeTab === 'settings' ? 'text-teal-700 font-bold' : 'text-slate-500'
          }`}
        >
          <Settings className="w-5 h-5" />
          <span>تنظیمات</span>
        </button>
      </nav>

      <OfflineIndicator localMode={repository.mode === 'local'} />
    </div>
  );
}
