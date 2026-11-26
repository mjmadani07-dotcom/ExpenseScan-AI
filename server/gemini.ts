import { businessDateIso } from '../src/utils/jalali.ts';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type {
  AiConfig,
  AiProviderId,
  AiProviderInfo,
  AiProviderStatus,
  CategoryDefinition,
  ExpenseFields,
  SourceType,
} from '../src/types/expense.ts';
import {
  buildExtractionSystemInstruction,
  normalizeExtractedExpenseList,
  stripJsonCodeFences,
} from '../src/utils/aiSchema.ts';
import {
  DEFAULT_AI_BASE_URLS,
  buildGeminiEndpoints,
  buildOpenAiChatCompletionsUrl,
  validateServerBaseUrl,
} from '../src/utils/aiUrls.ts';

export interface ExtractInputImage {
  mimeType: string;
  data: string; // raw base64 without data: prefix
  pageNumber?: number;
}

export interface ExtractRequestPayload {
  images?: ExtractInputImage[];
  text?: string;
  sourceType: SourceType;
  fileName?: string;
  provider?: AiProviderId;
  model?: string;
  baseUrl?: string;
  categories?: CategoryDefinition[];
}

export const AI_PROVIDER_CATALOG: AiProviderInfo[] = [
  {
    id: 'gemini',
    label: 'Google Gemini',
    envVarName: 'GEMINI_API_KEY',
    defaultModel: 'gemini-4-hydrogen',
    defaultBaseUrl: DEFAULT_AI_BASE_URLS.gemini,
    suggestedModels: ['gemini-4-hydrogen', 'gemini-3.1-flash-lite', 'gemini-2.5-flash'],
  },
  {
    id: 'openai',
    label: 'OpenAI (ChatGPT)',
    envVarName: 'OPENAI_API_KEY',
    defaultModel: 'gpt-4o-mini',
    defaultBaseUrl: DEFAULT_AI_BASE_URLS.openai,
    suggestedModels: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
  },
  {
    id: 'openrouter',
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

function isKeyConfigured(val: string | undefined, placeholder?: string): boolean {
  if (!val) return false;
  const trimmed = val.trim();
  if (!trimmed) return false;
  if (placeholder && trimmed === placeholder) return false;
  return true;
}

export function getAiProviderStatus(activeConfig?: AiConfig): AiProviderStatus {
  const configured: Record<AiProviderId, boolean> = {
    gemini: isKeyConfigured(process.env.GEMINI_API_KEY, 'MY_GEMINI_API_KEY'),
    openai: isKeyConfigured(process.env.OPENAI_API_KEY),
    openrouter: isKeyConfigured(process.env.OPENROUTER_API_KEY),
  };

  const provider: AiProviderId =
    activeConfig?.provider &&
    (['gemini', 'openai', 'openrouter'] as readonly string[]).includes(activeConfig.provider)
      ? activeConfig.provider
      : 'gemini';
  const info = AI_PROVIDER_CATALOG.find((p) => p.id === provider) ?? AI_PROVIDER_CATALOG[0];
  const model =
    activeConfig?.model && activeConfig.model.trim() ? activeConfig.model.trim() : info.defaultModel;

  const baseUrl =
    activeConfig?.baseUrls?.[provider] ??
    (activeConfig?.provider === provider ? activeConfig.baseUrl : undefined);

  return {
    active: {
      provider,
      model,
      ...(baseUrl ? { baseUrl } : {}),
      ...(activeConfig?.baseUrls ? { baseUrls: activeConfig.baseUrls } : {}),
    },
    configured,
    providers: AI_PROVIDER_CATALOG,
  };
}

function getGeminiClient(customBaseUrl?: string): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!isKeyConfigured(apiKey, 'MY_GEMINI_API_KEY')) {
    throw new Error('کلید دسترسی Gemini API در تنظیمات سرور (GEMINI_API_KEY) پیکربندی نشده است.');
  }
  const endpoints = customBaseUrl ? buildGeminiEndpoints('', customBaseUrl) : null;
  return new GoogleGenAI({
    apiKey: apiKey!,
    httpOptions: {
      ...(endpoints ? { baseUrl: endpoints.sdkBaseUrl } : {}),
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
    ...(endpoints?.apiVersion ? { apiVersion: endpoints.apiVersion } : {}),
  });
}

function formatFriendlyProviderError(providerLabel: string, envName: string, rawMessage: string): string {
  if (rawMessage.includes('503') || rawMessage.includes('UNAVAILABLE')) {
    return `سرویس ${providerLabel} در حال حاضر با ترافیک بالا مواجه است. لطفاً چند ثانیه دیگر دوباره تلاش کنید.`;
  }
  if (rawMessage.includes('429') || rawMessage.includes('RESOURCE_EXHAUSTED')) {
    return `سهمیه درخواست‌های سرویس ${providerLabel} موقتاً تکمیل شده است. لطفاً دقایقی دیگر تلاش کنید یا وضعیت کلید ${envName} را بررسی کنید.`;
  }
  if (
    rawMessage.includes('401') ||
    rawMessage.includes('403') ||
    rawMessage.includes('PERMISSION_DENIED') ||
    rawMessage.includes('API_KEY_INVALID') ||
    rawMessage.includes('invalid_api_key')
  ) {
    return `کلید دسترسی ${providerLabel} معتبر نیست یا تنظیم نشده است.`;
  }
  return `خطا در تحلیل سند توسط ${providerLabel}: ${rawMessage}`;
}

async function extractWithGemini(
  payload: ExtractRequestPayload,
  selectedModel: string,
  todayIso: string,
  customBaseUrl?: string
): Promise<Array<Record<string, unknown>>> {
  const ai = getGeminiClient(customBaseUrl);
  const systemInstruction = buildExtractionSystemInstruction(todayIso, false, payload.categories);

  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
  if (payload.images && payload.images.length > 0) {
    for (const img of payload.images) {
      parts.push({
        inlineData: {
          mimeType: img.mimeType || 'image/jpeg',
          data: img.data,
        },
      });
    }
  }

  const contextHint = payload.fileName ? `نام فایل ورودی: ${payload.fileName}\n` : '';
  const textPrompt = payload.text?.trim()
    ? `${contextHint}لطفاً هزینه‌ها و جزئیات مالی متن/فایل زیر را به شکل ساختاریافته استخراج کن:\n\n${payload.text.trim()}`
    : `${contextHint}لطفاً تمام اطلاعات مالی، اقلام فاکتور، تاریخ، مبلغ، مالیات، فروشنده، شماره فاکتور/پیگیری و دسته‌بندی را از تصویر(های) پیوست‌شده استخراج کن و در آرایه expenses برگردان.`;

  parts.push({ text: textPrompt });

  const requestConfig = {
    systemInstruction,
    responseMimeType: 'application/json',
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        expenses: {
          type: Type.ARRAY,
          description: 'لیست هزینه‌ها یا فاکتورهای استخراج‌شده',
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              vendor: { type: Type.STRING },
              vendorTaxId: { type: Type.STRING },
              documentType: { type: Type.STRING },
              category: { type: Type.STRING },
              costCenter: { type: Type.STRING },
              amount: { type: Type.NUMBER },
              currency: { type: Type.STRING },
              exchangeRateToToman: { type: Type.NUMBER },
              taxAmount: { type: Type.NUMBER },
              discountAmount: { type: Type.NUMBER },
              date: { type: Type.STRING },
              invoiceNumber: { type: Type.STRING },
              trackingCode: { type: Type.STRING },
              paymentMethod: { type: Type.STRING },
              paymentStatus: { type: Type.STRING },
              paymentTranches: {
                type: Type.ARRAY,
                description:
                  'فقط در صورتی پر شود که سند واقعاً دارای پیش‌پرداخت، چک یا پرداخت چندمرحله‌ای باشد؛ برای پرداخت کامل و یکجا حتماً آرایه خالی برگردانید.',
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    amount: { type: Type.NUMBER },
                    method: { type: Type.STRING },
                    status: { type: Type.STRING },
                    date: { type: Type.STRING },
                    referenceCode: { type: Type.STRING },
                    notes: { type: Type.STRING },
                  },
                  required: ['title', 'amount', 'method', 'status'],
                },
              },
              dueDate: { type: Type.STRING },
              purchaser: { type: Type.STRING },
              projectTag: { type: Type.STRING },
              notes: { type: Type.STRING },
              extractionNotes: { type: Type.STRING },
              lineItems: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    description: { type: Type.STRING },
                    quantity: { type: Type.NUMBER },
                    unitPrice: { type: Type.NUMBER },
                    totalPrice: { type: Type.NUMBER },
                  },
                  required: ['description', 'quantity', 'unitPrice', 'totalPrice'],
                },
              },
            },
            required: [
              'title',
              'vendor',
              'documentType',
              'category',
              'costCenter',
              'amount',
              'currency',
              'date',
              'paymentMethod',
              'paymentStatus',
            ],
          },
        },
      },
      required: ['expenses'],
    },
  };

  const primaryModel = selectedModel || 'gemini-4-hydrogen';
  const attempts: Array<{ model: string; useThinking: boolean; delayMs: number }> = [
    { model: primaryModel, useThinking: primaryModel.includes('hydrogen'), delayMs: 0 },
    { model: primaryModel, useThinking: primaryModel.includes('hydrogen'), delayMs: 1000 },
    ...(primaryModel !== 'gemini-3.1-flash-lite'
      ? [{ model: 'gemini-3.1-flash-lite', useThinking: false, delayMs: 1200 }]
      : []),
  ];

  let parsedList: Array<Record<string, unknown>> = [];
  let lastError: unknown = null;

  for (const attempt of attempts) {
    if (attempt.delayMs > 0) {
      await new Promise((r) => setTimeout(r, attempt.delayMs));
    }
    try {
      const response = await ai.models.generateContent({
        model: attempt.model,
        contents: parts,
        config: attempt.useThinking
          ? { ...requestConfig, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
          : requestConfig,
      });
      const responseText = stripJsonCodeFences(response.text ?? '');
      if (!responseText) continue;
      const parsed = JSON.parse(responseText) as { expenses?: Array<Record<string, unknown>> };
      if (Array.isArray(parsed.expenses) && parsed.expenses.length > 0) {
        parsedList = parsed.expenses;
        break;
      }
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isTransient = msg.includes('503') || msg.includes('UNAVAILABLE') || msg.includes('429');
      if (!isTransient) {
        throw new Error(formatFriendlyProviderError('Google Gemini', 'GEMINI_API_KEY', msg));
      }
    }
  }

  if (parsedList.length === 0) {
    const rawMsg = lastError instanceof Error ? lastError.message : '';
    if (rawMsg) {
      throw new Error(formatFriendlyProviderError('Google Gemini', 'GEMINI_API_KEY', rawMsg));
    }
    throw new Error('هیچ هزینه یا فاکتور قابل استخراجی در این سند یافت نشد.');
  }

  return parsedList;
}

async function extractWithOpenAiCompatible(params: {
  provider: 'openai' | 'openrouter';
  payload: ExtractRequestPayload;
  model: string;
  todayIso: string;
  baseUrl?: string;
}): Promise<Array<Record<string, unknown>>> {
  const isOpenRouter = params.provider === 'openrouter';
  const envName = isOpenRouter ? 'OPENROUTER_API_KEY' : 'OPENAI_API_KEY';
  const providerLabel = isOpenRouter ? 'OpenRouter' : 'OpenAI';
  const apiKey = isOpenRouter ? process.env.OPENROUTER_API_KEY : process.env.OPENAI_API_KEY;

  if (!isKeyConfigured(apiKey)) {
    throw new Error(
      `کلید دسترسی ${providerLabel} تنظیم نشده است. می‌توانید کلید شخصی خود را در تنظیمات نرم‌افزار وارد کنید.`
    );
  }

  const endpointUrl = buildOpenAiChatCompletionsUrl(params.provider, params.baseUrl);
  const systemInstruction = buildExtractionSystemInstruction(
    params.todayIso,
    true,
    params.payload.categories
  );
  const contextHint = params.payload.fileName ? `نام فایل ورودی: ${params.payload.fileName}\n` : '';
  const textPrompt = params.payload.text?.trim()
    ? `${contextHint}لطفاً هزینه‌ها و جزئیات مالی متن/فایل زیر را استخراج و در JSON با کلید expenses برگردان:\n\n${params.payload.text.trim()}`
    : `${contextHint}لطفاً تمام اطلاعات مالی، اقلام فاکتور، تاریخ، مبلغ، مالیات، فروشنده و نحوه تسویه (یکجا، یا در صورت وجود پیش‌پرداخت/چک، بخش‌های پرداخت) را از تصویر(های) پیوست‌شده استخراج و در JSON با کلید expenses برگردان.`;

  const userContent: Array<
    { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
  > = [{ type: 'text', text: textPrompt }];

  if (params.payload.images && params.payload.images.length > 0) {
    for (const img of params.payload.images) {
      const mime = img.mimeType || 'image/jpeg';
      userContent.push({
        type: 'image_url',
        image_url: {
          url: `data:${mime};base64,${img.data}`,
        },
      });
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey!.trim()}`,
  };
  if (isOpenRouter) {
    headers['HTTP-Referer'] = process.env.APP_URL || 'http://localhost:3000';
    headers['X-Title'] = 'HesabYar Corporate Expense Ledger';
  }

  const response = await fetch(endpointUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: params.model,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: userContent },
      ],
    }),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(
      formatFriendlyProviderError(
        providerLabel,
        envName,
        `${response.status} ${errBody.slice(0, 240)}`
      )
    );
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const rawText = stripJsonCodeFences(data.choices?.[0]?.message?.content ?? '');
  if (!rawText) {
    throw new Error(`پاسخ معتبری از سرویس ${providerLabel} دریافت نشد.`);
  }

  let parsed: { expenses?: Array<Record<string, unknown>> };
  try {
    parsed = JSON.parse(rawText) as { expenses?: Array<Record<string, unknown>> };
  } catch {
    throw new Error(`ساختار JSON بازگشتی از ${providerLabel} قابل تجزیه نبود.`);
  }

  if (!Array.isArray(parsed.expenses) || parsed.expenses.length === 0) {
    throw new Error('هیچ هزینه یا فاکتور قابل استخراجی در این سند یافت نشد.');
  }

  return parsed.expenses;
}

export async function extractStructuredExpenses(
  payload: ExtractRequestPayload
): Promise<Omit<ExpenseFields, 'sourceType' | 'sourceFileName' | 'sourcePreviewUrl' | 'pageCount'>[]> {
  const todayIso = businessDateIso();
  const provider: AiProviderId = payload.provider ?? 'gemini';
  const catalogEntry =
    AI_PROVIDER_CATALOG.find((p) => p.id === provider) ?? AI_PROVIDER_CATALOG[0];
  const model = payload.model?.trim() || catalogEntry.defaultModel;
  const validatedBaseUrl = validateServerBaseUrl(payload.baseUrl);

  const list =
    provider === 'gemini'
      ? await extractWithGemini(payload, model, todayIso, validatedBaseUrl)
      : await extractWithOpenAiCompatible({
          provider,
          payload,
          model,
          todayIso,
          baseUrl: validatedBaseUrl,
        });

  return normalizeExtractedExpenseList(list, todayIso, payload.categories);
}
