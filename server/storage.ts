import { validateExpenseFields, validateExpensePatch } from '../src/utils/expenseValidation.ts';
import fs from 'node:fs';
import path from 'node:path';
import type {
  AiConfig,
  AiProviderId,
  CategoryBudget,
  CategoryDefinition,
  ExchangeRates,
  ExpenseFields,
  ExpenseRecord,
  JsonImportMode,
  JsonImportStats,
  LedgerData,
} from '../src/types/expense.ts';
import {
  CATEGORY_PALETTE_COLORS,
  DEFAULT_CATEGORIES,
  clearLedgerExpenses,
  createCustomCategoryId,
  deleteCategoryAndReassign,
  mergeLedgerData,
  normalizeCategoryDescription,
  normalizeCategoryLabel,
  normalizePurchaserName,
  parseAndValidateLedgerImport,
  resolveCategories,
  sanitizeCategories,
} from '../src/utils/finance.ts';
import { validateClientBaseUrl } from '../src/utils/aiUrls.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const LEDGER_FILE = path.join(DATA_DIR, 'ledger.json');

const DEFAULT_RATES: ExchangeRates = {
  USD: 70000,
  EUR: 76000,
};

export const DEFAULT_AI_CONFIG: AiConfig = {
  provider: 'gemini',
  model: 'gemini-4-hydrogen',
};

const VALID_PROVIDERS: readonly AiProviderId[] = ['gemini', 'openai', 'openrouter'];

function sanitizeAiConfig(input?: Partial<AiConfig>, lenient = false): AiConfig {
  const provider: AiProviderId =
    input?.provider && VALID_PROVIDERS.includes(input.provider)
      ? input.provider
      : DEFAULT_AI_CONFIG.provider;
  const fallbackModel =
    provider === 'openai'
      ? 'gpt-4o-mini'
      : provider === 'openrouter'
        ? 'google/gemini-2.5-flash'
        : DEFAULT_AI_CONFIG.model;
  const model =
    typeof input?.model === 'string' && input.model.trim()
      ? input.model.trim().slice(0, 120)
      : fallbackModel;

  const baseUrls: Partial<Record<AiProviderId, string>> = {};
  if (input?.baseUrls && typeof input.baseUrls === 'object') {
    for (const p of VALID_PROVIDERS) {
      const rawUrl = input.baseUrls[p];
      if (typeof rawUrl === 'string' && rawUrl.trim()) {
        try {
          const clean = validateClientBaseUrl(rawUrl.slice(0, 300));
          if (clean) baseUrls[p] = clean;
        } catch (err) {
          if (!lenient) throw err;
        }
      }
    }
  }

  let activeBaseUrl = baseUrls[provider];
  if (!activeBaseUrl && typeof input?.baseUrl === 'string' && input.baseUrl.trim()) {
    try {
      const clean = validateClientBaseUrl(input.baseUrl.slice(0, 300));
      if (clean) {
        activeBaseUrl = clean;
        baseUrls[provider] = clean;
      }
    } catch (err) {
      if (!lenient) throw err;
    }
  }

  return {
    provider,
    model,
    ...(activeBaseUrl ? { baseUrl: activeBaseUrl } : {}),
    ...(Object.keys(baseUrls).length > 0 ? { baseUrls } : {}),
  };
}

const DEFAULT_BUDGETS: CategoryBudget[] = [];

function ensureLedgerFile(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(LEDGER_FILE)) {
    const initial: LedgerData = {
      expenses: [],
      categories: DEFAULT_CATEGORIES,
      budgets: DEFAULT_BUDGETS,
      rates: DEFAULT_RATES,
      aiConfig: DEFAULT_AI_CONFIG,
    };
    fs.writeFileSync(LEDGER_FILE, JSON.stringify(initial, null, 2), 'utf8');
  }
}

export function readLedger(): LedgerData {
  ensureLedgerFile();
  try {
    const raw = fs.readFileSync(LEDGER_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<LedgerData>;
    const rates = parsed.rates ?? DEFAULT_RATES;
    if (!Array.isArray(parsed.expenses)) throw new Error('ساختار دفتر هزینه نامعتبر است.');
    const rawExpenses = parsed.expenses;
    const expenses = rawExpenses.map((e) => {
      if ((e.currency === 'USD' || e.currency === 'EUR') && (!e.exchangeRateToToman || e.exchangeRateToToman <= 0)) {
        return {
          ...e,
          exchangeRateToToman: rates[e.currency],
        };
      }
      return e;
    });
    return {
      expenses,
      categories: resolveCategories(parsed.categories),
      budgets: Array.isArray(parsed.budgets) ? parsed.budgets : DEFAULT_BUDGETS,
      rates,
      aiConfig: sanitizeAiConfig(parsed.aiConfig, true),
    };
  } catch (error) {
    throw new Error('خواندن دفتر هزینه ناموفق بود؛ فایل اصلی حفظ شده است. از نسخه پشتیبان بازیابی کنید.', { cause: error });
  }
}

export function writeLedger(data: LedgerData): void {
  ensureLedgerFile();
  const tmpFile = `${LEDGER_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf8');
  // Never overwrite a corrupt original. Keep the last valid revision.
  readLedger();
  fs.copyFileSync(LEDGER_FILE, `${LEDGER_FILE}.bak`);
  fs.renameSync(tmpFile, LEDGER_FILE);
}

export function addExpensesBatch(items: ExpenseFields[]): ExpenseRecord[] {
  const ledger = readLedger();
  const now = new Date().toISOString();
  const created: ExpenseRecord[] = items.map((item, idx) => ({
    ...validateExpenseFields(item, resolveCategories(ledger.categories), ledger.rates),
    purchaser: normalizePurchaserName(item.purchaser),
    id: `exp-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: now,
    approvedAt: now,
  }));
  ledger.expenses = [...created, ...ledger.expenses];
  writeLedger(ledger);
  return created;
}

export function updateExpense(id: string, patch: Partial<ExpenseFields>): ExpenseRecord | null {
  const ledger = readLedger();
  const index = ledger.expenses.findIndex((e) => e.id === id);
  if (index === -1) return null;
  const updated = validateExpensePatch(ledger.expenses[index], patch, resolveCategories(ledger.categories), ledger.rates);
  updated.purchaser = normalizePurchaserName(updated.purchaser);
  ledger.expenses[index] = updated;
  writeLedger(ledger);
  return updated;
}

export function deleteExpense(id: string): boolean {
  const ledger = readLedger();
  const before = ledger.expenses.length;
  ledger.expenses = ledger.expenses.filter((e) => e.id !== id);
  if (ledger.expenses.length === before) return false;
  writeLedger(ledger);
  return true;
}

export function updateSettings(params: {
  categories?: CategoryDefinition[];
  budgets?: CategoryBudget[];
  rates?: ExchangeRates;
  aiConfig?: Partial<AiConfig>;
}): LedgerData {
  const ledger = readLedger();
  if (Array.isArray(params.categories)) {
    ledger.categories = sanitizeCategories(params.categories);
  }
  if (Array.isArray(params.budgets)) ledger.budgets = params.budgets;
  if (params.rates) ledger.rates = params.rates;
  if (params.aiConfig) ledger.aiConfig = sanitizeAiConfig(params.aiConfig);
  writeLedger(ledger);
  return ledger;
}

export function addCategoryOnServer(input: {
  label: string;
  color?: string;
  description?: string;
  monthlyLimitIRT?: number;
}): { ledger: LedgerData; category: CategoryDefinition } {
  const ledger = readLedger();
  const categories = resolveCategories(ledger.categories);
  const label = normalizeCategoryLabel(input.label);
  if (!label) {
    throw new Error('نام دسته‌بندی نمی‌تواند خالی باشد.');
  }
  if (categories.some((c) => c.label.toLowerCase() === label.toLowerCase())) {
    throw new Error('دسته‌بندی با این نام از قبل وجود دارد.');
  }
  const color =
    typeof input.color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(input.color.trim())
      ? input.color.trim()
      : CATEGORY_PALETTE_COLORS[categories.length % CATEGORY_PALETTE_COLORS.length].hex;
  const description = normalizeCategoryDescription(input.description);
  const id = createCustomCategoryId(categories.map((c) => c.id));
  const category: CategoryDefinition = {
    id,
    label,
    color,
    ...(description ? { description } : {}),
  };
  const limit = Number.isFinite(Number(input.monthlyLimitIRT))
    ? Math.max(0, Math.round(Number(input.monthlyLimitIRT)))
    : 0;

  ledger.categories = [...categories, category];
  ledger.budgets = [...ledger.budgets.filter((b) => b.category !== id), { category: id, monthlyLimitIRT: limit }];
  writeLedger(ledger);
  return { ledger, category };
}

export function updateCategoryOnServer(
  id: string,
  patch: {
    label?: string;
    color?: string;
    description?: string;
    monthlyLimitIRT?: number;
  }
): { ledger: LedgerData; category: CategoryDefinition } | null {
  const ledger = readLedger();
  const categories = resolveCategories(ledger.categories);
  const idx = categories.findIndex((c) => c.id === id);
  if (idx === -1) return null;

  const current = categories[idx];
  const nextLabel =
    patch.label !== undefined ? normalizeCategoryLabel(patch.label) : current.label;
  if (!nextLabel) {
    throw new Error('نام دسته‌بندی نمی‌تواند خالی باشد.');
  }
  if (
    categories.some((c) => c.id !== id && c.label.toLowerCase() === nextLabel.toLowerCase())
  ) {
    throw new Error('دسته‌بندی دیگری با این نام از قبل وجود دارد.');
  }

  const nextColor =
    typeof patch.color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(patch.color.trim())
      ? patch.color.trim()
      : current.color;
  const nextDesc =
    patch.description !== undefined
      ? normalizeCategoryDescription(patch.description)
      : current.description;

  const updated: CategoryDefinition = {
    ...current,
    label: nextLabel,
    color: nextColor,
    ...(nextDesc ? { description: nextDesc } : {}),
  };
  if (!nextDesc) {
    delete updated.description;
  }

  const nextCategories = [...categories];
  nextCategories[idx] = updated;
  ledger.categories = nextCategories;

  if (patch.monthlyLimitIRT !== undefined && Number.isFinite(Number(patch.monthlyLimitIRT))) {
    const limit = Math.max(0, Math.round(Number(patch.monthlyLimitIRT)));
    const hasBudget = ledger.budgets.some((b) => b.category === id);
    ledger.budgets = hasBudget
      ? ledger.budgets.map((b) => (b.category === id ? { ...b, monthlyLimitIRT: limit } : b))
      : [...ledger.budgets, { category: id, monthlyLimitIRT: limit }];
  }

  writeLedger(ledger);
  return { ledger, category: updated };
}

export function deleteCategoryOnServer(
  id: string,
  reassignToId?: string
): { ledger: LedgerData; reassignedCount: number } {
  const current = readLedger();
  const res = deleteCategoryAndReassign({
    categories: resolveCategories(current.categories),
    budgets: current.budgets,
    expenses: current.expenses,
    targetId: id,
    reassignToId,
  });
  const nextLedger: LedgerData = {
    ...current,
    categories: res.categories,
    budgets: res.budgets,
    expenses: res.expenses,
  };
  writeLedger(nextLedger);
  return { ledger: nextLedger, reassignedCount: res.reassignedCount };
}

export function importLedgerOnServer(
  rawData: unknown,
  mode: JsonImportMode
): { ledger: LedgerData; stats: JsonImportStats } {
  const current = readLedger();
  const validated = parseAndValidateLedgerImport(rawData);
  const { next, stats } = mergeLedgerData(current, validated, mode);
  writeLedger(next);
  return { ledger: next, stats };
}

export function clearExpensesOnServer(
  scope: 'samples' | 'all'
): { ledger: LedgerData; removedCount: number } {
  const current = readLedger();
  const { next, removedCount } = clearLedgerExpenses(current, scope);
  writeLedger(next);
  return { ledger: next, removedCount };
}
