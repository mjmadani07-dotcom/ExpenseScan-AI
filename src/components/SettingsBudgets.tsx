import { useWorkspaceBusy } from './WorkspaceActivity';
import { testAiConnection } from '../utils/clientAiExtract';
import { isAndroidRuntime } from '../storage/androidSnapshotStore';
import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Cpu,
  Edit3,
  Eye,
  EyeOff,
  KeyRound,
  Plus,
  Save,
  ShieldAlert,
  Smartphone,
  Tags,
  Trash2,
  X,
} from 'lucide-react';
import type {
  AiConfig,
  AiProviderId,
  AiProviderStatus,
  CategoryBudget,
  CategoryDefinition,
  ExchangeRates,
  DisplayUnit,
  ExpenseCategory,
  ExpenseRecord,
  JsonImportMode,
  JsonImportStats,
} from '../types/expense';
import {
  CATEGORY_PALETTE_COLORS,
  CURRENCY_LABELS,
  toEntryAmount,
  fromEntryAmount,
  countSeedExpenses,
  resolveCategories,
} from '../utils/finance';
import { DEFAULT_AI_BASE_URLS, validateClientBaseUrl } from '../utils/aiUrls';
import { toPersianDigits } from '../utils/jalali';
import { maskApiKey } from '../utils/localKeyVault';
import { JsonSyncPanel } from './JsonSyncPanel';
import { PWAInstallButton } from './PWAInstallButton';

interface SettingsBudgetsProps {
  localMode?: boolean;
  securityContent?: React.ReactNode;
  categories: CategoryDefinition[];
  budgets: CategoryBudget[];
  rates: ExchangeRates;
  displayUnit: DisplayUnit;
  expenses: ExpenseRecord[];
  aiConfig: AiConfig;
  aiStatus: AiProviderStatus | null;
  localApiKeys: Partial<Record<AiProviderId, string>>;
  onSaveLocalApiKey: (provider: AiProviderId, key: string) => Promise<void>;
  onRemoveLocalApiKey: (provider: AiProviderId) => Promise<void>;
  onClearLedger: (scope: 'samples' | 'all') => Promise<number>;
  onAddCategory: (input: {
    label: string;
    color: string;
    description?: string;
    monthlyLimitIRT: number;
  }) => Promise<void>;
  onUpdateCategory: (
    id: string,
    patch: { label: string; color: string; description?: string }
  ) => Promise<void>;
  onDeleteCategory: (id: string, reassignToId?: string) => Promise<void>;
  onSaveSettings: (
    budgets: CategoryBudget[],
    rates: ExchangeRates,
    aiConfig: AiConfig
  ) => Promise<void>;
  onImportJson: (data: unknown, mode: JsonImportMode) => Promise<JsonImportStats>;
}

const FALLBACK_PROVIDERS = [
  {
    id: 'gemini' as AiProviderId,
    label: 'Google Gemini',
    envVarName: 'GEMINI_API_KEY',
    defaultModel: 'gemini-4-hydrogen',
    defaultBaseUrl: DEFAULT_AI_BASE_URLS.gemini,
    suggestedModels: ['gemini-4-hydrogen', 'gemini-3.1-flash-lite', 'gemini-2.5-flash'],
  },
  {
    id: 'openai' as AiProviderId,
    label: 'OpenAI (ChatGPT)',
    envVarName: 'OPENAI_API_KEY',
    defaultModel: 'gpt-4o-mini',
    defaultBaseUrl: DEFAULT_AI_BASE_URLS.openai,
    suggestedModels: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
  },
  {
    id: 'openrouter' as AiProviderId,
    label: 'OpenRouter (Multi-Model)',
    envVarName: 'OPENROUTER_API_KEY',
    defaultModel: 'google/gemini-2.5-flash',
    defaultBaseUrl: DEFAULT_AI_BASE_URLS.openrouter,
    suggestedModels: [
      'google/gemini-2.5-flash',
      'openai/gpt-4o-mini',
      'anthropic/claude-3.5-sonnet',
    ],
  },
];

export const SettingsBudgets: React.FC<SettingsBudgetsProps> = ({
  localMode=false,
  securityContent,
  categories,
  budgets,
  rates,
  displayUnit,
  expenses,
  aiConfig,
  aiStatus,
  localApiKeys,
  onSaveLocalApiKey,
  onRemoveLocalApiKey,
  onClearLedger,
  onAddCategory,
  onUpdateCategory,
  onDeleteCategory,
  onSaveSettings,
  onImportJson,
}) => {
  const [section,setSection]=useState<string|null>(null);
  const group=(id:string,title:string,description:string,content:React.ReactNode)=> <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden"><button type="button" aria-expanded={section===id} aria-controls={'settings-'+id} onClick={()=>setSection(v=>v===id?null:id)} className="flex w-full text-right items-center justify-between gap-3 min-h-16 p-4"><span><span className="block text-sm font-bold text-slate-900">{title}</span><span className="block text-xs text-slate-500 mt-1">{description}</span></span><span aria-hidden="true" className="text-teal-700 text-lg">{section===id?'−':'+'}</span></button><div id={'settings-'+id} hidden={section!==id} className="border-t p-3 space-y-3">{content}</div></section>;
  const activeCategories = useMemo(() => resolveCategories(categories), [categories]);
  const [localBudgets, setLocalBudgets] = useState<CategoryBudget[]>(budgets);
  const [localRates, setLocalRates] = useState<ExchangeRates>(rates);
  const [localAiConfig, setLocalAiConfig] = useState<AiConfig>(aiConfig);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [testing,setTesting]=useState(false);
  const [testResult,setTestResult]=useState<{ok:boolean;text:string}|null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isSavingKey, setIsSavingKey] = useState(false);
  const [confirmClearScope, setConfirmClearScope] = useState<'samples' | 'all' | null>(null);
  const [isClearing, setIsClearing] = useState(false);

  // Category CRUD state
  const [newCatLabel, setNewCatLabel] = useState('');
  const [newCatDescription, setNewCatDescription] = useState('');
  const [newCatColor, setNewCatColor] = useState(CATEGORY_PALETTE_COLORS[0].hex);
  const [newCatBudget, setNewCatBudget] = useState<number>(0);
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editCatLabel, setEditCatLabel] = useState('');
  const [editCatDescription, setEditCatDescription] = useState('');
  const [editCatColor, setEditCatColor] = useState(CATEGORY_PALETTE_COLORS[0].hex);
  const [deletingCatId, setDeletingCatId] = useState<string | null>(null);
  const [reassignTargetId, setReassignTargetId] = useState<string>('');
  const [catMutationBusy, setCatMutationBusy] = useState(false);
  useWorkspaceBusy(saving||testing||isSavingKey||isClearing||catMutationBusy);
  const [catError, setCatError] = useState<string | null>(null);

  const categoryUsageCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const exp of expenses) {
      counts.set(exp.category, (counts.get(exp.category) ?? 0) + 1);
    }
    return counts;
  }, [expenses]);

  useEffect(() => {
    setLocalBudgets(budgets);
  }, [budgets]);

  useEffect(() => {
    setLocalRates(rates);
  }, [rates]);

  useEffect(() => {
    setLocalAiConfig(aiConfig);
  }, [aiConfig]);

  const providersList = aiStatus?.providers ?? FALLBACK_PROVIDERS;
  const currentProviderInfo =
    providersList.find((p) => p.id === localAiConfig.provider) ?? providersList[0];
  const activeLocalKey = localApiKeys[localAiConfig.provider];
  const currentBaseUrlValue =
    localAiConfig.baseUrls?.[localAiConfig.provider] ??
    (localAiConfig.provider === aiConfig.provider ? localAiConfig.baseUrl ?? '' : '');
  const seedCount = countSeedExpenses(expenses);
  useEffect(()=>setTestResult(null),[localAiConfig,keyInput,activeLocalKey]);

  const handleSelectProvider = (providerId: AiProviderId) => {
    const info = providersList.find((p) => p.id === providerId) ?? providersList[0];
    setLocalAiConfig((prev) => {
      const nextMap: Partial<Record<AiProviderId, string>> = { ...(prev.baseUrls ?? {}) };
      const prevUrl = nextMap[prev.provider];
      if (prevUrl && prevUrl.trim()) {
        try {
          const cleanPrev = validateClientBaseUrl(prevUrl);
          if (cleanPrev) nextMap[prev.provider] = cleanPrev;
          else delete nextMap[prev.provider];
        } catch {
          const persistedPrev = aiConfig.baseUrls?.[prev.provider];
          if (persistedPrev) nextMap[prev.provider] = persistedPrev;
          else delete nextMap[prev.provider];
        }
      }
      const savedUrl = nextMap[providerId];
      return {
        ...prev,
        provider: providerId,
        model: info.defaultModel,
        baseUrl: savedUrl,
        baseUrls: nextMap,
      };
    });
    setKeyInput('');
    setShowKey(false);
    setSaveError(null);
  };

  const handleBaseUrlChange = (nextUrl: string) => {
    setSaveError(null);
    setLocalAiConfig((prev) => {
      const nextMap: Partial<Record<AiProviderId, string>> = { ...(prev.baseUrls ?? {}) };
      if (nextUrl) {
        nextMap[prev.provider] = nextUrl;
      } else {
        delete nextMap[prev.provider];
      }
      return {
        ...prev,
        baseUrl: nextUrl || undefined,
        baseUrls: nextMap,
      };
    });
  };

  const handleTestConnection=async()=>{
    if(testing)return;
    setTestResult(null);
    try{
      const apiKey=keyInput.trim()||activeLocalKey?.trim();if(!apiKey)throw new Error('کلید API را وارد کنید.');
      const baseUrl=validateClientBaseUrl(currentBaseUrlValue);
      const endpoint=new URL(baseUrl||DEFAULT_AI_BASE_URLS[localAiConfig.provider]);
      if(isAndroidRuntime()&&endpoint.protocol!=='https:')throw new Error('در اندروید فقط HTTPS مجاز است.');
      if(!window.confirm('یک درخواست آزمایشی بدون اطلاعات واقعی مالی به '+endpoint.host+' با مدل '+localAiConfig.model+' ارسال شود؟ ممکن است هزینه اندکی داشته باشد.'))return;
      setTesting(true);
      const provider=localAiConfig.provider,model=localAiConfig.model;
      await testAiConnection({provider,model,apiKey,baseUrl,secureTransport:isAndroidRuntime()});
      setTestResult({ok:true,text:'پاسخ ساختاریافته آزمایشی از '+provider+' / '+model+' دریافت شد. اطلاعاتی ثبت نشد.'});
    }catch(e){setTestResult({ok:false,text:e instanceof Error?e.message:'آزمایش ناموفق بود.'});}
    finally{setTesting(false);}
  };
  const handleSaveDeviceKey = async () => {
    const trimmed = keyInput.trim();
    if (!trimmed) return;
    setIsSavingKey(true);
    try {
      await onSaveLocalApiKey(localAiConfig.provider, trimmed);
      setKeyInput('');
      setShowKey(false);
    } catch (err) { setSaveError(err instanceof Error ? err.message : 'خطا در ذخیره کلید'); } finally {
      setIsSavingKey(false);
    }
  };

  const handleRemoveDeviceKey = async () => {
    setIsSavingKey(true);
    try {
      await onRemoveLocalApiKey(localAiConfig.provider);
      setKeyInput('');
    } catch (err) { setSaveError(err instanceof Error ? err.message : 'خطا در حذف کلید'); } finally {
      setIsSavingKey(false);
    }
  };

  const handleConfirmClear = async () => {
    if (!confirmClearScope) return;
    setIsClearing(true);
    try {
      await onClearLedger(confirmClearScope);
      setConfirmClearScope(null);
    } catch (err) { setSaveError(err instanceof Error ? err.message : 'خطا در پاکسازی'); } finally {
      setIsClearing(false);
    }
  };

  const handleBudgetChange = (category: ExpenseCategory, value: number) => {
    setLocalBudgets((prev) => {
      const exists = prev.some((b) => b.category === category);
      if (exists) {
        return prev.map((b) =>
          b.category === category ? { ...b, monthlyLimitIRT: Math.max(0, value) } : b
        );
      }
      return [...prev, { category, monthlyLimitIRT: Math.max(0, value) }];
    });
  };

  const handleCreateCategory = async () => {
    const cleanLabel = newCatLabel.trim().replace(/\s+/g, ' ');
    if (!cleanLabel) {
      setCatError('لطفاً نام دسته‌بندی جدید را وارد کنید.');
      return;
    }
    setCatError(null);
    setCatMutationBusy(true);
    try {
      await onAddCategory({
        label: cleanLabel,
        color: newCatColor,
        description: newCatDescription.trim() || undefined,
        monthlyLimitIRT: Math.max(0, Number(newCatBudget) || 0),
      });
      setNewCatLabel('');
      setNewCatDescription('');
      setNewCatBudget(0);
      setNewCatColor(
        CATEGORY_PALETTE_COLORS[(activeCategories.length + 1) % CATEGORY_PALETTE_COLORS.length].hex
      );
    } catch (err) {
      setCatError(err instanceof Error ? err.message : 'خطا در ایجاد دسته‌بندی جدید');
    } finally {
      setCatMutationBusy(false);
    }
  };

  const startEditCategory = (cat: CategoryDefinition) => {
    setCatError(null);
    setDeletingCatId(null);
    setEditingCatId(cat.id);
    setEditCatLabel(cat.label);
    setEditCatDescription(cat.description ?? '');
    setEditCatColor(cat.color);
  };

  const handleSaveEditCategory = async () => {
    if (!editingCatId) return;
    const cleanLabel = editCatLabel.trim().replace(/\s+/g, ' ');
    if (!cleanLabel) {
      setCatError('نام دسته‌بندی نمی‌تواند خالی باشد.');
      return;
    }
    setCatError(null);
    setCatMutationBusy(true);
    try {
      await onUpdateCategory(editingCatId, {
        label: cleanLabel,
        color: editCatColor,
        description: editCatDescription.trim() || undefined,
      });
      setEditingCatId(null);
    } catch (err) {
      setCatError(err instanceof Error ? err.message : 'خطا در ویرایش دسته‌بندی');
    } finally {
      setCatMutationBusy(false);
    }
  };

  const startDeleteCategory = (catId: string) => {
    setCatError(null);
    setEditingCatId(null);
    setDeletingCatId(catId);
    const remaining = activeCategories.filter((c) => c.id !== catId);
    const defaultFallback = remaining.find((c) => c.id === 'other')?.id ?? remaining[0]?.id ?? '';
    setReassignTargetId(defaultFallback);
  };

  const handleConfirmDeleteCategory = async () => {
    if (!deletingCatId) return;
    setCatError(null);
    setCatMutationBusy(true);
    try {
      await onDeleteCategory(deletingCatId, reassignTargetId || undefined);
      setDeletingCatId(null);
    } catch (err) {
      setCatError(err instanceof Error ? err.message : 'خطا در حذف دسته‌بندی');
    } finally {
      setCatMutationBusy(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(null);
    try {
      const cleanedUrls: Partial<Record<AiProviderId, string>> = {};
      if (localAiConfig.baseUrls) {
        for (const p of ['gemini', 'openai', 'openrouter'] as const) {
          const v = localAiConfig.baseUrls[p];
          if (v && v.trim()) {
            if (p === localAiConfig.provider) {
              const clean = validateClientBaseUrl(v);
              if (clean) cleanedUrls[p] = clean;
            } else {
              try {
                const clean = validateClientBaseUrl(v);
                if (clean) cleanedUrls[p] = clean;
              } catch {
                // Ignore un-saved invalid drafts on inactive provider tabs
              }
            }
          }
        }
      }
      if (localAiConfig.baseUrl && localAiConfig.baseUrl.trim() && !cleanedUrls[localAiConfig.provider]) {
        const clean = validateClientBaseUrl(localAiConfig.baseUrl);
        if (clean) cleanedUrls[localAiConfig.provider] = clean;
      }

      const payloadAiConfig: AiConfig = {
        provider: localAiConfig.provider,
        model: localAiConfig.model.trim() || currentProviderInfo.defaultModel,
        ...(cleanedUrls[localAiConfig.provider] ? { baseUrl: cleanedUrls[localAiConfig.provider] } : {}),
        ...(Object.keys(cleanedUrls).length > 0 ? { baseUrls: cleanedUrls } : {}),
      };

      setSaving(true);
      setSavedNotice(false);
      await onSaveSettings(localBudgets, localRates, payloadAiConfig);
      setLocalAiConfig(payloadAiConfig);
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 3000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'خطا در ذخیره تنظیمات');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="max-w-4xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
            تنظیمات حساب‌یار
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            موضوع موردنظر را انتخاب کنید. تغییرات بودجه، نرخ ارز و سرویس هوش مصنوعی را با دکمه ذخیره تنظیمات ثبت کنید.
          </p>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center justify-center gap-2 min-h-[42px] px-5 py-2 rounded-xl bg-teal-700 text-white text-xs sm:text-sm font-semibold hover:bg-teal-800 disabled:opacity-50 cursor-pointer"
        >
          {savedNotice ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
          <span>{saving ? 'در حال ذخیره...' : savedNotice ? 'ذخیره شد' : 'ذخیره تنظیمات'}</span>
        </button>
      </div>

      {saveError && (
        <div
          role="alert"
          className="rounded-2xl bg-red-50 border border-red-200 px-4 py-3 text-xs sm:text-sm text-red-900 flex items-center gap-2"
        >
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{saveError}</span>
        </div>
      )}

      {localMode&&<p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">قبل از نصب نسخه جدید، پشتیبان رمزگذاری‌شده را خارج از برنامه نگهداری کنید. اگر اندروید تعارض نصب نشان داد، برنامه فعلی را حذف نکنید. نسخه‌های آزمایشی با امضای موقت قابل ارتقای مطمئن نیستند.</p>}
      {localMode && group('security','امنیت و پشتیبان‌گیری','قفل برنامه، نسخه‌های بازیابی و فایل پشتیبان',securityContent)}
      {/* Multi-AI Provider Settings */}
      {group("ai","هوش مصنوعی","مدل، آدرس اتصال و کلید API",(<section className="rounded-2xl bg-white border border-slate-200 p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center shrink-0">
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">
              انتخاب سرویس هوش مصنوعی (Gemini / OpenAI / OpenRouter)
            </h2>
            <p className="mt-1 text-xs text-slate-600 leading-relaxed">
              موتور پیش‌فرض، مدل و در صورت نیاز آدرس Base URL (پراکسی، گیت‌وی سازمانی یا سرور محلی) را تنظیم و کلید API شخصی را روی همین دستگاه ذخیره کنید.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {providersList.map((prov) => {
            const isSelected = localAiConfig.provider === prov.id;
            const hasLocalKey = Boolean(localApiKeys[prov.id]);
            const hasServerKey = aiStatus?.configured[prov.id] ?? false;
            const hasCustomUrl = Boolean(localAiConfig.baseUrls?.[prov.id]);
            return (
              <button
                key={prov.id}
                type="button"
                onClick={() => handleSelectProvider(prov.id)}
                className={`p-3.5 rounded-xl border text-right transition-colors cursor-pointer ${
                  isSelected
                    ? 'border-teal-600 bg-teal-50/70'
                    : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-slate-900">{prov.label}</span>
                  {isSelected && <CheckCircle2 className="w-4 h-4 text-teal-700 shrink-0" />}
                </div>
                <div
                  className={`mt-1.5 text-[11px] font-semibold ${
                    hasLocalKey
                      ? 'text-emerald-700'
                      : hasServerKey
                        ? 'text-teal-700'
                        : 'text-amber-700'
                  }`}
                >
                  {hasLocalKey
                    ? 'کلید شخصی روی دستگاه فعال'
                    : hasServerKey
                      ? 'متصل در سرور'
                      : 'بدون کلید (کلید را وارد کنید)'}
                  {hasCustomUrl ? ' · Base URL سفارشی' : ''}
                </div>
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
          <div>
            <label htmlFor="ai-model-preset" className="block text-xs font-semibold text-slate-700 mb-1.5">
              مدل پیشنهادی ({currentProviderInfo.label})
            </label>
            <select
              id="ai-model-preset"
              value={
                currentProviderInfo.suggestedModels.includes(localAiConfig.model)
                  ? localAiConfig.model
                  : '__custom__'
              }
              onChange={(e) => {
                if (e.target.value !== '__custom__') {
                  setLocalAiConfig((prev) => ({ ...prev, model: e.target.value }));
                }
              }}
              className="w-full min-h-[42px] rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
            >
              {currentProviderInfo.suggestedModels.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
              <option value="__custom__">نام مدل دلخواه</option>
            </select>
          </div>

          <div>
            <label htmlFor="ai-model-custom" className="block text-xs font-semibold text-slate-700 mb-1.5">
              شناسه دقیق مدل فعال
            </label>
            <input
              id="ai-model-custom"
              type="text"
              value={localAiConfig.model}
              onChange={(e) =>
                setLocalAiConfig((prev) => ({ ...prev, model: e.target.value }))
              }
              placeholder={currentProviderInfo.defaultModel}
              className="w-full min-h-[42px] rounded-xl border border-slate-200 px-3 text-sm font-mono-num text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>

          <div className="sm:col-span-2">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <label htmlFor="ai-base-url" className="block text-xs font-semibold text-slate-700">
                آدرس پایه سرور (Base URL) — اختیاری ({currentProviderInfo.label})
              </label>
              {currentBaseUrlValue.trim() && (
                <button
                  type="button"
                  onClick={() => handleBaseUrlChange('')}
                  className="text-[11px] font-semibold text-slate-600 hover:text-red-600 cursor-pointer"
                >
                  بازنشانی به آدرس پیش‌فرض
                </button>
              )}
            </div>
            <input
              id="ai-base-url"
              type="text"
              inputMode="url"
              dir="ltr"
              spellCheck={false}
              value={currentBaseUrlValue}
              onChange={(e) => handleBaseUrlChange(e.target.value)}
              placeholder={currentProviderInfo.defaultBaseUrl ?? DEFAULT_AI_BASE_URLS[localAiConfig.provider]}
              className="w-full min-h-[42px] rounded-xl border border-slate-200 px-3 text-xs sm:text-sm font-mono-num text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
            <p className="mt-1.5 text-[11px] text-slate-500 leading-relaxed">
              در صورت خالی ماندن، از آدرس رسمی{' '}
              <span dir="ltr" className="font-mono-num text-slate-700">
                {currentProviderInfo.defaultBaseUrl ?? DEFAULT_AI_BASE_URLS[localAiConfig.provider]}
              </span>{' '}
              استفاده می‌شود. برای پراکسی‌ها، گیت‌وی‌های سازگار با OpenAI/Gemini یا سرور محلی (مثل Ollama)، Base URL دلخواه را وارد کرده و «ذخیره تنظیمات» را بزنید.
            </p>
          </div>
        </div>

        {/* Direct User-Entered Device API Key Vault */}
        <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
              <KeyRound className="w-4 h-4 text-teal-700 shrink-0" />
              <span>کلید امنیتی شخصی روی همین دستگاه ({currentProviderInfo.label})</span>
            </div>
            {activeLocalKey && (
              <div className="flex items-center gap-2">
                <span
                  dir="ltr"
                  className="px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-[11px] font-mono-num font-semibold text-emerald-800"
                >
                  {maskApiKey(activeLocalKey)}
                </span>
                <button
                  type="button"
                  disabled={isSavingKey}
                  onClick={handleRemoveDeviceKey}
                  className="inline-flex items-center gap-1 min-h-[32px] px-2.5 py-1 rounded-lg border border-red-200 bg-white text-[11px] font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>حذف کلید</span>
                </button>
              </div>
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <input
                id="local-provider-api-key"
                type={showKey ? 'text' : 'password'}
                dir="ltr"
                autoComplete="off"
                spellCheck={false}
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleSaveDeviceKey();
                  }
                }}
                placeholder={
                  localAiConfig.provider === 'openai'
                    ? 'sk-...'
                    : localAiConfig.provider === 'openrouter'
                      ? 'sk-or-v1-...'
                      : 'AIza...'
                }
                className="w-full min-h-[42px] rounded-xl border border-slate-200 bg-white pl-10 pr-3 text-xs sm:text-sm font-mono-num text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
              <button
                type="button"
                aria-label={showKey ? 'مخفی کردن کلید' : 'نمایش کلید'}
                onClick={() => setShowKey((v) => !v)}
                className="absolute left-2 top-1/2 -translate-y-1/2 min-h-[32px] min-w-[32px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <button
              type="button"
              disabled={!keyInput.trim() || isSavingKey}
              onClick={handleSaveDeviceKey}
              className="inline-flex items-center justify-center gap-1.5 min-h-[42px] px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 disabled:opacity-40 cursor-pointer shrink-0"
            >
              <Save className="w-4 h-4" />
              <span>{isSavingKey ? 'در حال ذخیره...' : 'ذخیره کلید روی دستگاه'}</span>
            </button>
          </div>

          <div className="space-y-2 rounded-xl border border-slate-200 p-3"><button type="button" disabled={testing||(!keyInput.trim()&&!activeLocalKey)} onClick={()=>void handleTestConnection()} className="min-h-11 px-4 rounded-xl bg-teal-700 text-white text-sm disabled:opacity-40">{testing?'در حال آزمایش…':'آزمایش اتصال و مدل'}</button><p className="text-xs text-slate-600">از تنظیمات فعلی (حتی ذخیره‌نشده) و فقط یک رسید فرضی استفاده می‌کند؛ داده واقعی ارسال یا سندی ثبت نمی‌شود.</p>{testResult&&<p role={testResult.ok?'status':'alert'} className={testResult.ok?'text-teal-800 text-xs':'text-red-700 text-xs'}>{testResult.text}</p>}</div>
          <div className="flex items-start gap-2 text-[11px] text-slate-600 leading-relaxed">
            <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              کلید شخصی شما با رمزنگاری محلی (<span className="font-mono-num">AES-GCM</span>) فقط در حافظه امن همین گوشی/مرورگر نگهداری می‌شود، به سرور ارسال نمی‌گردد و در خروجی JSON قرار نمی‌گیرد. توجه امنیتی: ذخیره کلید در مرورگر به معنای دسترسی به آن از طریق همین پروفایل دستگاه است؛ لذا فقط روی گوشی یا رایانه شخصی خودتان ذخیره کنید و در دستگاه‌های مشترک از دکمه حذف کلید استفاده نمایید.
            </div>
          </div>
        </div>
      </section>))}

      {/* JSON Export & Import (Merge / Replace) */}
      {group("data","ورود و خروج اطلاعات","فایل JSON؛ بدون اصل پیوست‌ها",(<section className="rounded-2xl bg-white border border-slate-200 p-5">
        <JsonSyncPanel
          expenses={expenses}
          categories={activeCategories}
          budgets={budgets}
          rates={rates}
          onImportJson={onImportJson}
        />
      </section>))}

      {/* Clear Sample / Seed Data & Start Fresh */}
      {group("cleanup","مدیریت داده‌ها","پاکسازی نمونه‌ها یا حذف اسناد",(<section className="rounded-2xl bg-white border border-slate-200 p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">
              پاکسازی داده‌های نمونه و شروع استفاده واقعی
            </h2>
            <p className="mt-1 text-xs text-slate-600 leading-relaxed">
              {seedCount > 0
                ? `در حال حاضر ${toPersianDigits(seedCount)} سند نمونه از مجموع ${toPersianDigits(expenses.length)} سند برای آزمایش برنامه در دفتر ثبت شده است. با پاکسازی مثال‌ها، اسناد واقعی شما دست‌نخورده باقی می‌مانند.`
                : `همه داده‌های نمونه پاکسازی شده‌اند (${toPersianDigits(expenses.length)} سند ثبت‌شده در دفتر موجود است).`}
            </p>
          </div>
        </div>

        {confirmClearScope ? (
          <div className="rounded-xl bg-red-50 border border-red-200 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="text-xs font-semibold text-red-900 leading-relaxed">
              {confirmClearScope === 'samples'
                ? `آیا مطمئن هستید که ${toPersianDigits(seedCount)} سند نمونه حذف شوند؟ اسناد واقعی ثبت‌شده توسط شما حفظ خواهند شد.`
                : `آیا مطمئن هستید که همه ${toPersianDigits(expenses.length)} سند موجود در دفتر پاکسازی شوند؟ این عمل قابل بازگشت نیست.`}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={isClearing}
                onClick={handleConfirmClear}
                className="min-h-[38px] px-4 py-1.5 rounded-xl bg-red-600 text-white text-xs font-semibold hover:bg-red-700 disabled:opacity-50 cursor-pointer"
              >
                {isClearing
                  ? 'در حال پاکسازی...'
                  : confirmClearScope === 'samples'
                    ? 'تایید حذف مثال‌ها'
                    : 'تایید حذف همه اسناد'}
              </button>
              <button
                type="button"
                disabled={isClearing}
                onClick={() => setConfirmClearScope(null)}
                className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                انصراف
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={seedCount === 0}
              onClick={() => setConfirmClearScope('samples')}
              className="inline-flex items-center gap-2 min-h-[42px] px-4 py-2 rounded-xl border border-amber-300 bg-amber-50/70 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              <Trash2 className="w-4 h-4 text-amber-700" />
              <span>
                {seedCount > 0
                  ? `پاکسازی مثال‌ها (${toPersianDigits(seedCount)} سند نمونه)`
                  : 'مثال‌ها پاکسازی شده‌اند'}
              </span>
            </button>

            <button
              type="button"
              disabled={expenses.length === 0}
              onClick={() => setConfirmClearScope('all')}
              className="inline-flex items-center gap-2 min-h-[42px] px-4 py-2 rounded-xl border border-red-200 bg-white text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
              <span>پاکسازی کامل همه اسناد ({toPersianDigits(expenses.length)})</span>
            </button>
          </div>
        )}
      </section>))}

      {/* Android PWA Card */}
      {!localMode && group("install","نصب نسخه وب","فقط در مرورگر",(<section className="rounded-2xl bg-white border border-slate-200 p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center shrink-0">
            <Smartphone className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900">نصب اپلیکیشن موبایل (اندروید / iOS)</h2>
            <p className="mt-1 text-xs text-slate-600 leading-relaxed">
              حساب‌یار به عنوان PWA استاندارد طراحی شده است تا روی گوشی اندروید نصب شود، به دوربین دسترسی مستقیم داشته باشد و در حالت آفلاین داده‌های قبلی را نمایش دهد.
            </p>
          </div>
        </div>
        <div className="shrink-0">
          <PWAInstallButton />
        </div>
      </section>))}

      {/* Exchange Rates */}
      {group("rates","نرخ ارز","نرخ پیش‌فرض اسناد ارزی",(<section className="rounded-2xl bg-white border border-slate-200 p-5 space-y-4">
        <div>
          <h2 className="text-base font-bold text-slate-900">نرخ پیش‌فرض تسعیر ارزهای خارجی ({CURRENCY_LABELS[displayUnit]})</h2>
          <p className="mt-1 text-xs text-slate-500">
            این نرخ‌ها به عنوان پیش‌فرض هنگام ثبت سند ارزی جدید استفاده می‌شوند؛ اسناد ثبت‌شده قبلی نرخ تاریخی خود را حفظ می‌کنند.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="rate-usd" className="block text-xs font-semibold text-slate-700 mb-1.5">
              نرخ هر ۱ دلار آمریکا ({CURRENCY_LABELS[displayUnit]})
            </label>
            <input
              id="rate-usd"
              type="number"
              min={1000}
              value={toEntryAmount(localRates.USD, 'IRT', displayUnit)}
              onChange={(e) =>
                setLocalRates((r) => ({ ...r, USD: fromEntryAmount(Number(e.target.value) || 0, 'IRT', displayUnit) }))
              }
              className="w-full min-h-[42px] rounded-xl border border-slate-200 px-3 text-sm font-mono-num text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>
          <div>
            <label htmlFor="rate-eur" className="block text-xs font-semibold text-slate-700 mb-1.5">
              نرخ هر ۱ یورو ({CURRENCY_LABELS[displayUnit]})
            </label>
            <input
              id="rate-eur"
              type="number"
              min={1000}
              value={toEntryAmount(localRates.EUR, 'IRT', displayUnit)}
              onChange={(e) =>
                setLocalRates((r) => ({ ...r, EUR: fromEntryAmount(Number(e.target.value) || 0, 'IRT', displayUnit) }))
              }
              className="w-full min-h-[42px] rounded-xl border border-slate-200 px-3 text-sm font-mono-num text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>
        </div>
      </section>))}

      {/* Category Management & Monthly Budgets */}
      {group("categories","دسته‌بندی و بودجه","حوزه‌های هزینه و سقف ماهانه",(<section className="rounded-2xl bg-white border border-slate-200 p-5 space-y-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center shrink-0">
            <Tags className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">
              مدیریت دسته‌بندی‌ها (حوزه‌های هزینه) و بودجه ماهانه
            </h2>
            <p className="mt-1 text-xs text-slate-600 leading-relaxed">
              دسته‌بندی‌های دلخواه خود را اضافه، ویرایش یا حذف کنید و سقف بودجه ماهانه هر کدام را تنظیم نمایید. تغییرات بلافاصله در داشبورد، دفتر کل، استخراج هوشمند و خروجی اکسل اعمال می‌شود.
            </p>
          </div>
        </div>

        {catError && (
          <div
            role="alert"
            className="rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-xs text-red-900 flex items-center gap-2"
          >
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{catError}</span>
          </div>
        )}

        {/* Add New Category Bar */}
        <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-3">
          <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
            <Plus className="w-4 h-4 text-teal-700" />
            <span>افزودن دسته‌بندی جدید</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
            <div className="sm:col-span-4">
              <label htmlFor="new-category-label" className="block text-[11px] font-semibold text-slate-700 mb-1">
                نام دسته‌بندی *
              </label>
              <input
                id="new-category-label"
                type="text"
                value={newCatLabel}
                onChange={(e) => {
                  setNewCatLabel(e.target.value);
                  if (catError) setCatError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleCreateCategory();
                  }
                }}
                placeholder="مثلاً: آموزش و همایش‌ها"
                className="w-full min-h-[40px] rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>

            <div className="sm:col-span-5">
              <label htmlFor="new-category-desc" className="block text-[11px] font-semibold text-slate-700 mb-1">
                توضیح / کلمات کلیدی برای هوش مصنوعی (اختیاری)
              </label>
              <input
                id="new-category-desc"
                type="text"
                value={newCatDescription}
                onChange={(e) => setNewCatDescription(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleCreateCategory();
                  }
                }}
                placeholder="مثلاً: دوره، سمینار، کتاب، کارگاه"
                className="w-full min-h-[40px] rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>

            <div className="sm:col-span-3">
              <label htmlFor="new-category-budget" className="block text-[11px] font-semibold text-slate-700 mb-1">
                بودجه ماهانه ({CURRENCY_LABELS[displayUnit]})
              </label>
              <input
                id="new-category-budget"
                type="number"
                min={0}
                step={500000}
                value={toEntryAmount(newCatBudget, 'IRT', displayUnit)}
                onChange={(e) => setNewCatBudget(fromEntryAmount(Number(e.target.value) || 0, 'IRT', displayUnit))}
                className="w-full min-h-[40px] rounded-xl border border-slate-200 bg-white px-3 text-sm font-mono-num text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="رنگ دسته‌بندی جدید">
              <span className="text-[11px] font-semibold text-slate-600 ml-1">رنگ:</span>
              {CATEGORY_PALETTE_COLORS.map((swatch) => {
                const selected = newCatColor === swatch.hex;
                return (
                  <button
                    key={swatch.hex}
                    type="button"
                    aria-label={`انتخاب رنگ ${swatch.label}`}
                    aria-pressed={selected}
                    onClick={() => setNewCatColor(swatch.hex)}
                    style={{ backgroundColor: swatch.hex }}
                    className={`w-6 h-6 rounded-full transition-transform cursor-pointer ${
                      selected
                        ? 'ring-2 ring-offset-2 ring-slate-900 scale-110'
                        : 'opacity-80 hover:opacity-100'
                    }`}
                  />
                );
              })}
            </div>

            <button
              type="button"
              disabled={catMutationBusy || !newCatLabel.trim()}
              onClick={handleCreateCategory}
              className="inline-flex items-center gap-1.5 min-h-[40px] px-4 py-2 rounded-xl bg-teal-700 text-white text-xs font-semibold hover:bg-teal-800 disabled:opacity-40 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>{catMutationBusy ? 'در حال افزودن...' : 'افزودن دسته‌بندی'}</span>
            </button>
          </div>
        </div>

        {/* Category List & Per-Category Budgets */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {activeCategories.map((cat) => {
            const val = localBudgets.find((b) => b.category === cat.id)?.monthlyLimitIRT ?? 0;
            const usageCount = categoryUsageCounts.get(cat.id) ?? 0;
            const isEditing = editingCatId === cat.id;
            const isDeleting = deletingCatId === cat.id;
            const remainingCategories = activeCategories.filter((c) => c.id !== cat.id);

            return (
              <div
                key={cat.id}
                className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-3"
              >
                {isEditing ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-teal-800">ویرایش دسته‌بندی</span>
                      <button
                        type="button"
                        aria-label="لغو ویرایش دسته‌بندی"
                        onClick={() => setEditingCatId(null)}
                        className="p-1 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <div>
                      <label htmlFor={`edit-cat-label-${cat.id}`} className="block text-[11px] font-semibold text-slate-700 mb-1">
                        نام دسته‌بندی *
                      </label>
                      <input
                        id={`edit-cat-label-${cat.id}`}
                        type="text"
                        value={editCatLabel}
                        onChange={(e) => setEditCatLabel(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleSaveEditCategory();
                          }
                        }}
                        className="w-full min-h-[38px] rounded-lg border border-slate-200 px-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                      />
                    </div>
                    <div>
                      <label htmlFor={`edit-cat-desc-${cat.id}`} className="block text-[11px] font-semibold text-slate-700 mb-1">
                        کلمات کلیدی برای هوش مصنوعی (اختیاری)
                      </label>
                      <input
                        id={`edit-cat-desc-${cat.id}`}
                        type="text"
                        value={editCatDescription}
                        onChange={(e) => setEditCatDescription(e.target.value)}
                        className="w-full min-h-[38px] rounded-lg border border-slate-200 px-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={`رنگ ${cat.label}`}>
                      {CATEGORY_PALETTE_COLORS.map((swatch) => {
                        const selected = editCatColor === swatch.hex;
                        return (
                          <button
                            key={swatch.hex}
                            type="button"
                            aria-label={`انتخاب رنگ ${swatch.label}`}
                            aria-pressed={selected}
                            onClick={() => setEditCatColor(swatch.hex)}
                            style={{ backgroundColor: swatch.hex }}
                            className={`w-5 h-5 rounded-full cursor-pointer ${
                              selected ? 'ring-2 ring-offset-1 ring-slate-900 scale-110' : 'opacity-80'
                            }`}
                          />
                        );
                      })}
                    </div>
                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setEditingCatId(null)}
                        className="min-h-[34px] px-3 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                      >
                        انصراف
                      </button>
                      <button
                        type="button"
                        disabled={catMutationBusy || !editCatLabel.trim()}
                        onClick={handleSaveEditCategory}
                        className="inline-flex items-center gap-1 min-h-[34px] px-3 rounded-lg bg-teal-700 text-white text-xs font-semibold hover:bg-teal-800 disabled:opacity-40 cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>ذخیره</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-3 h-3 rounded-full shrink-0"
                            style={{ backgroundColor: cat.color }}
                            aria-hidden="true"
                          />
                          <span className="text-sm font-bold text-slate-900 truncate">
                            {cat.label}
                          </span>
                          <span className="text-[11px] font-medium text-slate-500 tabular-nums shrink-0">
                            ({toPersianDigits(usageCount)} سند)
                          </span>
                        </div>
                        {cat.description && (
                          <p className="mt-1 text-[11px] text-slate-500 truncate" title={cat.description}>
                            {cat.description}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          aria-label={`ویرایش دسته‌بندی ${cat.label}`}
                          onClick={() => startEditCategory(cat)}
                          className="min-h-[32px] min-w-[32px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-teal-700 cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label={`حذف دسته‌بندی ${cat.label}`}
                          disabled={activeCategories.length <= 1}
                          onClick={() => startDeleteCategory(cat.id)}
                          title={
                            activeCategories.length <= 1
                              ? 'حداقل یک دسته‌بندی باید باقی بماند'
                              : `حذف ${cat.label}`
                          }
                          className="min-h-[32px] min-w-[32px] flex items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {isDeleting ? (
                      <div className="rounded-lg bg-red-50 border border-red-200 p-3 space-y-2.5">
                        <p className="text-xs text-red-900 font-medium leading-relaxed">
                          {usageCount > 0
                            ? `در این دسته‌بندی ${toPersianDigits(usageCount)} سند ثبت شده است. پس از حذف به کدام دسته‌بندی منتقل شوند؟`
                            : `آیا از حذف دسته‌بندی «${cat.label}» مطمئن هستید؟`}
                        </p>
                        {usageCount > 0 && remainingCategories.length > 0 && (
                          <select
                            aria-label={`انتقال اسناد ${cat.label} به دسته‌بندی`}
                            value={reassignTargetId}
                            onChange={(e) => setReassignTargetId(e.target.value)}
                            className="w-full min-h-[36px] rounded-lg border border-red-200 bg-white px-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-500"
                          >
                            {remainingCategories.map((rc) => (
                              <option key={rc.id} value={rc.id}>
                                {rc.label}
                              </option>
                            ))}
                          </select>
                        )}
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            disabled={catMutationBusy}
                            onClick={() => setDeletingCatId(null)}
                            className="min-h-[34px] px-3 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-700 cursor-pointer"
                          >
                            انصراف
                          </button>
                          <button
                            type="button"
                            disabled={catMutationBusy}
                            onClick={handleConfirmDeleteCategory}
                            className="min-h-[34px] px-3 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 disabled:opacity-50 cursor-pointer"
                          >
                            {catMutationBusy ? 'در حال حذف...' : 'تایید حذف'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <label
                          htmlFor={`budget-${cat.id}`}
                          className="block text-[11px] font-semibold text-slate-600 mb-1"
                        >
                          سقف بودجه ماهانه ({CURRENCY_LABELS[displayUnit]})
                        </label>
                        <input
                          id={`budget-${cat.id}`}
                          type="number"
                          min={0}
                          step={500000}
                          value={toEntryAmount(val, 'IRT', displayUnit)}
                          onChange={(e) => handleBudgetChange(cat.id, fromEntryAmount(Number(e.target.value) || 0, 'IRT', displayUnit))}
                          className="w-full min-h-[40px] rounded-xl border border-slate-200 px-3 text-sm font-mono-num text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                        />
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </section>))}
    </form>
  );
};
