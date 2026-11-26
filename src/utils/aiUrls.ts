import type { AiProviderId } from '../types/expense.ts';

export const DEFAULT_AI_BASE_URLS: Record<AiProviderId, string> = {
  gemini: 'https://generativelanguage.googleapis.com',
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
};

function parseAndCleanHttpUrl(raw: string, allowHttp: boolean): URL {
  const trimmed = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('آدرس Base URL واردشده معتبر نیست. لطفاً آدرس کامل با https:// وارد کنید.');
  }

  if (parsed.protocol !== 'https:' && !(allowHttp && parsed.protocol === 'http:')) {
    throw new Error(
      allowHttp
        ? 'آدرس Base URL فقط باید با https:// یا http:// شروع شود.'
        : 'برای ارتباط از طریق سرور، آدرس Base URL فقط باید با https:// شروع شود.'
    );
  }

  if (parsed.username || parsed.password) {
    throw new Error('آدرس Base URL نباید شامل نام کاربری یا رمز عبور باشد.');
  }

  return parsed;
}

function isPrivateOrLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host === 'ip6-localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === '::1' ||
    host === '0:0:0:0:0:0:0:1' ||
    host === '::' ||
    host.startsWith('fc') ||
    host.startsWith('fd') ||
    host.startsWith('fe80')
  ) {
    return true;
  }

  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [, aStr, bStr] = ipv4Match;
    const a = Number(aStr);
    const b = Number(bStr);
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }

  return false;
}

export function normalizeBaseUrlString(url: URL): string {
  return url.toString().replace(/\/+$/, '');
}

/**
 * Browser-side validation: allows HTTPS proxies as well as local HTTP endpoints
 * (e.g. Ollama / LM Studio running directly on the user's machine/network).
 */
export function validateClientBaseUrl(raw?: string): string | undefined {
  if (!raw || !raw.trim()) return undefined;
  const parsed = parseAndCleanHttpUrl(raw, true);
  return normalizeBaseUrlString(parsed);
}

/**
 * Server-side validation: strictly enforces HTTPS and blocks loopback,
 * link-local metadata, and private RFC1918 addresses to prevent SSRF.
 */
export function validateServerBaseUrl(raw?: string): string | undefined {
  if (!raw || !raw.trim()) return undefined;
  const parsed = parseAndCleanHttpUrl(raw, false);
  if (isPrivateOrLoopbackHostname(parsed.hostname)) {
    throw new Error(
      'استفاده از آدرس‌های داخلی یا لوکال (localhost / IP خصوصی) در حالت سروری مجاز نیست. برای مدل‌های محلی، کلید/اتصال را مستقیم روی دستگاه استفاده کنید.'
    );
  }
  return normalizeBaseUrlString(parsed);
}

export function buildOpenAiChatCompletionsUrl(
  provider: 'openai' | 'openrouter',
  customBaseUrl?: string
): string {
  const base = (customBaseUrl?.trim() || DEFAULT_AI_BASE_URLS[provider]).replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(base)) {
    return base;
  }
  if (/\/v\d+(?:alpha|beta)?$/i.test(base)) {
    return `${base}/chat/completions`;
  }
  return `${base}/v1/chat/completions`;
}

export function buildGeminiEndpoints(
  model: string,
  customBaseUrl?: string
): { sdkBaseUrl: string; apiVersion?: string; restGenerateContentUrl: string } {
  const rawBase = (customBaseUrl?.trim() || DEFAULT_AI_BASE_URLS.gemini).replace(/\/+$/, '');
  const encodedModel = encodeURIComponent(model.trim() || 'gemini-4-hydrogen');

  if (/:generateContent$/i.test(rawBase)) {
    const sdkBaseUrl = rawBase.replace(/\/v1(?:beta)?\/models\/[^/]+:generateContent$/i, '');
    return {
      sdkBaseUrl: sdkBaseUrl || DEFAULT_AI_BASE_URLS.gemini,
      restGenerateContentUrl: rawBase,
    };
  }

  const versionMatch = rawBase.match(/\/(v1beta|v1)$/i);
  if (versionMatch) {
    const sdkBaseUrl = rawBase.slice(0, -versionMatch[0].length) || DEFAULT_AI_BASE_URLS.gemini;
    return {
      sdkBaseUrl,
      apiVersion: versionMatch[1].toLowerCase(),
      restGenerateContentUrl: `${rawBase}/models/${encodedModel}:generateContent`,
    };
  }

  return {
    sdkBaseUrl: rawBase,
    restGenerateContentUrl: `${rawBase}/v1beta/models/${encodedModel}:generateContent`,
  };
}
