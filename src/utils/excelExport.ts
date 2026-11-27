import { isAndroidRuntime,nativeExportFile } from '../storage/androidSnapshotStore';
import { businessDateIso } from './jalali';
import XLSX from 'xlsx-js-style';
import type {
  CategoryBudget,
  CategoryDefinition,
  DisplayUnit,
  ExchangeRates,
  ExpenseRecord,
} from '../types/expense';
import {
  COST_CENTER_LABELS,
  CURRENCY_LABELS,
  DOCUMENT_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  computeDomainBreakdown,
  computePurchaserBreakdown,
  convertTomanToDisplayUnit,
  getCategoryLabel,
  normalizePurchaserName,
  summarizeExpensePayments,
} from './finance';
import { formatJalaliDate, formatJalaliLong, toPersianDigits } from './jalali';

type CellStyle = Record<string, unknown>;

const FONT_NAME = 'Tahoma';

const THIN_BORDER = {
  top: { style: 'thin', color: { rgb: 'CBD5E1' } },
  bottom: { style: 'thin', color: { rgb: 'CBD5E1' } },
  left: { style: 'thin', color: { rgb: 'CBD5E1' } },
  right: { style: 'thin', color: { rgb: 'CBD5E1' } },
};

const TITLE_STYLE: CellStyle = {
  font: { name: FONT_NAME, sz: 13, bold: true, color: { rgb: 'FFFFFF' } },
  fill: { fgColor: { rgb: '0F766E' } },
  alignment: { horizontal: 'center', vertical: 'center', readingOrder: 2 },
};

const SUBTITLE_STYLE: CellStyle = {
  font: { name: FONT_NAME, sz: 10, bold: true, color: { rgb: '134E4A' } },
  fill: { fgColor: { rgb: 'CCFBF1' } },
  alignment: { horizontal: 'center', vertical: 'center', readingOrder: 2 },
  border: THIN_BORDER,
};

const HEADER_STYLE: CellStyle = {
  font: { name: FONT_NAME, sz: 10, bold: true, color: { rgb: 'FFFFFF' } },
  fill: { fgColor: { rgb: '115E59' } },
  alignment: { horizontal: 'center', vertical: 'center', wrapText: true, readingOrder: 2 },
  border: {
    top: { style: 'medium', color: { rgb: '0F766E' } },
    bottom: { style: 'medium', color: { rgb: '0F766E' } },
    left: { style: 'thin', color: { rgb: '14B8A6' } },
    right: { style: 'thin', color: { rgb: '14B8A6' } },
  },
};

const TOTAL_ROW_STYLE: CellStyle = {
  font: { name: FONT_NAME, sz: 10, bold: true, color: { rgb: '0F172A' } },
  fill: { fgColor: { rgb: 'CCFBF1' } },
  alignment: { horizontal: 'right', vertical: 'center', readingOrder: 2 },
  border: {
    top: { style: 'medium', color: { rgb: '0F766E' } },
    bottom: { style: 'double', color: { rgb: '0F766E' } },
    left: { style: 'thin', color: { rgb: '99F6E4' } },
    right: { style: 'thin', color: { rgb: '99F6E4' } },
  },
  numFmt: '#,##0',
};

function makeDataCellStyle(isEven: boolean, options?: { num?: boolean; center?: boolean }): CellStyle {
  return {
    font: { name: FONT_NAME, sz: 10, color: { rgb: '0F172A' } },
    fill: { fgColor: { rgb: isEven ? 'F8FAFC' : 'FFFFFF' } },
    alignment: {
      horizontal: options?.center ? 'center' : options?.num ? 'left' : 'right',
      vertical: 'center',
      wrapText: true,
      readingOrder: 2,
    },
    border: THIN_BORDER,
    ...(options?.num ? { numFmt: '#,##0' } : {}),
  };
}

function makeStatusCellStyle(status: string): CellStyle {
  if (status === 'paid') {
    return {
      font: { name: FONT_NAME, sz: 10, bold: true, color: { rgb: '166534' } },
      fill: { fgColor: { rgb: 'DCFCE7' } },
      alignment: { horizontal: 'center', vertical: 'center', readingOrder: 2 },
      border: THIN_BORDER,
    };
  }
  if (status === 'partial') {
    return {
      font: { name: FONT_NAME, sz: 10, bold: true, color: { rgb: '0369A1' } },
      fill: { fgColor: { rgb: 'E0F2FE' } },
      alignment: { horizontal: 'center', vertical: 'center', readingOrder: 2 },
      border: THIN_BORDER,
    };
  }
  if (status === 'overdue') {
    return {
      font: { name: FONT_NAME, sz: 10, bold: true, color: { rgb: '991B1B' } },
      fill: { fgColor: { rgb: 'FEE2E2' } },
      alignment: { horizontal: 'center', vertical: 'center', readingOrder: 2 },
      border: THIN_BORDER,
    };
  }
  return {
    font: { name: FONT_NAME, sz: 10, bold: true, color: { rgb: '92400E' } },
    fill: { fgColor: { rgb: 'FEF3C7' } },
    alignment: { horizontal: 'center', vertical: 'center', readingOrder: 2 },
    border: THIN_BORDER,
  };
}

function makeWarningNumStyle(isWarning: boolean, isEven: boolean): CellStyle {
  if (!isWarning) return makeDataCellStyle(isEven, { num: true });
  return {
    font: { name: FONT_NAME, sz: 10, bold: true, color: { rgb: 'B45309' } },
    fill: { fgColor: { rgb: 'FFFBEB' } },
    alignment: { horizontal: 'left', vertical: 'center', readingOrder: 2 },
    border: THIN_BORDER,
    numFmt: '#,##0',
  };
}

function setCell(
  ws: XLSX.WorkSheet,
  r: number,
  c: number,
  value: string | number,
  style: CellStyle
): void {
  const addr = XLSX.utils.encode_cell({ r, c });
  const cell: XLSX.CellObject & { s?: CellStyle } = {
    v: value,
    t: typeof value === 'number' ? 'n' : 's',
    s: style,
  };
  ws[addr] = cell;
}

function applyBannerRow(
  ws: XLSX.WorkSheet,
  rowIndex: number,
  colCount: number,
  text: string,
  style: CellStyle
): void {
  for (let c = 0; c < colCount; c += 1) {
    setCell(ws, rowIndex, c, c === 0 ? text : '', style);
  }
  ws['!merges'] = ws['!merges'] ?? [];
  ws['!merges'].push({ s: { r: rowIndex, c: 0 }, e: { r: rowIndex, c: colCount - 1 } });
}

function finalizeSheet(
  ws: XLSX.WorkSheet,
  rowsCount: number,
  colWidths: number[],
  headerRowIndex: number
): void {
  ws['!ref'] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: Math.max(0, rowsCount - 1), c: Math.max(0, colWidths.length - 1) },
  });
  ws['!cols'] = colWidths.map((wch) => ({ wch }));
  const rowHeights: XLSX.RowInfo[] = [];
  for (let r = 0; r < rowsCount; r += 1) {
    if (r === 0) rowHeights.push({ hpt: 32 });
    else if (r === 1) rowHeights.push({ hpt: 24 });
    else if (r === headerRowIndex) rowHeights.push({ hpt: 30 });
    else rowHeights.push({ hpt: 22 });
  }
  ws['!rows'] = rowHeights;
  (ws as Record<string, unknown>)['!views'] = [{ rightToLeft: true }];
}

export function buildExpenseWorkbook(
  expenses: ExpenseRecord[],
  budgets: CategoryBudget[],
  rates: ExchangeRates,
  displayUnit: DisplayUnit = 'IRT',
  categories?: CategoryDefinition[]
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };

  const unitLabel = displayUnit === 'IRR' ? 'ریال' : 'تومان';
  const todayIso = businessDateIso();
  const todayLong = formatJalaliLong(todayIso);

  // =========================================================================
  // Sheet 1: دفتر کل هزینه‌ها
  // =========================================================================
  const wsLedger: XLSX.WorkSheet = {};
  const ledgerHeaders = [
    'تاریخ شمسی',
    'عنوان هزینه',
    'فروشنده / طرف حساب',
    'مسئول خرید',
    'نوع سند',
    'حوزه هزینه',
    'مرکز هزینه',
    'مبلغ اصلی',
    'واحد پول',
    'نرخ تسعیر (تومان)',
    `معادل (${unitLabel})`,
    `پرداخت‌شده (${unitLabel})`,
    `مانده (${unitLabel})`,
    'مالیات',
    'تخفیف',
    'روش پرداخت',
    'وضعیت تسویه',
    'شماره فاکتور',
    'کد پیگیری',
    'پروژه',
    'یادداشت',
  ];
  const L_COLS = ledgerHeaders.length;

  let grandTotalDisplay = 0;
  let grandPaidDisplay = 0;
  let grandRemainingDisplay = 0;

  const ledgerPaySummaries = expenses.map((e) => {
    const s = summarizeExpensePayments(e, rates);
    const totalD = convertTomanToDisplayUnit(s.totalIRT, displayUnit);
    const paidD = convertTomanToDisplayUnit(s.paidIRT, displayUnit);
    const remD = convertTomanToDisplayUnit(s.remainingIRT, displayUnit);
    grandTotalDisplay += totalD;
    grandPaidDisplay += paidD;
    grandRemainingDisplay += remD;
    return { s, totalD, paidD, remD };
  });

  applyBannerRow(
    wsLedger,
    0,
    L_COLS,
    `گزارش مالی دفتر کل هزینه‌ها و فاکتورها — حساب‌یار (${todayLong})`,
    TITLE_STYLE
  );
  applyBannerRow(
    wsLedger,
    1,
    L_COLS,
    `تعداد اسناد: ${toPersianDigits(expenses.length)}   |   جمع کل: ${toPersianDigits(grandTotalDisplay.toLocaleString('en-US'))} ${unitLabel}   |   پرداخت‌شده: ${toPersianDigits(grandPaidDisplay.toLocaleString('en-US'))} ${unitLabel}   |   مانده تسویه: ${toPersianDigits(grandRemainingDisplay.toLocaleString('en-US'))} ${unitLabel}`,
    SUBTITLE_STYLE
  );

  const ledgerHeaderRow = 3;
  ledgerHeaders.forEach((h, c) => setCell(wsLedger, ledgerHeaderRow, c, h, HEADER_STYLE));

  expenses.forEach((exp, idx) => {
    const r = ledgerHeaderRow + 1 + idx;
    const isEven = idx % 2 === 1;
    const { totalD, paidD, remD } = ledgerPaySummaries[idx];
    const trancheCount = exp.paymentTranches?.length ?? 0;
    const methodLabel =
      trancheCount > 1
        ? `ترکیبی (${toPersianDigits(trancheCount)} بخش)`
        : PAYMENT_METHOD_LABELS[exp.paymentMethod];
    const docRate =
      exp.currency === 'USD' || exp.currency === 'EUR'
        ? exp.exchangeRateToToman ?? rates[exp.currency]
        : '';

    const rowValues: Array<{ v: string | number; s: CellStyle }> = [
      { v: formatJalaliDate(exp.date), s: makeDataCellStyle(isEven, { center: true }) },
      { v: exp.title, s: makeDataCellStyle(isEven) },
      { v: exp.vendor, s: makeDataCellStyle(isEven) },
      { v: normalizePurchaserName(exp.purchaser) ?? '—', s: makeDataCellStyle(isEven, { center: true }) },
      { v: DOCUMENT_TYPE_LABELS[exp.documentType], s: makeDataCellStyle(isEven, { center: true }) },
      { v: getCategoryLabel(exp.category, categories), s: makeDataCellStyle(isEven) },
      { v: COST_CENTER_LABELS[exp.costCenter], s: makeDataCellStyle(isEven) },
      { v: exp.amount, s: makeDataCellStyle(isEven, { num: true }) },
      { v: CURRENCY_LABELS[exp.currency], s: makeDataCellStyle(isEven, { center: true }) },
      {
        v: docRate,
        s: makeDataCellStyle(isEven, { num: typeof docRate === 'number', center: typeof docRate !== 'number' }),
      },
      { v: totalD, s: makeDataCellStyle(isEven, { num: true }) },
      { v: paidD, s: makeDataCellStyle(isEven, { num: true }) },
      { v: remD, s: makeWarningNumStyle(remD > 0, isEven) },
      { v: exp.taxAmount ?? 0, s: makeDataCellStyle(isEven, { num: true }) },
      { v: exp.discountAmount ?? 0, s: makeDataCellStyle(isEven, { num: true }) },
      { v: methodLabel, s: makeDataCellStyle(isEven, { center: true }) },
      { v: PAYMENT_STATUS_LABELS[exp.paymentStatus], s: makeStatusCellStyle(exp.paymentStatus) },
      { v: exp.invoiceNumber ?? '', s: makeDataCellStyle(isEven, { center: true }) },
      { v: exp.trackingCode ?? '', s: makeDataCellStyle(isEven, { center: true }) },
      { v: exp.projectTag ?? '', s: makeDataCellStyle(isEven) },
      { v: exp.notes ?? '', s: makeDataCellStyle(isEven) },
    ];

    rowValues.forEach((cell, c) => setCell(wsLedger, r, c, cell.v, cell.s));
  });

  const ledgerTotalRow = ledgerHeaderRow + 1 + expenses.length;
  for (let c = 0; c < L_COLS; c += 1) {
    let val: string | number = '';
    if (c === 0) val = 'جمع کل';
    else if (c === 1) val = `${toPersianDigits(expenses.length)} سند`;
    else if (c === 10) val = grandTotalDisplay;
    else if (c === 11) val = grandPaidDisplay;
    else if (c === 12) val = grandRemainingDisplay;
    setCell(wsLedger, ledgerTotalRow, c, val, TOTAL_ROW_STYLE);
  }

  finalizeSheet(
    wsLedger,
    ledgerTotalRow + 1,
    [13, 28, 22, 18, 16, 20, 17, 15, 10, 14, 17, 17, 16, 13, 13, 18, 17, 15, 16, 18, 30],
    ledgerHeaderRow
  );
  XLSX.utils.book_append_sheet(wb, wsLedger, 'دفتر کل هزینه‌ها');

  // =========================================================================
  // Sheet 2: خلاصه حوزه‌ها و بودجه
  // =========================================================================
  const wsSummary: XLSX.WorkSheet = {};
  const summaryHeaders = [
    'حوزه هزینه',
    'تعداد سند',
    `مجموع هزینه (${unitLabel})`,
    'سهم از کل (٪)',
    `سقف بودجه ماهانه (${unitLabel})`,
    'درصد مصرف بودجه (٪)',
    'وضعیت بودجه',
  ];
  const S_COLS = summaryHeaders.length;
  const breakdown = computeDomainBreakdown(expenses, budgets, rates, 1, categories);

  applyBannerRow(
    wsSummary,
    0,
    S_COLS,
    `تحلیل هزینه‌ها به تفکیک حوزه‌های شرکتی (${unitLabel})`,
    TITLE_STYLE
  );
  applyBannerRow(
    wsSummary,
    1,
    S_COLS,
    `نرخ ارز پایه تنظیمات — دلار: ${toPersianDigits(rates.USD.toLocaleString('en-US'))} تومان   |   یورو: ${toPersianDigits(rates.EUR.toLocaleString('en-US'))} تومان`,
    SUBTITLE_STYLE
  );

  const summaryHeaderRow = 3;
  summaryHeaders.forEach((h, c) => setCell(wsSummary, summaryHeaderRow, c, h, HEADER_STYLE));

  breakdown.forEach((row, idx) => {
    const r = summaryHeaderRow + 1 + idx;
    const isEven = idx % 2 === 1;
    const totalD = convertTomanToDisplayUnit(row.totalIRT, displayUnit);
    const budgetD = convertTomanToDisplayUnit(row.monthlyLimitIRT, displayUnit);
    const util = row.budgetUtilizationPercent;
    const budgetStatus =
      util === null
        ? 'بدون سقف تعریف‌شده'
        : util > 100
          ? 'تجاوز از بودجه'
          : util >= 80
            ? 'نزدیک به سقف'
            : 'در محدوده مجاز';
    const statusKey =
      util === null ? 'partial' : util > 100 ? 'overdue' : util >= 80 ? 'pending' : 'paid';

    setCell(wsSummary, r, 0, row.label, makeDataCellStyle(isEven));
    setCell(wsSummary, r, 1, row.count, makeDataCellStyle(isEven, { center: true }));
    setCell(wsSummary, r, 2, totalD, makeDataCellStyle(isEven, { num: true }));
    setCell(wsSummary, r, 3, `${toPersianDigits(row.sharePercent)}٪`, makeDataCellStyle(isEven, { center: true }));
    setCell(wsSummary, r, 4, budgetD, makeDataCellStyle(isEven, { num: true }));
    setCell(
      wsSummary,
      r,
      5,
      util === null ? '—' : `${toPersianDigits(util)}٪`,
      makeDataCellStyle(isEven, { center: true })
    );
    setCell(wsSummary, r, 6, budgetStatus, makeStatusCellStyle(statusKey));
  });

  const summaryTotalRow = summaryHeaderRow + 1 + breakdown.length;
  const totalSummaryAmount = breakdown.reduce(
    (s, b) => s + convertTomanToDisplayUnit(b.totalIRT, displayUnit),
    0
  );
  const totalSummaryBudget = breakdown.reduce(
    (s, b) => s + convertTomanToDisplayUnit(b.monthlyLimitIRT, displayUnit),
    0
  );
  for (let c = 0; c < S_COLS; c += 1) {
    let val: string | number = '';
    if (c === 0) val = 'مجموع کل حوزه‌ها';
    else if (c === 1) val = expenses.length;
    else if (c === 2) val = totalSummaryAmount;
    else if (c === 3) val = '۱۰۰٪';
    else if (c === 4) val = totalSummaryBudget;
    setCell(wsSummary, summaryTotalRow, c, val, TOTAL_ROW_STYLE);
  }

  finalizeSheet(wsSummary, summaryTotalRow + 1, [24, 14, 22, 16, 22, 20, 22], summaryHeaderRow);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'خلاصه حوزه‌ها و بودجه');

  // =========================================================================
  // Sheet 3: پرداخت‌های ترکیبی و چک‌ها
  // =========================================================================
  const wsTranches: XLSX.WorkSheet = {};
  const trancheHeaders = [
    'عنوان سند / فاکتور',
    'فروشنده',
    'عنوان بخش پرداخت',
    'روش پرداخت',
    'مبلغ بخش',
    'ارز',
    `معادل (${unitLabel})`,
    'تاریخ / سررسید (شمسی)',
    'شماره چک / صیاد / پیگیری',
    'وضعیت بخش',
  ];
  const T_COLS = trancheHeaders.length;
  const trancheRows: Array<{
    expTitle: string;
    vendor: string;
    trTitle: string;
    method: string;
    amount: number;
    currency: string;
    eqDisplay: number;
    dateFa: string;
    refCode: string;
    status: string;
    statusLabel: string;
  }> = [];

  for (const exp of expenses) {
    for (const tr of exp.paymentTranches ?? []) {
      const rate =
        exp.currency === 'USD' || exp.currency === 'EUR'
          ? exp.exchangeRateToToman ?? rates[exp.currency]
          : 1;
      const eqToman =
        exp.currency === 'IRR'
          ? Math.round(tr.amount / 10)
          : exp.currency === 'IRT'
            ? tr.amount
            : Math.round(tr.amount * rate);
      trancheRows.push({
        expTitle: exp.title,
        vendor: exp.vendor,
        trTitle: tr.title,
        method: PAYMENT_METHOD_LABELS[tr.method],
        amount: tr.amount,
        currency: CURRENCY_LABELS[exp.currency],
        eqDisplay: convertTomanToDisplayUnit(eqToman, displayUnit),
        dateFa: tr.date ? formatJalaliDate(tr.date) : formatJalaliDate(exp.date),
        refCode: tr.referenceCode ?? '',
        status: tr.status,
        statusLabel: PAYMENT_STATUS_LABELS[tr.status],
      });
    }
  }

  applyBannerRow(
    wsTranches,
    0,
    T_COLS,
    'جدول پرداخت‌های مرحله‌ای، پیش‌پرداخت‌ها و چک‌ها',
    TITLE_STYLE
  );
  applyBannerRow(
    wsTranches,
    1,
    T_COLS,
    `تعداد بخش‌های ثبت‌شده: ${toPersianDigits(trancheRows.length)} بخش`,
    SUBTITLE_STYLE
  );

  const trHeaderRow = 3;
  trancheHeaders.forEach((h, c) => setCell(wsTranches, trHeaderRow, c, h, HEADER_STYLE));

  trancheRows.forEach((tr, idx) => {
    const r = trHeaderRow + 1 + idx;
    const isEven = idx % 2 === 1;
    setCell(wsTranches, r, 0, tr.expTitle, makeDataCellStyle(isEven));
    setCell(wsTranches, r, 1, tr.vendor, makeDataCellStyle(isEven));
    setCell(wsTranches, r, 2, tr.trTitle, makeDataCellStyle(isEven));
    setCell(wsTranches, r, 3, tr.method, makeDataCellStyle(isEven, { center: true }));
    setCell(wsTranches, r, 4, tr.amount, makeDataCellStyle(isEven, { num: true }));
    setCell(wsTranches, r, 5, tr.currency, makeDataCellStyle(isEven, { center: true }));
    setCell(wsTranches, r, 6, tr.eqDisplay, makeDataCellStyle(isEven, { num: true }));
    setCell(wsTranches, r, 7, tr.dateFa, makeDataCellStyle(isEven, { center: true }));
    setCell(wsTranches, r, 8, tr.refCode, makeDataCellStyle(isEven, { center: true }));
    setCell(wsTranches, r, 9, tr.statusLabel, makeStatusCellStyle(tr.status));
  });

  finalizeSheet(
    wsTranches,
    trHeaderRow + 1 + Math.max(1, trancheRows.length),
    [28, 22, 22, 18, 16, 10, 18, 16, 20, 18],
    trHeaderRow
  );
  XLSX.utils.book_append_sheet(wb, wsTranches, 'پرداخت‌های ترکیبی و چک‌ها');

  // =========================================================================
  // Sheet 4: اقلام ریز فاکتورها
  // =========================================================================
  const wsItems: XLSX.WorkSheet = {};
  const itemHeaders = [
    'تاریخ شمسی',
    'عنوان سند / فاکتور',
    'فروشنده',
    'شرح کالا یا خدمت',
    'تعداد',
    'فی واحد',
    'مبلغ کل ردیف',
    'واحد پول',
  ];
  const I_COLS = itemHeaders.length;
  const flatItems: Array<{
    dateFa: string;
    expTitle: string;
    vendor: string;
    desc: string;
    qty: number;
    unitPrice: number;
    totalPrice: number;
    currency: string;
  }> = [];

  for (const exp of expenses) {
    for (const li of exp.lineItems ?? []) {
      flatItems.push({
        dateFa: formatJalaliDate(exp.date),
        expTitle: exp.title,
        vendor: exp.vendor,
        desc: li.description,
        qty: li.quantity,
        unitPrice: li.unitPrice,
        totalPrice: li.totalPrice,
        currency: CURRENCY_LABELS[exp.currency],
      });
    }
  }

  applyBannerRow(wsItems, 0, I_COLS, 'ریز اقلام و کالاهای فاکتورها', TITLE_STYLE);
  applyBannerRow(
    wsItems,
    1,
    I_COLS,
    `مجموع ردیف‌های کالا و خدمات: ${toPersianDigits(flatItems.length)} قلم`,
    SUBTITLE_STYLE
  );

  const itemHeaderRow = 3;
  itemHeaders.forEach((h, c) => setCell(wsItems, itemHeaderRow, c, h, HEADER_STYLE));

  flatItems.forEach((it, idx) => {
    const r = itemHeaderRow + 1 + idx;
    const isEven = idx % 2 === 1;
    setCell(wsItems, r, 0, it.dateFa, makeDataCellStyle(isEven, { center: true }));
    setCell(wsItems, r, 1, it.expTitle, makeDataCellStyle(isEven));
    setCell(wsItems, r, 2, it.vendor, makeDataCellStyle(isEven));
    setCell(wsItems, r, 3, it.desc, makeDataCellStyle(isEven));
    setCell(wsItems, r, 4, it.qty, makeDataCellStyle(isEven, { center: true }));
    setCell(wsItems, r, 5, it.unitPrice, makeDataCellStyle(isEven, { num: true }));
    setCell(wsItems, r, 6, it.totalPrice, makeDataCellStyle(isEven, { num: true }));
    setCell(wsItems, r, 7, it.currency, makeDataCellStyle(isEven, { center: true }));
  });

  finalizeSheet(
    wsItems,
    itemHeaderRow + 1 + Math.max(1, flatItems.length),
    [14, 26, 20, 32, 10, 16, 18, 12],
    itemHeaderRow
  );
  XLSX.utils.book_append_sheet(wb, wsItems, 'اقلام ریز فاکتورها');

  // =========================================================================
  // Sheet 5: خلاصه هزینه به تفکیک مسئول خرید
  // =========================================================================
  const wsPurchasers: XLSX.WorkSheet = {};
  const purchaserHeaders = [
    'مسئول خرید / پرداخت‌کننده',
    'تعداد سند',
    `مجموع کل هزینه (${unitLabel})`,
    `از کارت/تنخواه شخصی (${unitLabel})`,
    `مانده تسویه‌نشده (${unitLabel})`,
    'سهم از کل (٪)',
  ];
  const P_COLS = purchaserHeaders.length;
  const purchaserRows = computePurchaserBreakdown(expenses, rates);

  applyBannerRow(
    wsPurchasers,
    0,
    P_COLS,
    `جمع هزینه و تنخواه به تفکیک مسئول خرید (${unitLabel})`,
    TITLE_STYLE
  );
  applyBannerRow(
    wsPurchasers,
    1,
    P_COLS,
    `تعداد کل افراد ثبت‌شده: ${toPersianDigits(purchaserRows.filter((r) => !r.isUnassigned).length)} نفر`,
    SUBTITLE_STYLE
  );

  const pHeaderRow = 3;
  purchaserHeaders.forEach((h, c) => setCell(wsPurchasers, pHeaderRow, c, h, HEADER_STYLE));

  let pTotalAll = 0;
  let pTotalPersonal = 0;
  let pTotalPending = 0;
  purchaserRows.forEach((row, idx) => {
    const r = pHeaderRow + 1 + idx;
    const isEven = idx % 2 === 1;
    const totalD = convertTomanToDisplayUnit(row.totalIRT, displayUnit);
    const personalD = convertTomanToDisplayUnit(row.personalOutOfPocketIRT, displayUnit);
    const pendingD = convertTomanToDisplayUnit(row.pendingIRT, displayUnit);
    pTotalAll += totalD;
    pTotalPersonal += personalD;
    pTotalPending += pendingD;

    setCell(wsPurchasers, r, 0, row.label, makeDataCellStyle(isEven));
    setCell(wsPurchasers, r, 1, row.count, makeDataCellStyle(isEven, { center: true }));
    setCell(wsPurchasers, r, 2, totalD, makeDataCellStyle(isEven, { num: true }));
    setCell(wsPurchasers, r, 3, personalD, makeDataCellStyle(isEven, { num: true }));
    setCell(wsPurchasers, r, 4, pendingD, makeWarningNumStyle(pendingD > 0, isEven));
    setCell(
      wsPurchasers,
      r,
      5,
      `${toPersianDigits(row.sharePercent)}٪`,
      makeDataCellStyle(isEven, { center: true })
    );
  });

  const pTotalRow = pHeaderRow + 1 + Math.max(1, purchaserRows.length);
  for (let c = 0; c < P_COLS; c += 1) {
    let val: string | number = '';
    if (c === 0) val = 'جمع کل';
    else if (c === 1) val = expenses.length;
    else if (c === 2) val = pTotalAll;
    else if (c === 3) val = pTotalPersonal;
    else if (c === 4) val = pTotalPending;
    else if (c === 5) val = expenses.length > 0 ? '۱۰۰٪' : '۰٪';
    setCell(wsPurchasers, pTotalRow, c, val, TOTAL_ROW_STYLE);
  }

  finalizeSheet(wsPurchasers, pTotalRow + 1, [26, 13, 22, 24, 22, 16], pHeaderRow);
  XLSX.utils.book_append_sheet(wb, wsPurchasers, 'خلاصه مسئولان خرید');

  return wb;
}

export function exportExpensesToXlsxBuffer(
  expenses: ExpenseRecord[],
  budgets: CategoryBudget[],
  rates: ExchangeRates,
  displayUnit: DisplayUnit = 'IRT',
  categories?: CategoryDefinition[]
): Uint8Array {
  const wb = buildExpenseWorkbook(expenses, budgets, rates, displayUnit, categories);
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer | Uint8Array;
  return out instanceof Uint8Array ? out : new Uint8Array(out);
}

export async function downloadExpensesExcel(
  expenses: ExpenseRecord[],
  budgets: CategoryBudget[],
  rates: ExchangeRates,
  displayUnit: DisplayUnit,
  filename: string,
  categories?: CategoryDefinition[]
): Promise<void> {
  const bytes = exportExpensesToXlsxBuffer(expenses, budgets, rates, displayUnit, categories);
  if(isAndroidRuntime()){await nativeExportFile(filename.endsWith('.xlsx')?filename:filename+'.xlsx',bytes,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');return;}
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
