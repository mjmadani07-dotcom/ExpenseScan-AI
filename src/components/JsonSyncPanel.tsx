import { isAndroidRuntime,nativeExportFile } from '../storage/androidSnapshotStore';
import React, { useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileJson,
  GitMerge,
  RefreshCw,
  Upload,
} from 'lucide-react';
import type {
  CategoryBudget,
  CategoryDefinition,
  ExchangeRates,
  ExpenseRecord,
  JsonImportMode,
  JsonImportStats,
} from '../types/expense';
import { parseAndValidateLedgerImport, type ValidatedLedgerImport } from '../utils/finance';
import { businessDateIso, formatJalaliDate, toPersianDigits } from '../utils/jalali';

interface JsonSyncPanelProps {
  expenses: ExpenseRecord[];
  categories?: CategoryDefinition[];
  budgets: CategoryBudget[];
  rates: ExchangeRates;
  onImportJson: (data: unknown, mode: JsonImportMode) => Promise<JsonImportStats>;
  onSuccess?: () => void;
}

export const JsonSyncPanel: React.FC<JsonSyncPanelProps> = ({
  expenses,
  categories,
  budgets,
  rates,
  onImportJson,
  onSuccess,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [rawJsonData, setRawJsonData] = useState<unknown>(null);
  const [previewInfo, setPreviewInfo] = useState<ValidatedLedgerImport | null>(null);
  const [mode, setMode] = useState<JsonImportMode>('merge');
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resultStats, setResultStats] = useState<JsonImportStats | null>(null);

  const [isExporting,setIsExporting]=useState(false);
  const handleExportJson = async () => {
    setIsExporting(true);setErrorMsg(null);try {
    const payload = JSON.stringify(
      { expenses:expenses.map(({attachmentId:_id,attachmentMime:_mime,...rest})=>rest), ...(categories ? { categories } : {}), budgets, rates },
      null,
      2
    );
    const jDate = formatJalaliDate(businessDateIso()).replace(/\//g, '-');
    if(isAndroidRuntime()){await nativeExportFile('hesabyar-ledger-'+jDate+'.json',new TextEncoder().encode(payload),'application/json');return;}
    const blob = new Blob([payload], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hesabyar-ledger-${jDate}.json`;
    a.click();
    URL.revokeObjectURL(url);
    }catch(err){setErrorMsg(err instanceof Error?err.message:'خطا در ذخیره JSON');}finally{setIsExporting(false);}
  };

  const handleFileChange = async (file: File) => {
    setErrorMsg(null);
    setResultStats(null);
    setConfirmReplace(false);
    try {
      const text = await file.text();
      const parsedJson = JSON.parse(text);
      const validated = parseAndValidateLedgerImport(parsedJson, categories, rates);
      setSelectedFileName(file.name);
      setRawJsonData(parsedJson);
      setPreviewInfo(validated);
    } catch (err) {
      setSelectedFileName(null);
      setRawJsonData(null);
      setPreviewInfo(null);
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'فایل JSON انتخاب‌شده معتبر نیست.'
      );
    }
  };

  const handleApplyImport = async () => {
    if (!rawJsonData || !previewInfo) return;
    if (mode === 'replace' && !confirmReplace) {
      setConfirmReplace(true);
      return;
    }

    setErrorMsg(null);
    setIsImporting(true);
    try {
      const stats = await onImportJson(rawJsonData, mode);
      setResultStats(stats);
      setConfirmReplace(false);
      setRawJsonData(null);
      setPreviewInfo(null);
      setSelectedFileName(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      onSuccess?.();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'خطا در ورود فایل JSON');
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900">
            خروجی و ورود فایل JSON (همگام‌سازی بین دستگاه‌ها)
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            اسناد مالی را ادغام یا جایگزین کنید. JSON فایل اصلی پیوست‌ها را ندارد؛ برای انتقال کامل از پشتیبان رمزگذاری‌شده استفاده کنید.
          </p>
        </div>

        <button
          type="button"
          disabled={isExporting}
           onClick={handleExportJson}
          className="inline-flex items-center gap-2 min-h-[40px] px-4 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-800 hover:bg-slate-50 cursor-pointer shrink-0"
        >
          <Download className="w-4 h-4 text-teal-700" />
          <span>خروجی کامل JSON ({toPersianDigits(expenses.length)} سند)</span>
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFileChange(f);
          e.target.value = '';
        }}
      />

      {errorMsg && (
        <div
          role="alert"
          className="rounded-xl bg-red-50 border border-red-200 p-3 text-xs text-red-800 flex items-center gap-2"
        >
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {resultStats && (
        <div
          role="status"
          className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-900 flex items-center gap-2"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
          <span className="tabular-nums">
            عملیات ورود JSON با موفقیت انجام شد: {toPersianDigits(resultStats.added)} سند جدید اضافه و{' '}
            {toPersianDigits(resultStats.updated)} سند بروزرسانی شد (جمع کل:{' '}
            {toPersianDigits(resultStats.total)} سند).
          </span>
        </div>
      )}

      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-xs text-slate-700">
            <FileJson className="w-5 h-5 text-teal-700 shrink-0" />
            {previewInfo && selectedFileName ? (
              <span>
                فایل{' '}
                <strong dir="ltr" className="inline-block font-bold text-slate-900">
                  {selectedFileName}
                </strong>{' '}
                ·{' '}
                <strong className="text-teal-800 tabular-nums">
                  {toPersianDigits(previewInfo.expenses.length)} سند هزینه
                </strong>{' '}
                شناسایی شد
                {previewInfo.categories
                  ? ` (شامل ${toPersianDigits(previewInfo.categories.length)} دسته‌بندی)`
                  : previewInfo.budgets
                    ? ' (شامل بودجه‌ها)'
                    : ''}
              </span>
            ) : (
              <span>فایل JSON خروجی‌گرفته‌شده از این یا دستگاه دیگر را انتخاب کنید</span>
            )}
          </div>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 min-h-[38px] px-3.5 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-800 hover:bg-slate-100 cursor-pointer"
          >
            <Upload className="w-4 h-4 text-teal-700" />
            <span>{previewInfo ? 'تغییر فایل JSON' : 'انتخاب فایل JSON'}</span>
          </button>
        </div>

        {previewInfo && (
          <div className="pt-3 border-t border-slate-200 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setMode('merge');
                  setConfirmReplace(false);
                }}
                className={`p-3 rounded-xl border text-right transition-colors cursor-pointer ${
                  mode === 'merge'
                    ? 'border-teal-600 bg-teal-50/80 text-teal-950'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-1.5 text-xs font-bold">
                  <GitMerge className="w-4 h-4 text-teal-700" />
                  <span>ادغام هوشمند (Merge)</span>
                </div>
                <p className="mt-1 text-[11px] text-slate-600 leading-relaxed">
                  اسناد فعلی حفظ می‌شوند؛ اسناد جدید اضافه و موارد دارای شناسه یکسان بروزرسانی می‌شوند.
                </p>
              </button>

              <button
                type="button"
                onClick={() => {
                  setMode('replace');
                  setConfirmReplace(false);
                }}
                className={`p-3 rounded-xl border text-right transition-colors cursor-pointer ${
                  mode === 'replace'
                    ? 'border-amber-600 bg-amber-50/80 text-amber-950'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-1.5 text-xs font-bold">
                  <RefreshCw className="w-4 h-4 text-amber-700" />
                  <span>جایگزینی کامل (Replace)</span>
                </div>
                <p className="mt-1 text-[11px] text-slate-600 leading-relaxed">
                  کل داده‌های دفتر فعلی با محتوای فایل JSON انتخاب‌شده جایگزین می‌شود.
                </p>
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              {confirmReplace && mode === 'replace' && (
                <button
                  type="button"
                  onClick={() => setConfirmReplace(false)}
                  className="min-h-[38px] px-3 py-1.5 rounded-xl bg-slate-200 text-xs font-semibold text-slate-700 cursor-pointer"
                >
                  لغو
                </button>
              )}
              <button
                type="button"
                disabled={isImporting}
                onClick={handleApplyImport}
                className={`inline-flex items-center gap-2 min-h-[40px] px-4 py-2 rounded-xl text-xs font-semibold text-white transition-colors disabled:opacity-50 cursor-pointer ${
                  mode === 'replace' && confirmReplace
                    ? 'bg-red-600 hover:bg-red-700'
                    : mode === 'replace'
                      ? 'bg-amber-700 hover:bg-amber-800'
                      : 'bg-teal-700 hover:bg-teal-800'
                }`}
              >
                <span>
                  {isImporting
                    ? 'در حال اعمال...'
                    : mode === 'replace'
                      ? confirmReplace
                        ? 'تایید قطعی جایگزینی کامل'
                        : 'جایگزینی کل دفتر با این فایل'
                      : 'ادغام اسناد با دفتر فعلی'}
                </span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
