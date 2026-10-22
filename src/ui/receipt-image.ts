import {
  paperBounds,
  receiptInk,
  receiptSkew,
  removeReceiptRules,
} from "../lib/receipt-pixels";
import {
  receiptSelection,
  type ReceiptSelection,
} from "../lib/receipt-selection";

function canvas(width: number, height: number) {
  const element = document.createElement("canvas");
  element.width = width;
  element.height = height;
  const context = element.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("ไม่สามารถเตรียมภาพบิลได้");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  return { element, context };
}
const png = (element: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) =>
    element.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("ไม่สามารถเตรียมภาพบิลได้")),
      "image/png",
    ),
  );

export async function selectReceiptImage(
  image: Blob,
  selection: ReceiptSelection,
) {
  const url = URL.createObjectURL(image);
  let rotated: ReturnType<typeof canvas> | undefined;
  let cropped: ReturnType<typeof canvas> | undefined;
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const region = receiptSelection(
      img.naturalWidth,
      img.naturalHeight,
      selection,
    );
    rotated = canvas(region.rotatedWidth, region.rotatedHeight);
    rotated.context.translate(
      region.rotatedWidth / 2,
      region.rotatedHeight / 2,
    );
    rotated.context.rotate((selection.turns * Math.PI) / 2);
    rotated.context.drawImage(
      img,
      -img.naturalWidth / 2,
      -img.naturalHeight / 2,
    );
    cropped = canvas(region.width, region.height);
    cropped.context.drawImage(
      rotated.element,
      region.x,
      region.y,
      region.width,
      region.height,
      0,
      0,
      region.width,
      region.height,
    );
    return await png(cropped.element);
  } finally {
    URL.revokeObjectURL(url);
    for (const target of [rotated, cropped]) {
      if (target) {
        target.element.width = 1;
        target.element.height = 1;
      }
    }
  }
}

export async function enhanceReceiptImage(image: Blob) {
  const url = URL.createObjectURL(image);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const detectionScale = Math.min(
      1,
      640 / Math.max(img.naturalWidth, img.naturalHeight),
    );
    const detection = canvas(
      Math.max(1, Math.round(img.naturalWidth * detectionScale)),
      Math.max(1, Math.round(img.naturalHeight * detectionScale)),
    );
    detection.context.drawImage(
      img,
      0,
      0,
      detection.element.width,
      detection.element.height,
    );
    const found = paperBounds(
      detection.context.getImageData(
        0,
        0,
        detection.element.width,
        detection.element.height,
      ).data,
      detection.element.width,
      detection.element.height,
    );
    const source = {
      x: found.x / detectionScale,
      y: found.y / detectionScale,
      width: found.width / detectionScale,
      height: found.height / detectionScale,
    };
    const scale = Math.min(2.5, 2200 / Math.max(source.width, source.height));
    const cropped = canvas(
      Math.max(1, Math.round(source.width * scale)),
      Math.max(1, Math.round(source.height * scale)),
    );
    cropped.context.drawImage(
      img,
      source.x,
      source.y,
      source.width,
      source.height,
      0,
      0,
      cropped.element.width,
      cropped.element.height,
    );
    const skewScale = Math.min(
      1,
      700 / Math.max(cropped.element.width, cropped.element.height),
    );
    const tiny = canvas(
      Math.max(1, Math.round(cropped.element.width * skewScale)),
      Math.max(1, Math.round(cropped.element.height * skewScale)),
    );
    tiny.context.drawImage(
      cropped.element,
      0,
      0,
      tiny.element.width,
      tiny.element.height,
    );
    const skew = receiptSkew(
      receiptInk(
        tiny.context.getImageData(0, 0, tiny.element.width, tiny.element.height)
          .data,
        tiny.element.width,
        tiny.element.height,
      ),
      tiny.element.width,
      tiny.element.height,
    );
    const angle = (-skew * Math.PI) / 180,
      cos = Math.abs(Math.cos(angle)),
      sin = Math.abs(Math.sin(angle));
    const deskewed = canvas(
      Math.ceil(cropped.element.width * cos + cropped.element.height * sin),
      Math.ceil(cropped.element.height * cos + cropped.element.width * sin),
    );
    deskewed.context.translate(
      deskewed.element.width / 2,
      deskewed.element.height / 2,
    );
    deskewed.context.rotate(angle);
    deskewed.context.drawImage(
      cropped.element,
      -cropped.element.width / 2,
      -cropped.element.height / 2,
    );
    const fallbackImage = await png(deskewed.element);
    const { width, height } = deskewed.element;
    const pixels = deskewed.context.getImageData(0, 0, width, height);
    const mask = removeReceiptRules(
      receiptInk(pixels.data, width, height),
      width,
      height,
    );
    for (let i = 0; i < mask.length; i++) {
      const value = mask[i] ? 0 : 255;
      pixels.data[i * 4] = value;
      pixels.data[i * 4 + 1] = value;
      pixels.data[i * 4 + 2] = value;
      pixels.data[i * 4 + 3] = 255;
    }
    deskewed.context.putImageData(pixels, 0, 0);
    const cleanImage = await png(deskewed.element);
    // Release large canvas pixel buffers before loading the WASM OCR engine.
    for (const { element } of [detection, cropped, tiny, deskewed]) {
      element.width = 1;
      element.height = 1;
    }
    return { cleanImage, fallbackImage };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function receiptRegion(
  image: Blob,
  region: { x: number; y: number; height: number },
) {
  const bitmap = await createImageBitmap(image);
  try {
    const x = Math.floor(region.x),
      y = Math.floor(region.y),
      height = Math.min(region.height, bitmap.height - y),
      width = bitmap.width - x;
    if (width < 10 || height < 5) return null;
    const target = canvas(width + 40, height + 40);
    target.context.drawImage(
      bitmap,
      x,
      y,
      width,
      height,
      20,
      20,
      width,
      height,
    );
    const result = await png(target.element);
    target.element.width = 1;
    target.element.height = 1;
    return result;
  } finally {
    bitmap.close();
  }
}
