import type { AiProviderId, CategoryDefinition, ExpenseFields } from '../types/expense';
import {
  buildExtractionSystemInstruction,
  normalizeExtractedExpenseList,
  stripJsonCodeFences,
} from './aiSchema';
import {
  buildGeminiEndpoints,
  buildOpenAiChatCompletionsUrl,
  validateClientBaseUrl,
} from './aiUrls';

export interface ClientExtractImage {
  mimeType: string;
  data: string;
}

export interface ClientExtractParams {
  provider: AiProviderId;
  model: string;
  apiKey: string;
  baseUrl?: string;
  categories?: CategoryDefinition[];
  images?: ClientExtractImage[];
  text?: string;
  fileName?: string;
  signal?: AbortSignal;
}

function formatClientAiError(providerLabel: string, status: number, bodyText: string): string {
  if (status === 401 || status === 403 || bodyText.includes('API_KEY_INVALID') || bodyText.includes('invalid_api_key')) {
    return `کلید امنیتی واردشده برای ${providerLabel} معتبر نیست. لطفاً کلید را در بخش تنظیمات بررسی کنید.`;
  }
  if (status === 429 || bodyText.includes('RESOURCE_EXHAUSTED')) {
    return `سهمیه یا محدودیت نرخ درخواست کلید ${providerLabel} موقتاً تکمیل شده است.`;
  }
  if (status === 503) {
    return `سرویس ${providerLabel} موقتاً شلوغ است. چند ثانیه دیگر دوباره تلاش کنید.`;
  }
  return `خطا در ارتباط مستقیم با ${providerLabel} (کد ${status}): ${bodyText.slice(0, 180)}`;
}

export async function extractExpensesDirectlyFromBrowser(
  params: ClientExtractParams
): Promise<Omit<ExpenseFields, 'sourceType' | 'sourceFileName' | 'sourcePreviewUrl' | 'pageCount'>[]> {
  const apiKey = params.apiKey.trim();
  if (!apiKey) {
    throw new Error('کلید امنیتی برای این سرویس وارد نشده است.');
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const systemInstruction = buildExtractionSystemInstruction(todayIso, true, params.categories);
  const contextHint = params.fileName ? `نام فایل ورودی: ${params.fileName}\n` : '';
  const textPrompt = params.text?.trim()
    ? `${contextHint}لطفاً هزینه‌ها و جزئیات مالی متن/فایل زیر را استخراج و در JSON با کلید expenses برگردان:\n\n${params.text.trim()}`
    : `${contextHint}لطفاً تمام اطلاعات مالی، اقلام فاکتور، تاریخ، مبلغ، مالیات، فروشنده و نحوه تسویه (یکجا، یا در صورت وجود پیش‌پرداخت/چک، بخش‌های پرداخت) را از تصویر(های) پیوست‌شده استخراج و در JSON با کلید expenses برگردان.`;

  const validatedBaseUrl = validateClientBaseUrl(params.baseUrl);

  if (params.provider === 'gemini') {
    const modelName = params.model.trim() || 'gemini-4-hydrogen';
    const { restGenerateContentUrl: url } = buildGeminiEndpoints(modelName, validatedBaseUrl);

    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
    if (params.images && params.images.length > 0) {
      for (const img of params.images) {
        parts.push({
          inlineData: {
            mimeType: img.mimeType || 'image/jpeg',
            data: img.data,
          },
        });
      }
    }
    parts.push({ text: textPrompt });

    const res = await fetch(url, {
      method: 'POST',
      signal: params.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: 'user', parts }],
        generationConfig: {
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(formatClientAiError('Google Gemini', res.status, errText));
    }

    const payload = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const rawText = stripJsonCodeFences(
      payload.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    );
    if (!rawText) {
      throw new Error('پاسخی از سرویس Gemini دریافت نشد.');
    }
    const parsed = JSON.parse(rawText) as { expenses?: Array<Record<string, unknown>> };
    if (!Array.isArray(parsed.expenses) || parsed.expenses.length === 0) {
      throw new Error('هیچ هزینه یا فاکتور قابل استخراجی در این سند یافت نشد.');
    }
    return normalizeExtractedExpenseList(parsed.expenses, todayIso, params.categories);
  }

  // OpenAI or OpenRouter direct call from user's device
  const isOpenRouter = params.provider === 'openrouter';
  const endpointUrl = buildOpenAiChatCompletionsUrl(params.provider, validatedBaseUrl);
  const providerLabel = isOpenRouter ? 'OpenRouter' : 'OpenAI';

  const userContent: Array<
    { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
  > = [{ type: 'text', text: textPrompt }];

  if (params.images && params.images.length > 0) {
    for (const img of params.images) {
      const mime = img.mimeType || 'image/jpeg';
      userContent.push({
        type: 'image_url',
        image_url: { url: `data:${mime};base64,${img.data}` },
      });
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
  if (isOpenRouter) {
    headers['HTTP-Referer'] = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    headers['X-Title'] = 'HesabYar Expense App';
  }

  const res = await fetch(endpointUrl, {
    method: 'POST',
    signal: params.signal,
    headers,
    body: JSON.stringify({
      model: params.model.trim() || (isOpenRouter ? 'google/gemini-2.5-flash' : 'gpt-4o-mini'),
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: userContent },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(formatClientAiError(providerLabel, res.status, errText));
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const rawText = stripJsonCodeFences(data.choices?.[0]?.message?.content ?? '');
  if (!rawText) {
    throw new Error(`پاسخ معتبری از ${providerLabel} دریافت نشد.`);
  }
  const parsed = JSON.parse(rawText) as { expenses?: Array<Record<string, unknown>> };
  if (!Array.isArray(parsed.expenses) || parsed.expenses.length === 0) {
    throw new Error('هیچ هزینه یا فاکتور قابل استخراجی در این سند یافت نشد.');
  }
  return normalizeExtractedExpenseList(parsed.expenses, todayIso, params.categories);
}
