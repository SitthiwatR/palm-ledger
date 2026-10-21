export type ReceiptBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function paperBounds(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): ReceiptBounds {
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) {
    const r = rgba[i * 4],
      g = rgba[i * 4 + 1],
      b = rgba[i * 4 + 2];
    if (
      r > 125 &&
      g > 115 &&
      b > 95 &&
      r >= b * 0.92 &&
      Math.max(r, g, b) - Math.min(r, g, b) < 100
    )
      mask[i] = 1;
  }
  const queue = new Int32Array(mask.length);
  let largest = 0,
    bounds = { x: 0, y: 0, width, height };
  for (let start = 0; start < mask.length; start++) {
    if (mask[start] !== 1) continue;
    let head = 0,
      tail = 1,
      minX = width,
      maxX = 0,
      minY = height,
      maxY = 0;
    queue[0] = start;
    mask[start] = 2;
    while (head < tail) {
      const point = queue[head++],
        x = point % width,
        y = Math.floor(point / width);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      for (const next of [
        x > 0 ? point - 1 : -1,
        x < width - 1 ? point + 1 : -1,
        y > 0 ? point - width : -1,
        y < height - 1 ? point + width : -1,
      ]) {
        if (next >= 0 && mask[next] === 1) {
          mask[next] = 2;
          queue[tail++] = next;
        }
      }
    }
    if (tail > largest) {
      largest = tail;
      bounds = {
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
      };
    }
  }
  if (
    largest < width * height * 0.18 ||
    bounds.width < width * 0.3 ||
    bounds.height < height * 0.2
  )
    return { x: 0, y: 0, width, height };
  const padding = Math.ceil(Math.max(width, height) * 0.015);
  const x = Math.max(0, bounds.x - padding),
    y = Math.max(0, bounds.y - padding);
  return {
    x,
    y,
    width: Math.min(width, bounds.x + bounds.width + padding) - x,
    height: Math.min(height, bounds.y + bounds.height + padding) - y,
  };
}

export function receiptInk(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
) {
  const gray = new Uint8Array(width * height),
    stride = width + 1;
  const integral = new Uint32Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      // Colored ink (especially blue carbon copies) is clearer in the darkest
      // color channel; local brightness removes folds and uneven lighting.
      gray[i] = Math.min(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
      sum += gray[i];
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + sum;
    }
  }
  const radius = Math.max(8, Math.round(width / 45)),
    mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const left = Math.max(0, x - radius),
        right = Math.min(width, x + radius + 1),
        top = Math.max(0, y - radius),
        bottom = Math.min(height, y + radius + 1);
      const sum =
        integral[bottom * stride + right] -
        integral[top * stride + right] -
        integral[bottom * stride + left] +
        integral[top * stride + left];
      const mean = sum / ((right - left) * (bottom - top));
      mask[y * width + x] = gray[y * width + x] < mean * 0.88 ? 1 : 0;
    }
  return mask;
}

export function receiptSkew(mask: Uint8Array, width: number, height: number) {
  const points: number[] = [];
  for (let y = 2; y < height - 2; y += 2)
    for (let x = 2; x < width - 2; x += 2)
      if (mask[y * width + x]) points.push(x, y);
  if (points.length < 100) return 0;
  const sample = Math.max(1, Math.ceil(points.length / 100000)),
    offset = width + 10;
  let best = 0,
    bestScore = 0,
    zeroScore = 0;
  for (let half = -10; half <= 10; half++) {
    const angle = (half * 0.5 * Math.PI) / 180,
      sine = Math.sin(angle),
      cosine = Math.cos(angle);
    const projection = new Uint32Array(width * 2 + height + 30);
    for (let i = 0; i < points.length; i += 2 * sample)
      projection[
        Math.round(points[i + 1] * cosine - points[i] * sine) + offset
      ]++;
    const score = projection.reduce((sum, value) => sum + value * value, 0);
    if (half === 0) zeroScore = score;
    if (score > bestScore) {
      bestScore = score;
      best = half * 0.5;
    }
  }
  return bestScore > zeroScore * 1.12 ? best : 0;
}

export function removeReceiptRules(
  mask: Uint8Array,
  width: number,
  height: number,
) {
  const clean = mask.slice();
  const horizontal = Math.max(100, Math.floor(width * 0.18)),
    vertical = Math.max(80, Math.floor(height * 0.16));
  for (let y = 0; y < height; y++) {
    let start = -1;
    for (let x = 0; x <= width; x++) {
      if (x < width && mask[y * width + x]) {
        if (start < 0) start = x;
      } else if (start >= 0) {
        if (x - start >= horizontal)
          clean.fill(0, y * width + start, y * width + x);
        start = -1;
      }
    }
  }
  // Photographed rules remain slightly slanted even after deskew/perspective.
  // Follow long runs at nearby angles, allowing tiny gaps in dotted rules.
  for (let half = -6; half <= 6; half++) {
    const slope = Math.tan((half * 0.5 * Math.PI) / 180),
      gapLimit = Math.max(3, Math.round(width / 500));
    for (
      let origin = -Math.ceil(width * Math.abs(slope));
      origin < height + Math.ceil(width * Math.abs(slope));
      origin++
    ) {
      let start = -1,
        last = -1;
      const erase = () => {
        if (start >= 0 && last - start >= horizontal)
          for (let at = start; at <= last; at++) {
            const y = origin + Math.round(at * slope);
            for (let dy = -1; dy <= 1; dy++)
              if (y + dy >= 0 && y + dy < height)
                clean[(y + dy) * width + at] = 0;
          }
      };
      for (let x = 0; x <= width; x++) {
        const y = origin + Math.round(x * slope),
          ink = x < width && y >= 0 && y < height && mask[y * width + x];
        if (ink) {
          if (start < 0) start = x;
          last = x;
        } else if (start >= 0 && (x === width || x - last > gapLimit)) {
          erase();
          start = -1;
          last = -1;
        }
      }
    }
  }
  for (let x = 0; x < width; x++) {
    let start = -1;
    for (let y = 0; y <= height; y++) {
      if (y < height && mask[y * width + x]) {
        if (start < 0) start = y;
      } else if (start >= 0) {
        if (y - start >= vertical)
          for (let at = start; at < y; at++) clean[at * width + x] = 0;
        start = -1;
      }
    }
  }
  return clean;
}
