import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

export interface RenderedPage {
  pageNumber: number;
  dataUrl: string;
  base64: string;
  mimeType: string;
  width: number;
  height: number;
}

export async function renderPdfToImages(
  file: File,
  onProgress?: (current: number, total: number) => void,
  maxPages = 10
): Promise<{ pages: RenderedPage[]; totalPages: number }> {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  const totalPages = pdf.numPages;
  const count = Math.min(totalPages, maxPages);
  const pages: RenderedPage[] = [];

  for (let i = 1; i <= count; i++) {
    onProgress?.(i, count);
    const page = await pdf.getPage(i);
    const baseViewport = page.getViewport({ scale: 1 });
    const targetWidth = 1500;
    const scale = Math.min(2.4, Math.max(1.4, targetWidth / baseViewport.width));
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('مرورگر امکان رندر صفحه PDF را ندارد.');
    }

    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({
      canvasContext: context,
      viewport,
      canvas,
    }).promise;

    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    const base64 = dataUrl.split(',')[1] ?? '';
    pages.push({
      pageNumber: i,
      dataUrl,
      base64,
      mimeType: 'image/jpeg',
      width: canvas.width,
      height: canvas.height,
    });
  }

  return { pages, totalPages };
}

export async function fileToCompressedImage(file: File): Promise<RenderedPage> {
  const bitmapUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('فایل تصویر قابل خواندن نیست.'));
      el.src = bitmapUrl;
    });

    const maxDim = 1600;
    let width = img.naturalWidth || img.width;
    let height = img.naturalHeight || img.height;
    if (width > maxDim || height > maxDim) {
      const ratio = Math.min(maxDim / width, maxDim / height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('خطا در پردازش تصویر.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    const base64 = dataUrl.split(',')[1] ?? '';

    return {
      pageNumber: 1,
      dataUrl,
      base64,
      mimeType: 'image/jpeg',
      width,
      height,
    };
  } finally {
    URL.revokeObjectURL(bitmapUrl);
  }
}

export function createThumbnailDataUrl(sourceDataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const maxWidth = 420;
      const ratio = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * ratio);
      canvas.height = Math.round(img.height * ratio);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(sourceDataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = () => resolve(sourceDataUrl);
    img.src = sourceDataUrl;
  });
}
