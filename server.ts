import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import {
  addCategoryOnServer,
  addExpensesBatch,
  clearExpensesOnServer,
  deleteCategoryOnServer,
  deleteExpense,
  importLedgerOnServer,
  readLedger,
  updateCategoryOnServer,
  updateExpense,
  updateSettings,
} from './server/storage.ts';
import {
  extractStructuredExpenses,
  getAiProviderStatus,
  type ExtractRequestPayload,
} from './server/gemini.ts';
import type { ExpenseFields, JsonImportMode } from './src/types/expense.ts';

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '35mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/api/ledger', (_req, res) => {
    try {
      const ledger = readLedger();
      res.json(ledger);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'خطا در خواندن اطلاعات دفتر هزینه‌ها';
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/ai/status', (_req, res) => {
    try {
      const ledger = readLedger();
      res.json(getAiProviderStatus(ledger.aiConfig));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'خطا در بررسی وضعیت سرویس هوش مصنوعی';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/ledger/import', (req, res) => {
    try {
      const body = req.body as { data?: unknown; mode?: JsonImportMode };
      const mode: JsonImportMode = body.mode === 'replace' ? 'replace' : 'merge';
      if (body.data === undefined) {
        res.status(400).json({ error: 'داده‌های JSON برای ورود ارسال نشده است.' });
        return;
      }
      const result = importLedgerOnServer(body.data, mode);
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'خطا در ورود فایل JSON';
      res.status(400).json({ error: message });
    }
  });

  app.post('/api/ledger/clear', (req, res) => {
    try {
      const body = req.body as { scope?: 'samples' | 'all' };
      const scope = body.scope === 'all' ? 'all' : 'samples';
      const result = clearExpensesOnServer(scope);
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'خطا در پاکسازی اسناد';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/extract', async (req, res) => {
    try {
      const body = req.body as Partial<ExtractRequestPayload>;
      const hasImages = Array.isArray(body.images) && body.images.length > 0;
      const hasText = typeof body.text === 'string' && body.text.trim().length > 0;

      if (!hasImages && !hasText) {
        res.status(400).json({ error: 'حداقل یک تصویر، صفحه PDF یا متن برای تحلیل ارسال کنید.' });
        return;
      }

      const ledger = readLedger();
      const activeProvider = body.provider ?? ledger.aiConfig?.provider ?? 'gemini';
      const activeModel = body.model ?? ledger.aiConfig?.model;
      const activeBaseUrl =
        body.baseUrl !== undefined
          ? body.baseUrl
          : ledger.aiConfig?.baseUrls?.[activeProvider] ??
            (ledger.aiConfig?.provider === activeProvider ? ledger.aiConfig?.baseUrl : undefined);

      const extracted = await extractStructuredExpenses({
        images: body.images,
        text: body.text,
        sourceType: body.sourceType ?? (hasImages ? 'image' : 'text'),
        fileName: body.fileName,
        provider: activeProvider,
        model: activeModel,
        baseUrl: activeBaseUrl,
        categories:
          Array.isArray(body.categories) && body.categories.length > 0
            ? body.categories
            : ledger.categories,
      });

      res.json({ expenses: extracted });
    } catch (err) {
      console.error('Extract error:', err);
      const message = err instanceof Error ? err.message : 'خطا در تحلیل سند توسط سرویس هوشمند';
      const isConfigMissing =
        message.includes('GEMINI_API_KEY') ||
        message.includes('OPENAI_API_KEY') ||
        message.includes('OPENROUTER_API_KEY');
      res.status(isConfigMissing ? 503 : 500).json({ error: message });
    }
  });

  app.post('/api/expenses/batch', (req, res) => {
    try {
      const body = req.body as { expenses?: ExpenseFields[] };
      if (!Array.isArray(body.expenses) || body.expenses.length === 0) {
        res.status(400).json({ error: 'لیست هزینه‌های تاییدشده خالی است.' });
        return;
      }
      for (const item of body.expenses) {
        if (!item.title || !item.vendor || !Number.isFinite(Number(item.amount))) {
          res.status(400).json({ error: 'عنوان، فروشنده و مبلغ معتبر برای همه ردیف‌ها الزامی است.' });
          return;
        }
      }
      const created = addExpensesBatch(body.expenses);
      res.status(201).json({ created });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'خطا در ثبت هزینه‌ها';
      res.status(500).json({ error: message });
    }
  });

  app.patch('/api/expenses/:id', (req, res) => {
    try {
      const updated = updateExpense(req.params.id, req.body as Partial<ExpenseFields>);
      if (!updated) {
        res.status(404).json({ error: 'سند هزینه مورد نظر یافت نشد.' });
        return;
      }
      res.json({ expense: updated });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'خطا در بروزرسانی سند';
      res.status(500).json({ error: message });
    }
  });

  app.delete('/api/expenses/:id', (req, res) => {
    try {
      const deleted = deleteExpense(req.params.id);
      if (!deleted) {
        res.status(404).json({ error: 'سند هزینه مورد نظر یافت نشد.' });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'خطا در حذف سند';
      res.status(500).json({ error: message });
    }
  });

  app.put('/api/settings', (req, res) => {
    try {
      const updated = updateSettings(req.body);
      res.json({
        ...updated,
        aiStatus: getAiProviderStatus(updated.aiConfig),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'خطا در ذخیره تنظیمات';
      const isValidation = message.includes('Base URL');
      res.status(isValidation ? 400 : 500).json({ error: message });
    }
  });

  app.post('/api/categories', (req, res) => {
    try {
      const body = req.body as {
        label?: string;
        color?: string;
        description?: string;
        monthlyLimitIRT?: number;
      };
      const result = addCategoryOnServer({
        label: String(body.label ?? ''),
        color: body.color,
        description: body.description,
        monthlyLimitIRT: body.monthlyLimitIRT,
      });
      res.status(201).json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'خطا در ایجاد دسته‌بندی';
      res.status(400).json({ error: message });
    }
  });

  app.patch('/api/categories/:id', (req, res) => {
    try {
      const body = req.body as {
        label?: string;
        color?: string;
        description?: string;
        monthlyLimitIRT?: number;
      };
      const result = updateCategoryOnServer(req.params.id, body);
      if (!result) {
        res.status(404).json({ error: 'دسته‌بندی مورد نظر یافت نشد.' });
        return;
      }
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'خطا در ویرایش دسته‌بندی';
      res.status(400).json({ error: message });
    }
  });

  app.delete('/api/categories/:id', (req, res) => {
    try {
      const body = (req.body ?? {}) as { reassignTo?: string };
      const reassignTo =
        typeof body.reassignTo === 'string'
          ? body.reassignTo
          : typeof req.query.reassignTo === 'string'
            ? req.query.reassignTo
            : undefined;
      const result = deleteCategoryOnServer(req.params.id, reassignTo);
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'خطا در حذف دسته‌بندی';
      const status = message.includes('یافت نشد') ? 404 : 400;
      res.status(status).json({ error: message });
    }
  });

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    app.get('/@vite/client', (_req, res) => {
      res.type('application/javascript').send(`
const sheetsMap = new Map();
export function updateStyle(id, content) {
  if (typeof document === 'undefined') return;
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    style.textContent = content;
    document.head.appendChild(style);
  } else {
    style.textContent = content;
  }
  sheetsMap.set(id, style);
}
export function removeStyle(id) {
  if (typeof document === 'undefined') return;
  const style = sheetsMap.get(id);
  if (style) {
    document.head.removeChild(style);
    sheetsMap.delete(id);
  }
}
export function injectQuery(url) {
  return url;
}
export function createHotContext() {
  return {
    data: {},
    accept() {},
    acceptExports() {},
    dispose() {},
    prune() {},
    invalidate() {},
    on() {},
    off() {},
    send() {},
  };
}
const BaseElement = typeof HTMLElement !== 'undefined' ? HTMLElement : class {};
export class ErrorOverlay extends BaseElement {}
`);
    });

    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on http://localhost:${port}`);
  });
}

startServer();
