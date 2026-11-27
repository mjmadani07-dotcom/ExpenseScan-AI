export type Currency = 'IRT' | 'IRR' | 'USD' | 'EUR';

export type DocumentType =
  | 'invoice'
  | 'receipt'
  | 'bank_transfer'
  | 'bill'
  | 'proforma'
  | 'payroll'
  | 'petty_cash'
  | 'other';

export type DefaultExpenseCategory =
  | 'infrastructure'
  | 'operations'
  | 'marketing'
  | 'hr_admin'
  | 'equipment'
  | 'tax_legal'
  | 'travel'
  | 'other';

export type ExpenseCategory = string;

export interface CategoryDefinition {
  id: string;
  label: string;
  color: string;
  description?: string;
  isDefault?: boolean;
}

export type CostCenter =
  | 'engineering'
  | 'sales'
  | 'operations'
  | 'finance'
  | 'executive'
  | 'general';

export type PaymentMethod =
  | 'corporate_card'
  | 'personal_card'
  | 'bank_transfer'
  | 'petty_cash'
  | 'online_gateway'
  | 'cash'
  | 'check';

export type PaymentStatus = 'paid' | 'partial' | 'pending' | 'overdue';

export type PaymentTrancheStatus = 'paid' | 'pending' | 'overdue';

export interface PaymentTranche {
  id: string;
  title: string;
  amount: number;
  method: PaymentMethod;
  status: PaymentTrancheStatus;
  date?: string; // YYYY-MM-DD (Gregorian ISO)
  referenceCode?: string;
  notes?: string;
}

export type SourceType = 'image' | 'pdf' | 'text' | 'text_file';

export interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export type DisplayUnit = 'IRT' | 'IRR';

export interface ExpenseFields {
  title: string;
  vendor: string;
  vendorTaxId?: string;
  documentType: DocumentType;
  category: ExpenseCategory;
  costCenter: CostCenter;
  amount: number;
  currency: Currency;
  exchangeRateToToman?: number; // Historical rate locked per document when currency is USD/EUR
  taxAmount: number;
  discountAmount: number;
  date: string; // YYYY-MM-DD (Gregorian ISO)
  invoiceNumber?: string;
  trackingCode?: string;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  paymentTranches?: PaymentTranche[];
  dueDate?: string;
  purchaser?: string;
  projectTag?: string;
  notes?: string;
  lineItems: LineItem[];
  extractionNotes?: string;
  sourceType: SourceType;
  sourceFileName?: string;
  attachmentId?: string; // SHA-256 content reference, bytes stored separately
  attachmentMime?: string;
  sourcePreviewUrl?: string;
  pageCount?: number;
}

export interface ExtractedExpenseDraft extends ExpenseFields {
  tempId: string;
  selected: boolean;
}

export interface ExpenseRecord extends ExpenseFields {
  id: string;
  createdAt: string;
  approvedAt: string;
}

export interface CategoryBudget {
  category: ExpenseCategory;
  monthlyLimitIRT: number;
}

export interface ExchangeRates {
  USD: number; // Toman per 1 USD
  EUR: number; // Toman per 1 EUR
}

export type AiProviderId = 'gemini' | 'openai' | 'openrouter';

export interface AiConfig {
  provider: AiProviderId;
  model: string;
  baseUrl?: string;
  baseUrls?: Partial<Record<AiProviderId, string>>;
}

export interface AiProviderInfo {
  id: AiProviderId;
  label: string;
  envVarName: string;
  defaultModel: string;
  defaultBaseUrl: string;
  suggestedModels: string[];
}

export interface AiProviderStatus {
  active: AiConfig;
  configured: Record<AiProviderId, boolean>;
  providers: AiProviderInfo[];
}

export interface LedgerData {
  expenses: ExpenseRecord[];
  categories?: CategoryDefinition[];
  budgets: CategoryBudget[];
  rates: ExchangeRates;
  aiConfig?: AiConfig;
}

export type TimeframeFilter = '1m' | '3m' | '6m' | '12m' | 'all';

export type ExpenseSortBy =
  | 'date_desc'
  | 'date_asc'
  | 'created_desc'
  | 'amount_desc'
  | 'amount_asc';

export interface ExpenseFilters {
  query: string;
  category: ExpenseCategory | 'all';
  costCenter: CostCenter | 'all';
  paymentStatus: PaymentStatus | 'all';
  documentType: DocumentType | 'all';
  paymentMethod: PaymentMethod | 'all';
  currency: Currency | 'all';
  purchaser: string;
  dateFrom?: string; // YYYY-MM-DD
  dateTo?: string; // YYYY-MM-DD
  timeframe: TimeframeFilter;
  sortBy: ExpenseSortBy;
}

export type JsonImportMode = 'merge' | 'replace';

export interface JsonImportStats {
  added: number;
  updated: number;
  total: number;
}
