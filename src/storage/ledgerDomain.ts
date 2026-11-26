import { validateExpenseFields, validateExpensePatch } from '../utils/expenseValidation.ts';
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
} from '../types/expense.ts';
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
} from '../utils/finance.ts';
import { validateClientBaseUrl } from '../utils/aiUrls.ts';

const DEFAULT_RATES: ExchangeRates = {
  USD: 70000,
  EUR: 76000,
};

export const DEFAULT_AI_CONFIG: AiConfig = {
  provider: 'gemini',
  model: 'gemini-4-hydrogen',
};

const VALID_PROVIDERS: readonly AiProviderId[] = ['gemini', 'openai', 'openrouter'];

export function sanitizeAiConfig(input?: Partial<AiConfig>, lenient = false): AiConfig {
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

export function emptyLedger(): LedgerData {
  return { expenses: [], categories: structuredClone(DEFAULT_CATEGORIES), budgets: [], rates: {...DEFAULT_RATES}, aiConfig: {...DEFAULT_AI_CONFIG} };
}

// Platform-neutral ledger operations. Mutate a private working copy only; repository commits atomically.
export class LedgerDomain {
  ledger: LedgerData;
  constructor(ledger: LedgerData) { this.ledger = structuredClone(ledger); }
addExpensesBatch(items: ExpenseFields[]): ExpenseRecord[] {
  const ledger = this.ledger;
  const now = new Date().toISOString();
  const created: ExpenseRecord[] = items.map((item) => ({
    ...validateExpenseFields(item, resolveCategories(ledger.categories), ledger.rates),
    purchaser: normalizePurchaserName(item.purchaser),
    id: globalThis.crypto.randomUUID(),
    createdAt: now,
    approvedAt: now,
  }));
  ledger.expenses = [...created, ...ledger.expenses];
  this.ledger = ledger;
  return created;
}

updateExpense(id: string, patch: Partial<ExpenseFields>): ExpenseRecord | null {
  const ledger = this.ledger;
  const index = ledger.expenses.findIndex((e) => e.id === id);
  if (index === -1) return null;
  const updated = validateExpensePatch(ledger.expenses[index], patch, resolveCategories(ledger.categories), ledger.rates);
  updated.purchaser = normalizePurchaserName(updated.purchaser);
  ledger.expenses[index] = updated;
  this.ledger = ledger;
  return updated;
}

deleteExpense(id: string): boolean {
  const ledger = this.ledger;
  const before = ledger.expenses.length;
  ledger.expenses = ledger.expenses.filter((e) => e.id !== id);
  if (ledger.expenses.length === before) return false;
  this.ledger = ledger;
  return true;
}

updateSettings(params: {
  categories?: CategoryDefinition[];
  budgets?: CategoryBudget[];
  rates?: ExchangeRates;
  aiConfig?: Partial<AiConfig>;
}): LedgerData {
  const ledger = this.ledger;
  const checked = parseAndValidateLedgerImport({ expenses: [], ...(params.categories !== undefined ? {categories:params.categories} : {}), ...(params.budgets !== undefined ? {budgets:params.budgets} : {}), ...(params.rates !== undefined ? {rates:params.rates} : {}) }, resolveCategories(ledger.categories), ledger.rates);
  if (checked.categories && ledger.expenses.some(exp=>!checked.categories!.some(c=>c.id===exp.category))) throw new Error('دسته‌بندی دارای سند را ابتدا منتقل کنید.');
  if (Array.isArray(params.categories)) {
    ledger.categories = checked.categories!;
  }
  if (checked.budgets) ledger.budgets = checked.budgets;
  if (checked.rates) ledger.rates = checked.rates;
  if (params.aiConfig) ledger.aiConfig = sanitizeAiConfig(params.aiConfig);
  this.ledger = ledger;
  return ledger;
}

addCategoryOnServer(input: {
  label: string;
  color?: string;
  description?: string;
  monthlyLimitIRT?: number;
}): { ledger: LedgerData; category: CategoryDefinition } {
  const ledger = this.ledger;
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
  this.ledger = ledger;
  return { ledger, category };
}

updateCategoryOnServer(
  id: string,
  patch: {
    label?: string;
    color?: string;
    description?: string;
    monthlyLimitIRT?: number;
  }
): { ledger: LedgerData; category: CategoryDefinition } | null {
  const ledger = this.ledger;
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

  this.ledger = ledger;
  return { ledger, category: updated };
}

deleteCategoryOnServer(
  id: string,
  reassignToId?: string
): { ledger: LedgerData; reassignedCount: number } {
  const current = this.ledger;
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
  this.ledger = nextLedger;
  return { ledger: nextLedger, reassignedCount: res.reassignedCount };
}

importLedgerOnServer(
  rawData: unknown,
  mode: JsonImportMode
): { ledger: LedgerData; stats: JsonImportStats } {
  const current = this.ledger;
  const validated = parseAndValidateLedgerImport(rawData, resolveCategories(current.categories), current.rates);
  const { next, stats } = mergeLedgerData(current, validated, mode);
  this.ledger = next;
  return { ledger: next, stats };
}

clearExpensesOnServer(
  scope: 'samples' | 'all'
): { ledger: LedgerData; removedCount: number } {
  const current = this.ledger;
  const { next, removedCount } = clearLedgerExpenses(current, scope);
  this.ledger = next;
  return { ledger: next, removedCount };
}

}
