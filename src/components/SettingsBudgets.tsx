import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Cpu,
  Eye,
  EyeOff,
  KeyRound,
  Save,
  ShieldAlert,
  Smartphone,
  Trash2,
} from 'lucide-react';
import type {
  AiConfig,
  AiProviderId,
  AiProviderStatus,
  CategoryBudget,
  ExchangeRates,
  ExpenseCategory,
  ExpenseRecord,
  JsonImportMode,
  JsonImportStats,
} from '../types/expense';
import { CATEGORY_LABELS, countSeedExpenses } from '../utils/finance';
import { toPersianDigits } from '../utils/jalali';
import { maskApiKey } from '../utils/localKeyVault';
import { JsonSyncPanel } from './JsonSyncPanel';
import { PWAInstallButton } from './PWAInstallButton';

interface SettingsBudgetsProps {
  budgets: CategoryBudget[];
  rates: ExchangeRates;
  expenses: ExpenseRecord[];
  aiConfig: AiConfig;
  aiStatus: AiProviderStatus | null;
  localApiKeys: Partial<Record<AiProviderId, string>>;
  onSaveLocalApiKey: (provider: AiProviderId, key: string) => Promise<void>;
  onRemoveLocalApiKey: (provider: AiProviderId) => Promise<void>;
  onClearLedger: (scope: 'samples' | 'all') => Promise<number>;
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
    suggestedModels: ['gemini-4-hydrogen', 'gemini-3.1-flash-lite', 'gemini-2.5-flash'],
  },
  {
    id: 'openai' as AiProviderId,
    label: 'OpenAI (ChatGPT)',
    envVarName: 'OPENAI_API_KEY',
    defaultModel: 'gpt-4o-mini',
    suggestedModels: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
  },
  {
    id: 'openrouter' as AiProviderId,
    label: 'OpenRouter (Multi-Model)',
    envVarName: 'OPENROUTER_API_KEY',
    defaultModel: 'google/gemini-2.5-flash',
    suggestedModels: [
      'google/gemini-2.5-flash',
      'openai/gpt-4o-mini',
      'anthropic/claude-3.5-sonnet',
    ],
  },
];

export const SettingsBudgets: React.FC<SettingsBudgetsProps> = ({
  budgets,
  rates,
  expenses,
  aiConfig,
  aiStatus,
  localApiKeys,
  onSaveLocalApiKey,
  onRemoveLocalApiKey,
  onClearLedger,
  onSaveSettings,
  onImportJson,
}) => {
  const [localBudgets, setLocalBudgets] = useState<CategoryBudget[]>(budgets);
  const [localRates, setLocalRates] = useState<ExchangeRates>(rates);
  const [localAiConfig, setLocalAiConfig] = useState<AiConfig>(aiConfig);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isSavingKey, setIsSavingKey] = useState(false);
  const [confirmClearScope, setConfirmClearScope] = useState<'samples' | 'all' | null>(null);
  const [isClearing, setIsClearing] = useState(false);

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
  const seedCount = countSeedExpenses(expenses);

  const handleSelectProvider = (providerId: AiProviderId) => {
    const info = providersList.find((p) => p.id === providerId) ?? providersList[0];
    setLocalAiConfig({
      provider: providerId,
      model: info.defaultModel,
    });
    setKeyInput('');
    setShowKey(false);
  };

  const handleSaveDeviceKey = async () => {
    const trimmed = keyInput.trim();
    if (!trimmed) return;
    setIsSavingKey(true);
    try {
      await onSaveLocalApiKey(localAiConfig.provider, trimmed);
      setKeyInput('');
      setShowKey(false);
    } finally {
      setIsSavingKey(false);
    }
  };

  const handleRemoveDeviceKey = async () => {
    setIsSavingKey(true);
    try {
      await onRemoveLocalApiKey(localAiConfig.provider);
      setKeyInput('');
    } finally {
      setIsSavingKey(false);
    }
  };

  const handleConfirmClear = async () => {
    if (!confirmClearScope) return;
    setIsClearing(true);
    try {
      await onClearLedger(confirmClearScope);
      setConfirmClearScope(null);
    } finally {
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

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSavedNotice(false);
    await onSaveSettings(localBudgets, localRates, localAiConfig);
    setSaving(false);
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 3000);
  };

  return (
    <form onSubmit={handleSave} className="max-w-4xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
            بودجه‌بندی، هوش مصنوعی و همگام‌سازی
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            سرویس استخراج هوشمند، بودجه حوزه‌ها، نرخ ارز و ورود/خروجی JSON را مدیریت کنید.
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

      {/* Multi-AI Provider Settings */}
      <section className="rounded-2xl bg-white border border-slate-200 p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center shrink-0">
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">
              انتخاب سرویس هوش مصنوعی (Gemini / OpenAI / OpenRouter)
            </h2>
            <p className="mt-1 text-xs text-slate-600 leading-relaxed">
              موتور پیش‌فرض برای تحلیل فاکتور، PDF و متن را انتخاب کنید و کلید API شخصی خود را مستقیماً روی همین گوشی/مرورگر ذخیره کنید تا برنامه کاملاً محلی هم کار کند.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {providersList.map((prov) => {
            const isSelected = localAiConfig.provider === prov.id;
            const hasLocalKey = Boolean(localApiKeys[prov.id]);
            const hasServerKey = aiStatus?.configured[prov.id] ?? false;
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

          <div className="flex items-start gap-2 text-[11px] text-slate-600 leading-relaxed">
            <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              کلید شخصی شما با رمزنگاری محلی (<span className="font-mono-num">AES-GCM</span>) فقط در حافظه امن همین گوشی/مرورگر نگهداری می‌شود، به سرور ارسال نمی‌گردد و در خروجی JSON قرار نمی‌گیرد. توجه امنیتی: ذخیره کلید در مرورگر به معنای دسترسی به آن از طریق همین پروفایل دستگاه است؛ لذا فقط روی گوشی یا رایانه شخصی خودتان ذخیره کنید و در دستگاه‌های مشترک از دکمه حذف کلید استفاده نمایید.
            </div>
          </div>
        </div>
      </section>

      {/* JSON Export & Import (Merge / Replace) */}
      <section className="rounded-2xl bg-white border border-slate-200 p-5">
        <JsonSyncPanel
          expenses={expenses}
          budgets={localBudgets}
          rates={localRates}
          onImportJson={onImportJson}
        />
      </section>

      {/* Clear Sample / Seed Data & Start Fresh */}
      <section className="rounded-2xl bg-white border border-slate-200 p-5 space-y-4">
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
      </section>

      {/* Android PWA Card */}
      <section className="rounded-2xl bg-white border border-slate-200 p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
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
      </section>

      {/* Exchange Rates */}
      <section className="rounded-2xl bg-white border border-slate-200 p-5 space-y-4">
        <div>
          <h2 className="text-base font-bold text-slate-900">نرخ پیش‌فرض تسعیر ارزهای خارجی (به تومان)</h2>
          <p className="mt-1 text-xs text-slate-500">
            این نرخ‌ها به عنوان پیش‌فرض هنگام ثبت سند ارزی جدید استفاده می‌شوند؛ اسناد ثبت‌شده قبلی نرخ تاریخی خود را حفظ می‌کنند.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="rate-usd" className="block text-xs font-semibold text-slate-700 mb-1.5">
              نرخ هر ۱ دلار آمریکا (تومان)
            </label>
            <input
              id="rate-usd"
              type="number"
              min={1000}
              value={localRates.USD}
              onChange={(e) =>
                setLocalRates((r) => ({ ...r, USD: Number(e.target.value) || 0 }))
              }
              className="w-full min-h-[42px] rounded-xl border border-slate-200 px-3 text-sm font-mono-num text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>
          <div>
            <label htmlFor="rate-eur" className="block text-xs font-semibold text-slate-700 mb-1.5">
              نرخ هر ۱ یورو (تومان)
            </label>
            <input
              id="rate-eur"
              type="number"
              min={1000}
              value={localRates.EUR}
              onChange={(e) =>
                setLocalRates((r) => ({ ...r, EUR: Number(e.target.value) || 0 }))
              }
              className="w-full min-h-[42px] rounded-xl border border-slate-200 px-3 text-sm font-mono-num text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>
        </div>
      </section>

      {/* Category Monthly Budgets */}
      <section className="rounded-2xl bg-white border border-slate-200 p-5 space-y-4">
        <h2 className="text-base font-bold text-slate-900">سقف بودجه ماهانه حوزه‌های هزینه (تومان)</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {(Object.keys(CATEGORY_LABELS) as ExpenseCategory[]).map((cat) => {
            const val = localBudgets.find((b) => b.category === cat)?.monthlyLimitIRT ?? 0;
            return (
              <div key={cat}>
                <label
                  htmlFor={`budget-${cat}`}
                  className="block text-xs font-semibold text-slate-700 mb-1.5"
                >
                  {CATEGORY_LABELS[cat]}
                </label>
                <input
                  id={`budget-${cat}`}
                  type="number"
                  min={0}
                  step={500000}
                  value={val}
                  onChange={(e) => handleBudgetChange(cat, Number(e.target.value) || 0)}
                  className="w-full min-h-[42px] rounded-xl border border-slate-200 px-3 text-sm font-mono-num text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>
            );
          })}
        </div>
      </section>
    </form>
  );
};
