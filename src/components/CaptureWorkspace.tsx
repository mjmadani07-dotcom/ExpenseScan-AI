import { businessDateIso } from '../utils/jalali';
import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Camera,
  Cpu,
  Eye,
  EyeOff,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  KeyRound,
  Loader2,
  PenLine,
  Save,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type {
  AiConfig,
  AiProviderId,
  DisplayUnit,
  AiProviderStatus,
  CategoryDefinition,
  ExchangeRates,
  ExtractedExpenseDraft,
  SourceType,
} from '../types/expense';
import {
  createThumbnailDataUrl,
  fileToCompressedImage,
  renderPdfToImages,
  type RenderedPage,
} from '../utils/pdfRenderer';
import { resolveCategories } from '../utils/finance';
import { toPersianDigits } from '../utils/jalali';
import { extractExpensesDirectlyFromBrowser } from '../utils/clientAiExtract';
import { DEFAULT_AI_BASE_URLS, validateClientBaseUrl } from '../utils/aiUrls';
import { maskApiKey } from '../utils/localKeyVault';

interface CaptureWorkspaceProps {
  categories?: CategoryDefinition[];
  rates: ExchangeRates;
  displayUnit: DisplayUnit;
  aiConfig: AiConfig;
  aiStatus: AiProviderStatus | null;
  localApiKeys: Partial<Record<AiProviderId, string>>;
  onSaveLocalApiKey: (provider: AiProviderId, key: string) => Promise<void>;
  onRemoveLocalApiKey: (provider: AiProviderId) => Promise<void>;
  onSaveAiConfig: (nextConfig: AiConfig) => Promise<void>;
  onOpenSettings: () => void;
  onDraftsReady: (drafts: ExtractedExpenseDraft[], previewPages: string[]) => void;
}

type InputMode = 'file_photo' | 'text';

interface StagedMediaFile {
  kind: 'image' | 'pdf';
  fileName: string;
  fileSizeBytes: number;
  pages: RenderedPage[];
  totalPages: number;
}

const SAMPLE_BANK_SMS = `برداشت از حساب شرکتی ۰۲۱۴۵۸۹۱۲۳
مبلغ: ۴۸,۵۰۰,۰۰۰ ریال
بابت: پرداخت به شرکت داده پردازش پارس (فاکتور ۱۴۲۹)
تاریخ: ۱۴۰۵/۰۹/۰۲ ساعت ۱۴:۲۲
کد پیگیری: ۹۸۴۵۱۲۳۰۶`;

const SAMPLE_MULTI_EXPENSE_TEXT = `گزارش خریدهای تنخواه هفته اول آذر ۱۴۰۵:
۱- خرید لوازم التحریر و کاغذ A4 از شهروند به مبلغ ۲,۸۵۰,۰۰۰ تومان با کارت شرکتی
۲- هزینه پیک و ارسال مرسولات مشتری (الوپیک) مبلغ ۶۴۰,۰۰۰ تومان نقدی
۳- شارژ اینترنت فیبر نوری دفتر مرکزی مخابرات مبلغ ۱,۴۵۰,۰۰۰ تومان در انتظار پرداخت`;

function formatFileSizeFa(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${toPersianDigits((bytes / (1024 * 1024)).toFixed(1))} مگابایت`;
  }
  return `${toPersianDigits(Math.max(1, Math.round(bytes / 1024)))} کیلوبایت`;
}

export const CaptureWorkspace: React.FC<CaptureWorkspaceProps> = ({
  categories,
  rates,
  displayUnit,
  aiConfig,
  aiStatus,
  localApiKeys,
  onSaveLocalApiKey,
  onRemoveLocalApiKey,
  onSaveAiConfig,
  onOpenSettings,
  onDraftsReady,
}) => {
  const activeCategories = resolveCategories(categories);
  const [mode, setMode] = useState<InputMode>('file_photo');
  const [rawText, setRawText] = useState('');
  const [textFileName, setTextFileName] = useState<string | undefined>(undefined);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [stagedFile, setStagedFile] = useState<StagedMediaFile | null>(null);
  const [selectedAi, setSelectedAi] = useState<AiConfig>(aiConfig);
  const [showQuickKeyBox, setShowQuickKeyBox] = useState(false);
  const [quickKeyInput, setQuickKeyInput] = useState('');
  const [showQuickKeyText, setShowQuickKeyText] = useState(false);
  const [isSavingEndpoint, setIsSavingEndpoint] = useState(false);

  useEffect(() => {
    setSelectedAi(aiConfig);
  }, [aiConfig]);

  const activeCustomBaseUrl =
    selectedAi.baseUrls?.[selectedAi.provider] ??
    (selectedAi.provider === aiConfig.provider ? selectedAi.baseUrl ?? '' : '');

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const textFileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const preparationCancelledRef = useRef(false);

  const clearInputValues = () => {
    if (cameraInputRef.current) cameraInputRef.current.value = '';
    if (imageInputRef.current) imageInputRef.current.value = '';
    if (pdfInputRef.current) pdfInputRef.current.value = '';
    if (textFileInputRef.current) textFileInputRef.current.value = '';
  };

  const handleRemoveStagedFile = () => {
    preparationCancelledRef.current = true;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setStagedFile(null);
    setErrorMessage(null);
    setStatusMessage(null);
    setIsProcessing(false);
    clearInputValues();
  };

  const handleRemoveTextFile = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setTextFileName(undefined);
    setRawText('');
    setErrorMessage(null);
    setStatusMessage(null);
    setIsProcessing(false);
    clearInputValues();
  };

  const runExtraction = async (params: {
    pages?: RenderedPage[];
    text?: string;
    sType: SourceType;
    fileName?: string;
    totalPages?: number;
  }) => {
    setErrorMessage(null);
    setIsProcessing(true);
    const localKey = localApiKeys[selectedAi.provider]?.trim();
    setStatusMessage(
      localKey
        ? 'در حال ارتباط مستقیم از دستگاه برای استخراج جزئیات فاکتور و هزینه...'
        : 'در حال استخراج ساختاریافته جزئیات فاکتور و هزینه...'
    );

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      let extractedList: Array<
        Omit<
          ExtractedExpenseDraft,
          'tempId' | 'selected' | 'sourceType' | 'sourceFileName' | 'sourcePreviewUrl' | 'pageCount'
        >
      > = [];

      const validatedBaseUrl = validateClientBaseUrl(activeCustomBaseUrl);

      if (localKey) {
        extractedList = await extractExpensesDirectlyFromBrowser({
          provider: selectedAi.provider,
          model: selectedAi.model,
          apiKey: localKey,
          baseUrl: validatedBaseUrl,
          categories: activeCategories,
          images: params.pages?.map((p) => ({
            mimeType: p.mimeType,
            data: p.base64,
          })),
          text: params.text,
          fileName: params.fileName,
          signal: controller.signal,
        });
      } else {
        const response = await fetch('/api/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            images: params.pages?.map((p) => ({
              mimeType: p.mimeType,
              data: p.base64,
              pageNumber: p.pageNumber,
            })),
            text: params.text,
            sourceType: params.sType,
            fileName: params.fileName,
            provider: selectedAi.provider,
            model: selectedAi.model,
            baseUrl: validatedBaseUrl,
            categories: activeCategories,
          }),
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'خطا در ارتباط با سرور استخراج سند');
        }
        extractedList = data.expenses ?? [];
      }

      const previewThumb = params.pages?.[0]
        ? await createThumbnailDataUrl(params.pages[0].dataUrl)
        : undefined;

      const drafts: ExtractedExpenseDraft[] = extractedList.map(
        (item, idx: number) => {
          const defaultRate =
            item.currency === 'USD' || item.currency === 'EUR'
              ? item.exchangeRateToToman && item.exchangeRateToToman > 0
                ? item.exchangeRateToToman
                : rates[item.currency]
              : undefined;

          return {
            ...item,
            exchangeRateToToman: defaultRate,
            tempId: `draft-${Date.now()}-${idx}`,
            selected: true,
            sourceType: params.sType,
            sourceFileName: params.fileName,
            sourcePreviewUrl: previewThumb,
            pageCount: params.totalPages ?? params.pages?.length,
          };
        }
      );

      if (drafts.length === 0) {
        throw new Error('هیچ هزینه قابل ثبتی از این ورودی استخراج نشد.');
      }

      onDraftsReady(
        drafts,
        params.pages?.map((p) => p.dataUrl) ?? []
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      const msg = err instanceof Error ? err.message : 'خطا در تحلیل سند';
      setErrorMessage(msg);
    } finally {
      abortControllerRef.current = null;
      setIsProcessing(false);
      setStatusMessage(null);
    }
  };

  const handleImageSelected = async (file: File) => {
    setErrorMessage(null);
    preparationCancelledRef.current = false;
    setIsProcessing(true);
    setStatusMessage('در حال آماده‌سازی پیش‌نمایش تصویر...');
    try {
      const compressed = await fileToCompressedImage(file);
      if (preparationCancelledRef.current) return;
      setStagedFile({
        kind: 'image',
        fileName: file.name,
        fileSizeBytes: file.size,
        pages: [compressed],
        totalPages: 1,
      });
    } catch (err) {
      if (!preparationCancelledRef.current) {
        setErrorMessage(err instanceof Error ? err.message : 'خطا در خواندن فایل تصویر');
      }
    } finally {
      setIsProcessing(false);
      setStatusMessage(null);
    }
  };

  const handlePdfSelected = async (file: File) => {
    setErrorMessage(null);
    preparationCancelledRef.current = false;
    setIsProcessing(true);
    setStatusMessage('در حال تبدیل صفحات PDF به تصویر باکیفیت...');
    try {
      const { pages, totalPages } = await renderPdfToImages(file, (curr, total) => {
        if (!preparationCancelledRef.current) {
          setStatusMessage(
            `در حال تبدیل صفحه ${toPersianDigits(curr)} از ${toPersianDigits(total)} PDF به تصویر...`
          );
        }
      });
      if (preparationCancelledRef.current) return;
      setStagedFile({
        kind: 'pdf',
        fileName: file.name,
        fileSizeBytes: file.size,
        pages,
        totalPages,
      });
    } catch (err) {
      if (!preparationCancelledRef.current) {
        setErrorMessage(err instanceof Error ? err.message : 'خطا در تبدیل PDF به تصویر');
      }
    } finally {
      setIsProcessing(false);
      setStatusMessage(null);
    }
  };

  const handleTextFileSelected = async (file: File) => {
    setErrorMessage(null);
    try {
      const text = await file.text();
      if (!text.trim()) {
        setErrorMessage('فایل متنی انتخاب‌شده خالی است.');
        return;
      }
      setMode('text');
      setRawText(text);
      setTextFileName(file.name);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'خطا در خواندن فایل متنی');
    }
  };

  const handleCreateManualDraft = () => {
    const today = businessDateIso();
    const defaultCategory = activeCategories.some((c) => c.id === 'operations')
      ? 'operations'
      : activeCategories[0]?.id ?? 'other';
    onDraftsReady(
      [
        {
          tempId: `manual-${Date.now()}`,
          selected: true,
          title: '',
          vendor: '',
          documentType: 'invoice',
          category: defaultCategory,
          costCenter: 'general',
          amount: 0,
          currency: displayUnit,
          taxAmount: 0,
          discountAmount: 0,
          date: today,
          paymentMethod: 'corporate_card',
          paymentStatus: 'paid',
          lineItems: [],
          sourceType: 'text',
        },
      ],
      []
    );
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 text-balance">
            ثبت سند، عکس، PDF یا متن هزینه
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            سند را انتخاب کنید؛ پیش از تحلیل یا ثبت نهایی می‌توانید فایل انتخاب‌شده را بررسی یا حذف کنید.
          </p>
        </div>

        <button
          type="button"
          onClick={handleCreateManualDraft}
          className="inline-flex items-center justify-center gap-2 min-h-[42px] px-4 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <PenLine className="w-4 h-4 text-slate-500" />
          <span>ورود دستی فرم هزینه</span>
        </button>
      </div>

      {/* Active AI Provider / Model Quick Switcher + Quick Device Key & Base URL */}
      <div className="rounded-2xl bg-white border border-slate-200 px-4 py-3 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-700">
            <Cpu className="w-4 h-4 text-teal-700 shrink-0" />
            <span className="font-semibold">موتور هوش مصنوعی:</span>
            {localApiKeys[selectedAi.provider] ? (
              <span className="font-semibold text-emerald-700">
                کلید شخصی دستگاه فعال (ارتباط مستقیم)
              </span>
            ) : aiStatus?.configured[selectedAi.provider] ? (
              <span className="font-semibold text-teal-700">آماده در سرور</span>
            ) : (
              <span className="font-semibold text-amber-700">کلید وارد نشده</span>
            )}
            {activeCustomBaseUrl.trim() && (
              <span className="text-[11px] font-medium text-slate-500">
                · Base URL سفارشی
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="انتخاب سرویس هوش مصنوعی"
              value={selectedAi.provider}
              onChange={(e) => {
                const provId = e.target.value as AiProviderId;
                const info = aiStatus?.providers.find((p) => p.id === provId);
                const defaultM =
                  info?.defaultModel ??
                  (provId === 'openai'
                    ? 'gpt-4o-mini'
                    : provId === 'openrouter'
                      ? 'google/gemini-2.5-flash'
                      : 'gemini-4-hydrogen');
                setSelectedAi((prev) => ({
                  ...prev,
                  provider: provId,
                  model: defaultM,
                  baseUrl: prev.baseUrls?.[provId],
                }));
                setQuickKeyInput('');
              }}
              className="min-h-[36px] rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-600"
            >
              <option value="gemini">Google Gemini</option>
              <option value="openai">OpenAI (ChatGPT)</option>
              <option value="openrouter">OpenRouter</option>
            </select>

            <input
              type="text"
              aria-label="نام مدل هوش مصنوعی"
              value={selectedAi.model}
              onChange={(e) => setSelectedAi((prev) => ({ ...prev, model: e.target.value }))}
              className="w-40 sm:w-48 min-h-[36px] rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-mono-num text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-600"
            />

            <button
              type="button"
              onClick={() => setShowQuickKeyBox((v) => !v)}
              className="inline-flex items-center gap-1.5 min-h-[36px] px-3 py-1 rounded-lg border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
            >
              <KeyRound className="w-3.5 h-3.5 text-teal-700" />
              <span>تنظیم کلید و Base URL</span>
            </button>
          </div>
        </div>

        {showQuickKeyBox && (
          <div className="pt-3 border-t border-slate-100 space-y-3">
            {/* Quick Base URL Editor */}
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <label htmlFor="quick-base-url" className="font-semibold text-slate-700">
                  آدرس پایه سرور (Base URL) برای {selectedAi.provider.toUpperCase()} (اختیاری)
                </label>
                {activeCustomBaseUrl.trim() && (
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedAi((prev) => {
                        const nextMap = { ...(prev.baseUrls ?? {}) };
                        delete nextMap[prev.provider];
                        return { ...prev, baseUrl: undefined, baseUrls: nextMap };
                      })
                    }
                    className="text-[11px] font-semibold text-slate-600 hover:text-red-600 cursor-pointer"
                  >
                    بازنشانی به پیش‌فرض
                  </button>
                )}
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  id="quick-base-url"
                  type="text"
                  inputMode="url"
                  dir="ltr"
                  spellCheck={false}
                  value={activeCustomBaseUrl}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSelectedAi((prev) => {
                      const nextMap = { ...(prev.baseUrls ?? {}) };
                      if (val) nextMap[prev.provider] = val;
                      else delete nextMap[prev.provider];
                      return { ...prev, baseUrl: val || undefined, baseUrls: nextMap };
                    });
                  }}
                  placeholder={DEFAULT_AI_BASE_URLS[selectedAi.provider]}
                  className="flex-1 min-h-[38px] rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-mono-num text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:bg-white"
                />
                <button
                  type="button"
                  disabled={isSavingEndpoint}
                  onClick={async () => {
                    setErrorMessage(null);
                    setIsSavingEndpoint(true);
                    try {
                      const clean = validateClientBaseUrl(activeCustomBaseUrl);
                      const nextMap = { ...(selectedAi.baseUrls ?? {}) };
                      if (clean) nextMap[selectedAi.provider] = clean;
                      else delete nextMap[selectedAi.provider];
                      const nextConfig: AiConfig = {
                        provider: selectedAi.provider,
                        model: selectedAi.model.trim() || 'gemini-4-hydrogen',
                        ...(clean ? { baseUrl: clean } : {}),
                        ...(Object.keys(nextMap).length > 0 ? { baseUrls: nextMap } : {}),
                      };
                      await onSaveAiConfig(nextConfig);
                      setSelectedAi(nextConfig);
                    } catch (err) {
                      setErrorMessage(
                        err instanceof Error ? err.message : 'آدرس Base URL معتبر نیست'
                      );
                    } finally {
                      setIsSavingEndpoint(false);
                    }
                  }}
                  className="inline-flex items-center justify-center gap-1.5 min-h-[38px] px-4 py-1.5 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-40 cursor-pointer shrink-0"
                >
                  <Save className="w-3.5 h-3.5 text-teal-700" />
                  <span>{isSavingEndpoint ? 'در حال ذخیره...' : 'ذخیره مدل و Base URL'}</span>
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs pt-2 border-t border-slate-100">
              <span className="font-semibold text-slate-700">
                کلید شخصی محلی برای {selectedAi.provider.toUpperCase()} (فقط در این گوشی/مرورگر ذخیره می‌شود)
              </span>
              <div className="flex items-center gap-2">
                {localApiKeys[selectedAi.provider] && (
                  <>
                    <span dir="ltr" className="font-mono-num text-[11px] text-emerald-700 font-semibold">
                      {maskApiKey(localApiKeys[selectedAi.provider])}
                    </span>
                    <button
                      type="button"
                      onClick={() => onRemoveLocalApiKey(selectedAi.provider)}
                      className="text-[11px] font-semibold text-red-600 hover:underline cursor-pointer"
                    >
                      حذف کلید
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={onOpenSettings}
                  className="text-[11px] font-semibold text-teal-700 hover:underline cursor-pointer"
                >
                  تنظیمات کامل
                </button>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <input
                  type={showQuickKeyText ? 'text' : 'password'}
                  dir="ltr"
                  autoComplete="off"
                  spellCheck={false}
                  value={quickKeyInput}
                  onChange={(e) => setQuickKeyInput(e.target.value)}
                  placeholder={
                    selectedAi.provider === 'openai'
                      ? 'sk-...'
                      : selectedAi.provider === 'openrouter'
                        ? 'sk-or-v1-...'
                        : 'AIza...'
                  }
                  className="w-full min-h-[38px] rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-xs font-mono-num text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:bg-white"
                />
                <button
                  type="button"
                  aria-label={showQuickKeyText ? 'مخفی کردن کلید' : 'نمایش کلید'}
                  onClick={() => setShowQuickKeyText((v) => !v)}
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-800 cursor-pointer"
                >
                  {showQuickKeyText ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <button
                type="button"
                disabled={!quickKeyInput.trim()}
                onClick={async () => {
                  await onSaveLocalApiKey(selectedAi.provider, quickKeyInput.trim());
                  setQuickKeyInput('');
                  setShowQuickKeyBox(false);
                }}
                className="inline-flex items-center justify-center gap-1.5 min-h-[38px] px-4 py-1.5 rounded-xl bg-teal-700 text-white text-xs font-semibold hover:bg-teal-800 disabled:opacity-40 cursor-pointer shrink-0"
              >
                <Save className="w-3.5 h-3.5" />
                <span>ذخیره کلید روی دستگاه</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Segmented Mode Switcher */}
      <div className="inline-flex p-1 bg-slate-100 rounded-xl border border-slate-200/80">
        <button
          type="button"
          onClick={() => setMode('file_photo')}
          className={`min-h-[40px] px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-colors cursor-pointer ${
            mode === 'file_photo'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          عکس، دوربین و PDF
        </button>
        <button
          type="button"
          onClick={() => setMode('text')}
          className={`min-h-[40px] px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-colors cursor-pointer ${
            mode === 'text'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          متن آزاد و فایل متنی
        </button>
      </div>

      {errorMessage && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-2xl bg-red-50 border border-red-200 p-4 text-sm text-red-900"
        >
          <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="font-semibold">امکان استخراج خودکار وجود نداشت</div>
            <p className="mt-1 text-xs text-red-800 leading-relaxed">{errorMessage}</p>
          </div>
          <button
            type="button"
            aria-label="بستن پیام خطا"
            onClick={() => setErrorMessage(null)}
            className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg text-red-700 hover:bg-red-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {isProcessing && (
        <div
          role="status"
          className="rounded-2xl bg-teal-50 border border-teal-200 p-6 flex flex-col items-center justify-center text-center"
        >
          <Loader2 className="w-8 h-8 text-teal-700 animate-spin mb-3" />
          <div className="text-sm font-bold text-teal-950">
            {statusMessage ?? 'در حال پردازش...'}
          </div>
          {stagedFile && stagedFile.pages.length > 0 && (
            <div className="mt-4 flex items-center gap-2 overflow-x-auto max-w-full pb-1">
              {stagedFile.pages.map((p) => (
                <div key={p.pageNumber} className="shrink-0 text-center">
                  <img
                    src={p.dataUrl}
                    alt={`صفحه ${p.pageNumber}`}
                    className="h-24 w-auto rounded-lg border border-teal-200 object-contain bg-white"
                  />
                  <span className="block mt-1 text-[11px] text-teal-800">
                    صفحه {toPersianDigits(p.pageNumber)}
                  </span>
                </div>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={handleRemoveStagedFile}
            className="mt-4 inline-flex items-center gap-1.5 min-h-[40px] px-4 py-2 rounded-xl border border-red-200 bg-white text-xs font-semibold text-red-700 hover:bg-red-50 transition-colors cursor-pointer"
          >
            <Trash2 className="w-4 h-4" />
            <span>لغو و حذف فایل</span>
          </button>
        </div>
      )}

      {/* Staged Image / PDF Preview Card with explicit Remove + Extract actions */}
      {mode === 'file_photo' && !isProcessing && stagedFile && (
        <div className="rounded-2xl bg-white border border-slate-200 p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-slate-100">
            <div>
              <div className="text-xs font-semibold text-teal-700">فایل آماده تحلیل</div>
              <h2 className="mt-0.5 text-base font-bold text-slate-900 break-all">
                {stagedFile.fileName}
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 tabular-nums">
                {stagedFile.kind === 'pdf'
                  ? `فایل PDF · ${toPersianDigits(stagedFile.pages.length)} صفحه تبدیل‌شده به تصویر`
                  : 'فایل تصویر'}
                {' · '}
                {formatFileSizeFa(stagedFile.fileSizeBytes)}
              </p>
            </div>

            <button
              type="button"
              onClick={handleRemoveStagedFile}
              className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 py-2 rounded-xl border border-red-200 bg-red-50/70 text-xs font-semibold text-red-700 hover:bg-red-100 transition-colors cursor-pointer shrink-0"
            >
              <Trash2 className="w-4 h-4" />
              <span>حذف فایل</span>
            </button>
          </div>

          <div className="flex items-center gap-3 overflow-x-auto pb-1">
            {stagedFile.pages.map((p) => (
              <div key={p.pageNumber} className="shrink-0 text-center">
                <img
                  src={p.dataUrl}
                  alt={`پیش‌نمایش صفحه ${p.pageNumber}`}
                  className="h-44 w-auto rounded-xl border border-slate-200 object-contain bg-slate-50"
                />
                {stagedFile.pages.length > 1 && (
                  <span className="block mt-1 text-[11px] text-slate-600 tabular-nums">
                    صفحه {toPersianDigits(p.pageNumber)}
                  </span>
                )}
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={handleRemoveStagedFile}
              className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
            >
              انتخاب فایل دیگر
            </button>
            <button
              type="button"
              onClick={() =>
                runExtraction({
                  pages: stagedFile.pages,
                  sType: stagedFile.kind,
                  fileName: stagedFile.fileName,
                  totalPages: stagedFile.totalPages,
                })
              }
              className="inline-flex items-center gap-2 min-h-[44px] px-5 py-2.5 rounded-xl bg-teal-700 text-white text-sm font-semibold hover:bg-teal-800 transition-colors cursor-pointer"
            >
              <Sparkles className="w-4 h-4" />
              <span>تحلیل و استخراج ساختاریافته</span>
            </button>
          </div>
        </div>
      )}

      {/* Hidden Native File Inputs (always mounted so mode switching or replacement works cleanly) */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleImageSelected(f);
          e.target.value = '';
        }}
      />
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleImageSelected(f);
          e.target.value = '';
        }}
      />
      <input
        ref={pdfInputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handlePdfSelected(f);
          e.target.value = '';
        }}
      />
      <input
        ref={textFileInputRef}
        type="file"
        accept=".txt,.csv,.json,.md,.log,.xml,.html,text/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleTextFileSelected(f);
          e.target.value = '';
        }}
      />

      {mode === 'file_photo' && !isProcessing && !stagedFile && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Card 1: Android Camera */}
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            className="min-h-[120px] rounded-2xl bg-teal-700 text-white p-5 text-right flex flex-col justify-between hover:bg-teal-800 transition-colors cursor-pointer"
          >
            <div className="w-11 h-11 rounded-xl bg-white/15 flex items-center justify-center">
              <Camera className="w-6 h-6" />
            </div>
            <div className="mt-4">
              <div className="text-base font-bold">عکاسی مستقیم با دوربین</div>
              <p className="mt-1 text-xs text-teal-100">
                ثبت فوری فاکتور کاغذی، رسید کارتخوان یا قبض با دوربین موبایل
              </p>
            </div>
          </button>

          {/* Card 2: PDF with Auto Page-to-Image Rendering */}
          <button
            type="button"
            onClick={() => pdfInputRef.current?.click()}
            className="min-h-[120px] rounded-2xl bg-white border border-slate-200 p-5 text-right flex flex-col justify-between hover:border-teal-500 hover:bg-slate-50/60 transition-colors cursor-pointer"
          >
            <div className="w-11 h-11 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center">
              <FileText className="w-6 h-6" />
            </div>
            <div className="mt-4">
              <div className="text-base font-bold text-slate-900">
                انتخاب فایل PDF فاکتور
              </div>
              <p className="mt-1 text-xs text-slate-600 leading-relaxed">
                تبدیل خودکار تک‌تک صفحات PDF به تصویر باکیفیت پیش از استخراج متن برای خوانش دقیق جدول‌ها
              </p>
            </div>
          </button>

          {/* Card 3: Gallery Image */}
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            className="min-h-[112px] rounded-2xl bg-white border border-slate-200 p-5 text-right flex flex-col justify-between hover:border-teal-500 hover:bg-slate-50/60 transition-colors cursor-pointer"
          >
            <div className="w-11 h-11 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center">
              <ImageIcon className="w-6 h-6" />
            </div>
            <div className="mt-4">
              <div className="text-base font-bold text-slate-900">
                انتخاب عکس یا اسکرین‌شات
              </div>
              <p className="mt-1 text-xs text-slate-600">
                اسکرین‌شات رسید انتقال وجه بانکی، تصویر فاکتور از گالری یا پیام‌رسان
              </p>
            </div>
          </button>

          {/* Card 4: Text File */}
          <button
            type="button"
            onClick={() => textFileInputRef.current?.click()}
            className="min-h-[112px] rounded-2xl bg-white border border-slate-200 p-5 text-right flex flex-col justify-between hover:border-teal-500 hover:bg-slate-50/60 transition-colors cursor-pointer"
          >
            <div className="w-11 h-11 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center">
              <FileSpreadsheet className="w-6 h-6" />
            </div>
            <div className="mt-4">
              <div className="text-base font-bold text-slate-900">
                فایل متنی، گزارش یا CSV
              </div>
              <p className="mt-1 text-xs text-slate-600">
                فایل‌های TXT، CSV، JSON یا Markdown شامل یک یا چند ردیف هزینه
              </p>
            </div>
          </button>
        </div>
      )}

      {mode === 'text' && !isProcessing && (
        <div className="rounded-2xl bg-white border border-slate-200 p-5 space-y-4">
          {textFileName && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-teal-50 border border-teal-200 px-3.5 py-2.5 text-xs text-teal-950">
              <span>
                فایل متنی انتخاب‌شده: <strong className="font-bold">{textFileName}</strong>
              </span>
              <button
                type="button"
                onClick={handleRemoveTextFile}
                className="inline-flex items-center gap-1 min-h-[34px] px-3 py-1 rounded-lg bg-white border border-red-200 text-red-700 font-semibold hover:bg-red-50 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>حذف فایل</span>
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="expense-raw-text" className="text-sm font-bold text-slate-900">
              متن فاکتور، پیامک بانکی یا شرح خریدها
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setRawText(SAMPLE_BANK_SMS);
                  setTextFileName(undefined);
                }}
                className="min-h-[34px] px-3 py-1 rounded-lg bg-slate-100 text-xs font-medium text-slate-700 hover:bg-slate-200 transition-colors cursor-pointer"
              >
                نمونه پیامک بانکی
              </button>
              <button
                type="button"
                onClick={() => {
                  setRawText(SAMPLE_MULTI_EXPENSE_TEXT);
                  setTextFileName(undefined);
                }}
                className="min-h-[34px] px-3 py-1 rounded-lg bg-slate-100 text-xs font-medium text-slate-700 hover:bg-slate-200 transition-colors cursor-pointer"
              >
                نمونه لیست چند هزینه
              </button>
            </div>
          </div>

          <textarea
            id="expense-raw-text"
            rows={7}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder="متن پیامک واریز یا برداشت بانکی، جزئیات فاکتور کپی‌شده یا لیست خریدهای تنخواه را اینجا قرار دهید..."
            className="w-full rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:bg-white"
          />

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => textFileInputRef.current?.click()}
                className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
              >
                <Upload className="w-4 h-4" />
                <span>بارگذاری فایل متنی (.txt / .csv)</span>
              </button>
              {(rawText.trim() || textFileName) && (
                <button
                  type="button"
                  onClick={handleRemoveTextFile}
                  className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-600 hover:text-red-700 hover:border-red-200 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>پاک کردن متن</span>
                </button>
              )}
            </div>

            <button
              type="button"
              disabled={!rawText.trim()}
              onClick={() =>
                runExtraction({
                  text: rawText,
                  sType: textFileName ? 'text_file' : 'text',
                  fileName: textFileName,
                })
              }
              className="min-h-[44px] px-6 py-2.5 rounded-xl bg-teal-700 text-white text-sm font-semibold hover:bg-teal-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              تحلیل و استخراج ساختاریافته
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
