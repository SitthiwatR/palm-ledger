import {
  mergeReceiptDrafts,
  needsReceiptRetry,
  parseReceipt,
  recoverReceiptWeight,
} from "../lib/receipt-parser";
import { receiptRows, netWeightRegion } from "../lib/receipt-layout";
import { enhanceReceiptImage, receiptRegion } from "./receipt-image";

export function receiptMime(file: File) {
  const mime = file.type.toLowerCase();
  if (
    [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif",
    ].includes(mime)
  )
    return mime;
  const extension = file.name.toLowerCase().split(".").at(-1);
  return (
    (
      {
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        webp: "image/webp",
        heic: "image/heic",
        heif: "image/heif",
      } as Record<string, string>
    )[extension ?? ""] ?? ""
  );
}
export async function prepareReceiptImage(file: File): Promise<Blob> {
  let image: Blob = file;
  if (["image/heic", "image/heif"].includes(receiptMime(file))) {
    const { heicTo } = await import("heic-to/csp");
    image = await heicTo({ blob: file, type: "image/jpeg", quality: 0.95 });
  }
  const url = URL.createObjectURL(image);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(
      1,
      2400 / Math.max(img.naturalWidth, img.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("ไม่สามารถเตรียมภาพได้");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error("ไม่สามารถเตรียมภาพได้")),
        "image/png",
      ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
export async function readReceipt(
  image: Blob,
  signal: AbortSignal,
  onProgress: (status: string) => void,
) {
  const { createWorker, OEM, PSM } = await import("tesseract.js");
  signal.throwIfAborted();
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
  let abort: () => void = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(new DOMException("ยกเลิกการอ่านบิล", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([
      cancelled,
      (async () => {
        onProgress("กำลังปรับภาพและจัดแนวตารางบิล…");
        const prepared = await enhanceReceiptImage(image);
        signal.throwIfAborted();
        onProgress("กำลังเตรียมตัวอ่านภาษาไทยและอังกฤษ…");
        worker = await createWorker(["tha", "eng"], OEM.LSTM_ONLY, {
          workerPath: "/ocr/worker.min.js",
          corePath: "/ocr",
          langPath: "/ocr",
          workerBlobURL: false,
          logger: (progress) => {
            if (!signal.aborted && progress.status === "recognizing text")
              onProgress(
                `กำลังอ่านบิล ${Math.round(progress.progress * 100)}%`,
              );
          },
          errorHandler: () => {},
        });
        if (signal.aborted) {
          await worker.terminate();
          signal.throwIfAborted();
        }
        await worker.setParameters({
          tessedit_pageseg_mode: PSM.SPARSE_TEXT,
          preserve_interword_spaces: "1",
        });
        const drafts = [];
        let preparedWeightRegion: ReturnType<typeof netWeightRegion> = null;
        for (const [index, variant] of [
          prepared.cleanImage,
          prepared.fallbackImage,
          image,
        ].entries()) {
          signal.throwIfAborted();
          if (index) {
            onProgress("กำลังตรวจช่องตารางที่อ่านไม่ชัดอีกครั้ง…");
            await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
          }
          const { data } = await worker.recognize(
            variant,
            {},
            { text: true, blocks: true },
          );
          signal.throwIfAborted();
          const words =
            data.blocks?.flatMap((block) =>
              block.paragraphs.flatMap((paragraph) =>
                paragraph.lines.flatMap((line) => line.words),
              ),
            ) ?? [];
          const foundRegion = netWeightRegion(words);
          // Clean/color copies share coordinates. Reuse a recognized label on
          // the clean copy; the original image has its own coordinate space.
          const weightRegion =
            index < 2 ? (preparedWeightRegion ??= foundRegion) : foundRegion;
          const rows = receiptRows(words);
          drafts.push(parseReceipt(rows || data.text, data.confidence));
          if (rows && rows !== data.text)
            drafts.push(parseReceipt(data.text, data.confidence));
          let result = mergeReceiptDrafts(drafts);
          if (
            needsReceiptRetry(result) &&
            result.priceBahtPerKg &&
            result.printedNetBaht
          ) {
            const focused = weightRegion
              ? await receiptRegion(
                  index < 2 ? prepared.cleanImage : image,
                  weightRegion,
                )
              : null;
            if (focused) {
              onProgress("กำลังตรวจน้ำหนักสุทธิในช่องตาราง…");
              await worker.setParameters({
                tessedit_pageseg_mode: PSM.SINGLE_LINE,
                tessedit_char_whitelist: "0123456789,.",
              });
              const cell = await worker.recognize(focused);
              signal.throwIfAborted();
              const recovered = recoverReceiptWeight(result, cell.data.text);
              if (recovered) {
                drafts.push(recovered);
                result = mergeReceiptDrafts(drafts);
              }
              await worker.setParameters({
                tessedit_pageseg_mode: index ? PSM.AUTO : PSM.SPARSE_TEXT,
                tessedit_char_whitelist: "",
              });
            }
          }
          if (!needsReceiptRetry(result) || index === 2) return result;
        }
        return mergeReceiptDrafts(drafts);
      })(),
    ]);
  } finally {
    signal.removeEventListener("abort", abort);
    await worker?.terminate().catch(() => {});
  }
}
