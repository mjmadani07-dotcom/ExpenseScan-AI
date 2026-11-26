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

import { LedgerDomain, emptyLedger, sanitizeAiConfig, DEFAULT_AI_CONFIG } from '../src/storage/ledgerDomain.ts';
export { DEFAULT_AI_CONFIG };
const DEFAULT_RATES = emptyLedger().rates;
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


function mutate<T>(fn: (domain: LedgerDomain) => T): T {
  const domain=new LedgerDomain(readLedger());
  const result=fn(domain);
  writeLedger(domain.ledger);
  return result;
}
export const addExpensesBatch = (items: ExpenseFields[]) => mutate(d=>d.addExpensesBatch(items));
export const updateExpense = (id:string, patch:Partial<ExpenseFields>) => mutate(d=>d.updateExpense(id,patch));
export const deleteExpense = (id:string) => mutate(d=>d.deleteExpense(id));
export const updateSettings = (params:Parameters<LedgerDomain['updateSettings']>[0]) => mutate(d=>d.updateSettings(params));
export const addCategoryOnServer = (input:Parameters<LedgerDomain['addCategoryOnServer']>[0]) => mutate(d=>d.addCategoryOnServer(input));
export const updateCategoryOnServer = (id:string, patch:Parameters<LedgerDomain['updateCategoryOnServer']>[1]) => mutate(d=>d.updateCategoryOnServer(id,patch));
export const deleteCategoryOnServer = (id:string,reassignToId?:string) => mutate(d=>d.deleteCategoryOnServer(id,reassignToId));
export const importLedgerOnServer = (data:unknown,mode:JsonImportMode) => mutate(d=>d.importLedgerOnServer(data,mode));
export const clearExpensesOnServer = (scope:'samples'|'all') => mutate(d=>d.clearExpensesOnServer(scope));
