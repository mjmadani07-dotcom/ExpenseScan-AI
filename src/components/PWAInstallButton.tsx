import { isAndroidRuntime } from '../storage/androidSnapshotStore';
import React, { useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  compact?: boolean;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ compact = false }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isAndroidRuntime() || isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className="inline-flex items-center justify-center gap-2 min-h-[40px] rounded-xl bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
      >
        <Download className="w-4 h-4 shrink-0" />
        <span>{compact ? 'نصب اپ' : 'نصب روی اندروید'}</span>
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowGuide(true)}
        className="inline-flex items-center justify-center gap-1.5 min-h-[40px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
      >
        <Smartphone className="w-4 h-4 text-teal-700 shrink-0" />
        <span>{compact ? 'نصب' : 'نصب اپلیکیشن'}</span>
      </button>

      {showGuide && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-sm p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-guide-title"
        >
          <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl bg-white p-6 border border-slate-200 shadow-xl">
            <div className="flex items-center justify-between gap-4 mb-4">
              <h3 id="pwa-guide-title" className="text-base font-bold text-slate-900">
                نصب نسخه موبایل حساب‌یار
              </h3>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                aria-label="بستن راهنمای نصب"
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {isIOS ? (
              <ol className="space-y-2.5 text-sm text-slate-700 leading-relaxed list-decimal list-inside">
                <li>در مرورگر Safari دکمه اشتراک‌گذاری (Share) را لمس کنید.</li>
                <li>گزینه Add to Home Screen (افزودن به صفحه اصلی) را انتخاب کنید.</li>
                <li>اپلیکیشن با آیکون مستقل و حالت تمام‌صفحه اجرا می‌شود.</li>
              </ol>
            ) : (
              <ol className="space-y-2.5 text-sm text-slate-700 leading-relaxed list-decimal list-inside">
                <li>لینک اپلیکیشن را در مرورگر Chrome اندروید باز کنید.</li>
                <li>از منوی سه‌نقطه بالای مرورگر گزینه «نصب برنامه» (Install app) یا «Add to Home screen» را بزنید.</li>
                <li>اپلیکیشن به صورت مستقل و آماده عکس‌برداری سریع از فاکتورها روی گوشی نصب می‌شود.</li>
              </ol>
            )}
            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="mt-5 w-full min-h-[44px] rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 transition-colors cursor-pointer"
            >
              متوجه شدم
            </button>
          </div>
        </div>
      )}
    </>
  );
};
