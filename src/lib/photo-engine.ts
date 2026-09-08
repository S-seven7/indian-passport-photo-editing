import {
  FACE_COVERAGE_MAX,
  FACE_COVERAGE_MIN,
  MAX_FILE_BYTES,
  MIN_FILE_BYTES,
  PASSPORT_HEIGHT,
  PASSPORT_WIDTH,
} from "./passport-spec";

export type CheckStatus = "pass" | "fail" | "warn";

export type PhotoCheck = {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  value?: string;
};

export type PhotoAnalysis = {
  width: number;
  height: number;
  overallLuma: number;
  faceLuma: number;
  faceStd: number;
  backgroundLuma: number;
  leftLuma: number;
  rightLuma: number;
  highlightClip: number;
  shadowClip: number;
  warmth: number;
  backgroundIsLight: boolean;
  lightingIssue: "too-dark" | "too-light" | "uneven" | "low-contrast" | null;
  checks: PhotoCheck[];
  failedCount: number;
};

export type Adjustments = {
  exposure: number;
  contrast: number;
  evenLight: number;
  whiteBackground: number;
};

export const NEUTRAL_ADJUSTMENTS: Adjustments = {
  exposure: 0,
  contrast: 0.12,
  evenLight: 0,
  whiteBackground: 0,
};

type Rgb = { r: number; g: number; b: number };

function luma(r: number, g: number, b: number) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function idx(x: number, y: number, width: number) {
  return (y * width + x) * 4;
}

function sampleRect(
  data: Uint8ClampedArray,
  width: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): { mean: number; std: number; clipLow: number; clipHigh: number; rgb: Rgb } {
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  let clipLow = 0;
  let clipHigh = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  const xa = Math.max(0, Math.floor(x0));
  const ya = Math.max(0, Math.floor(y0));
  const xb = Math.min(width - 1, Math.ceil(x1));
  const yb = Math.min(data.length / 4 / width - 1, Math.ceil(y1));

  for (let y = ya; y <= yb; y += 2) {
    for (let x = xa; x <= xb; x += 2) {
      const i = idx(x, y, width);
      const rv = data[i];
      const gv = data[i + 1];
      const bv = data[i + 2];
      const yv = luma(rv, gv, bv);
      sum += yv;
      sumSq += yv * yv;
      r += rv;
      g += gv;
      b += bv;
      count += 1;
      if (yv < 18) clipLow += 1;
      if (yv > 245) clipHigh += 1;
    }
  }

  if (count === 0) {
    return { mean: 0, std: 0, clipLow: 0, clipHigh: 0, rgb: { r: 0, g: 0, b: 0 } };
  }

  const mean = sum / count;
  const variance = Math.max(0, sumSq / count - mean * mean);
  return {
    mean,
    std: Math.sqrt(variance),
    clipLow: clipLow / count,
    clipHigh: clipHigh / count,
    rgb: { r: r / count, g: g / count, b: b / count },
  };
}

function isSkin(r: number, g: number, b: number) {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  if (y < 32 || y > 245) return false;
  if (r < 35) return false;
  if (g > r + 18) return false;
  if (cr < 122 || cr > 185) return false;
  if (cb < 72 || cb > 142) return false;
  return true;
}

export function findFaceBox(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): { cx: number; cy: number; faceH: number; faceW: number } | null {
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let count = 0;
  let sx = 0;
  let sy = 0;

  for (let y = 0; y < Math.floor(height * 0.88); y += 2) {
    for (let x = 0; x < width; x += 2) {
      const i = idx(x, y, width);
      if (!isSkin(data[i], data[i + 1], data[i + 2])) continue;
      count += 1;
      sx += x;
      sy += y;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (count < width * height * 0.008) return null;

  const faceW = Math.max(24, maxX - minX);
  const faceH = Math.max(24, maxY - minY);
  return {
    cx: sx / count,
    cy: sy / count,
    faceW,
    faceH,
  };
}

export function computePassportCrop(
  srcW: number,
  srcH: number,
  face: { cx: number; cy: number; faceH: number; faceW: number } | null,
) {
  const aspect = PASSPORT_WIDTH / PASSPORT_HEIGHT;
  let cropW: number;
  let cropH: number;
  let cx = srcW / 2;
  let cy = srcH / 2;

  if (face) {
    const targetCoverage = (FACE_COVERAGE_MIN + FACE_COVERAGE_MAX) / 2;
    cropH = face.faceH / targetCoverage;
    cropW = cropH * aspect;
    cx = face.cx;
    cy = face.cy + face.faceH * 0.18;
  } else if (srcW / srcH > aspect) {
    cropH = srcH;
    cropW = srcH * aspect;
  } else {
    cropW = srcW;
    cropH = srcW / aspect;
  }

  if (cropW > srcW) {
    const scale = srcW / cropW;
    cropW *= scale;
    cropH *= scale;
  }
  if (cropH > srcH) {
    const scale = srcH / cropH;
    cropW *= scale;
    cropH *= scale;
  }

  let x = cx - cropW / 2;
  let y = cy - cropH / 2;
  x = clamp(x, 0, srcW - cropW);
  y = clamp(y, 0, srcH - cropH);

  return { x, y, w: cropW, h: cropH };
}

function check(
  id: string,
  label: string,
  status: CheckStatus,
  detail: string,
  value?: string,
): PhotoCheck {
  return { id, label, status, detail, value };
}

export function analyzePhoto(
  imageData: ImageData,
  extras?: { fileBytes?: number; mime?: string },
): PhotoAnalysis {
  const { width, height, data } = imageData;
  const insetX = width * 0.12;
  const insetY = height * 0.12;
  const corners = [
    sampleRect(data, width, 0, 0, insetX, insetY),
    sampleRect(data, width, width - insetX, 0, width, insetY),
    sampleRect(data, width, 0, height - insetY, insetX, height),
    sampleRect(data, width, width - insetX, height - insetY, width, height),
  ];
  const backgroundLuma =
    corners.reduce((sum, c) => sum + c.mean, 0) / corners.length;
  const backgroundRgb = {
    r: corners.reduce((s, c) => s + c.rgb.r, 0) / corners.length,
    g: corners.reduce((s, c) => s + c.rgb.g, 0) / corners.length,
    b: corners.reduce((s, c) => s + c.rgb.b, 0) / corners.length,
  };

  const faceRegion = sampleRect(
    data,
    width,
    width * 0.28,
    height * 0.16,
    width * 0.72,
    height * 0.62,
  );
  const overall = sampleRect(data, width, 0, 0, width, height);
  const left = sampleRect(
    data,
    width,
    width * 0.22,
    height * 0.18,
    width * 0.48,
    height * 0.6,
  );
  const right = sampleRect(
    data,
    width,
    width * 0.52,
    height * 0.18,
    width * 0.78,
    height * 0.6,
  );

  const warmth = backgroundRgb.r - backgroundRgb.b;
  const bgSpread = Math.max(...corners.map((c) => c.mean)) - Math.min(...corners.map((c) => c.mean));
  const backgroundIsLight = backgroundLuma >= 168;
  const faceBgGap = Math.abs(faceRegion.mean - backgroundLuma);
  const sideDiff = Math.abs(left.mean - right.mean);

  let lightingIssue: PhotoAnalysis["lightingIssue"] = null;
  if (faceRegion.mean < 92 || faceRegion.clipLow > 0.12) lightingIssue = "too-dark";
  else if (faceRegion.mean > 188 || faceRegion.clipHigh > 0.1) lightingIssue = "too-light";
  else if (sideDiff > 22) lightingIssue = "uneven";
  else if (faceBgGap < 28 || faceRegion.std < 16) lightingIssue = "low-contrast";

  const checks: PhotoCheck[] = [
    check(
      "exposure",
      "Face brightness",
      lightingIssue === "too-dark" || lightingIssue === "too-light" ? "fail" : "pass",
      lightingIssue === "too-dark"
        ? "The face is underexposed. Passport Seva flags this as too dark."
        : lightingIssue === "too-light"
          ? "Highlights are washed out. The portal reads this as too light."
          : "Skin tones sit in a usable midrange.",
      `${Math.round(faceRegion.mean)} / 255`,
    ),
    check(
      "standout",
      "Face stands off the background",
      faceBgGap < 28 || !backgroundIsLight ? "fail" : faceBgGap < 40 ? "warn" : "pass",
      !backgroundIsLight
        ? "Background is not light enough, so the face does not separate cleanly."
        : faceBgGap < 28
          ? "Face and background are too similar in brightness."
          : "There is enough contrast between the face and the wall behind you.",
      `gap ${Math.round(faceBgGap)}`,
    ),
    check(
      "even",
      "Even lighting",
      sideDiff > 22 ? "fail" : sideDiff > 14 ? "warn" : "pass",
      sideDiff > 22
        ? "One side of the face is distinctly brighter than the other."
        : "Left and right sides of the face are close in brightness.",
      `Δ ${Math.round(sideDiff)}`,
    ),
    check(
      "background",
      "Light / white background",
      backgroundIsLight && bgSpread < 28 ? "pass" : backgroundLuma >= 140 ? "warn" : "fail",
      backgroundIsLight
        ? bgSpread >= 28
          ? "The wall is light but uneven — shadows or a colour cast are still visible."
          : "Corner samples look like a light backdrop."
        : "Stand farther from a plain white wall. Grey, cream, or shadowed walls fail this check.",
      `${Math.round(backgroundLuma)} luma`,
    ),
    check(
      "features",
      "Features in focus (local contrast)",
      faceRegion.std < 14 ? "fail" : faceRegion.std < 18 ? "warn" : "pass",
      faceRegion.std < 14
        ? "The face is flat — eyes, nose, and mouth do not stand out."
        : "Enough detail remains in the facial features.",
      `σ ${faceRegion.std.toFixed(1)}`,
    ),
    check(
      "pixels",
      "Passport Seva size",
      width === PASSPORT_WIDTH && height === PASSPORT_HEIGHT ? "pass" : "fail",
      width === PASSPORT_WIDTH && height === PASSPORT_HEIGHT
        ? "Exactly 630 × 810 pixels."
        : `Currently ${width} × ${height}. The upload must be 630 × 810.`,
    ),
  ];

  if (extras?.fileBytes != null) {
    const ok =
      extras.fileBytes >= MIN_FILE_BYTES && extras.fileBytes <= MAX_FILE_BYTES;
    checks.push(
      check(
        "filesize",
        "JPEG file size",
        ok ? "pass" : "fail",
        ok
          ? "Within the 20–250 KB GPSP 2.0 window."
          : `File is ${formatBytes(extras.fileBytes)}. Target 20–250 KB.`,
        formatBytes(extras.fileBytes),
      ),
    );
  }

  if (extras?.mime && extras.mime !== "image/jpeg") {
    checks.push(
      check(
        "format",
        "JPEG format",
        "fail",
        `This file is ${extras.mime}. Export a .jpg before uploading.`,
      ),
    );
  }

  return {
    width,
    height,
    overallLuma: overall.mean,
    faceLuma: faceRegion.mean,
    faceStd: faceRegion.std,
    backgroundLuma,
    leftLuma: left.mean,
    rightLuma: right.mean,
    highlightClip: faceRegion.clipHigh,
    shadowClip: faceRegion.clipLow,
    warmth,
    backgroundIsLight,
    lightingIssue,
    checks,
    failedCount: checks.filter((c) => c.status === "fail").length,
  };
}

export function suggestAdjustments(analysis: PhotoAnalysis): Adjustments {
  let exposure = 0;
  if (analysis.faceLuma < 118) {
    exposure = clamp((125 - analysis.faceLuma) / 90, 0, 0.85);
  } else if (analysis.faceLuma > 168) {
    exposure = clamp((160 - analysis.faceLuma) / 90, -0.7, 0);
  }

  let contrast = 0.16;
  if (analysis.faceStd < 22) contrast += (22 - analysis.faceStd) / 50;
  contrast = clamp(contrast, 0.08, 0.55);

  const evenLight = clamp((analysis.rightLuma - analysis.leftLuma) / 36, -1, 1);

  const whiteBackground = analysis.backgroundLuma >= 132 ? 0.94 : 0;

  return { exposure, contrast, evenLight, whiteBackground };
}

function colorDist(r: number, g: number, b: number, seed: Rgb) {
  const dr = r - seed.r;
  const dg = g - seed.g;
  const db = b - seed.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function buildBackgroundMask(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number,
): Float32Array {
  const mask = new Float32Array(width * height);
  const visited = new Uint8Array(width * height);
  const qx = new Int32Array(width * height);
  const qy = new Int32Array(width * height);
  let qs = 0;
  let qe = 0;

  const seedPoints = [
    [4, 4],
    [width - 5, 4],
    [4, height - 5],
    [width - 5, height - 5],
    [Math.floor(width / 2), 4],
  ] as const;
  const seed: Rgb = { r: 0, g: 0, b: 0 };
  for (const [sx, sy] of seedPoints) {
    const i = idx(sx, sy, width);
    seed.r += data[i];
    seed.g += data[i + 1];
    seed.b += data[i + 2];
  }
  seed.r /= seedPoints.length;
  seed.g /= seedPoints.length;
  seed.b /= seedPoints.length;

  const enqueue = (x: number, y: number) => {
    const p = y * width + x;
    if (visited[p]) return;
    visited[p] = 1;
    qx[qe] = x;
    qy[qe] = y;
    qe += 1;
  };

  for (let x = 0; x < width; x += 1) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }

  while (qs < qe) {
    const x = qx[qs];
    const y = qy[qs];
    qs += 1;
    const i = idx(x, y, width);
    if (colorDist(data[i], data[i + 1], data[i + 2], seed) > threshold) continue;
    mask[y * width + x] = 1;
    if (x > 0) enqueue(x - 1, y);
    if (x + 1 < width) enqueue(x + 1, y);
    if (y > 0) enqueue(x, y - 1);
    if (y + 1 < height) enqueue(x, y + 1);
  }

  return blurMask(mask, width, height, 3);
}

function blurMask(src: Float32Array, width: number, height: number, radius: number) {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const span = radius * 2 + 1;

  for (let y = 0; y < height; y += 1) {
    let acc = 0;
    for (let k = -radius; k <= radius; k += 1) {
      acc += src[y * width + clamp(k, 0, width - 1)];
    }
    for (let x = 0; x < width; x += 1) {
      tmp[y * width + x] = acc / span;
      acc += src[y * width + clamp(x + radius + 1, 0, width - 1)];
      acc -= src[y * width + clamp(x - radius, 0, width - 1)];
    }
  }

  for (let x = 0; x < width; x += 1) {
    let acc = 0;
    for (let k = -radius; k <= radius; k += 1) {
      acc += tmp[clamp(k, 0, height - 1) * width + x];
    }
    for (let y = 0; y < height; y += 1) {
      out[y * width + x] = acc / span;
      acc += tmp[clamp(y + radius + 1, 0, height - 1) * width + x];
      acc -= tmp[clamp(y - radius, 0, height - 1) * width + x];
    }
  }

  return out;
}

function applyCurve(value: number, exposure: number, contrast: number, pivot: number) {
  let t = value / 255;
  const gamma = 1 / Math.pow(2, exposure);
  t = Math.pow(Math.max(t, 0), gamma);
  const c = 1 + contrast * 1.6;
  t = (t - pivot) * c + pivot;
  return clamp(t * 255, 0, 255);
}

export function applyFix(source: ImageData, adjustments: Adjustments): ImageData {
  const { width, height } = source;
  const src = source.data;
  const out = new ImageData(width, height);
  const dest = out.data;
  dest.set(src);

  const corner = sampleRect(src, width, 0, 0, width * 0.1, height * 0.1);
  const canWhiten =
    adjustments.whiteBackground > 0.05 && corner.mean >= 125;
  const mask = canWhiten
    ? buildBackgroundMask(src, width, height, 48 + (1 - adjustments.whiteBackground) * 24)
    : null;

  const pivot = clamp(sampleRect(src, width, width * 0.3, height * 0.18, width * 0.7, height * 0.58).mean / 255, 0.28, 0.62);
  const sideBoost = (adjustments.evenLight || 0) * 0.22;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = idx(x, y, width);
      const bg = mask ? mask[y * width + x] * adjustments.whiteBackground : 0;
      let r = src[i];
      let g = src[i + 1];
      let b = src[i + 2];

      if (bg < 0.92) {
        const even = ((0.5 - x / width) * 2) * sideBoost * 255;
        r = applyCurve(r + even, adjustments.exposure, adjustments.contrast, pivot);
        g = applyCurve(g + even, adjustments.exposure, adjustments.contrast, pivot);
        b = applyCurve(b + even, adjustments.exposure, adjustments.contrast, pivot);
      }

      if (bg > 0) {
        r = r * (1 - bg) + 255 * bg;
        g = g * (1 - bg) + 255 * bg;
        b = b * (1 - bg) + 255 * bg;
      }

      dest[i] = r;
      dest[i + 1] = g;
      dest[i + 2] = b;
      dest[i + 3] = 255;
    }
  }

  return out;
}

export async function loadImageBitmap(file: Blob): Promise<ImageBitmap> {
  return createImageBitmap(file, { imageOrientation: "from-image" });
}

export function bitmapToWorkingCanvas(bitmap: ImageBitmap, maxSide = 1600) {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas is not available in this browser.");
  ctx.drawImage(bitmap, 0, 0, width, height);
  return canvas;
}

export function cropToPassport(source: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = source.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas is not available in this browser.");
  const imageData = ctx.getImageData(0, 0, source.width, source.height);
  const face = findFaceBox(imageData.data, source.width, source.height);
  const crop = computePassportCrop(source.width, source.height, face);

  const canvas = document.createElement("canvas");
  canvas.width = PASSPORT_WIDTH;
  canvas.height = PASSPORT_HEIGHT;
  const out = canvas.getContext("2d", { willReadFrequently: true });
  if (!out) throw new Error("Canvas is not available in this browser.");
  out.imageSmoothingEnabled = true;
  out.imageSmoothingQuality = "high";
  out.drawImage(
    source,
    crop.x,
    crop.y,
    crop.w,
    crop.h,
    0,
    0,
    PASSPORT_WIDTH,
    PASSPORT_HEIGHT,
  );
  return canvas;
}

export function canvasFromImageData(imageData: ImageData) {
  const canvas = document.createElement("canvas");
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available in this browser.");
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 100 ? 0 : 1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

export async function encodePassportJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  const toBlob = (quality: number) =>
    new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) reject(new Error("Could not encode JPEG."));
          else resolve(blob);
        },
        "image/jpeg",
        quality,
      );
    });

  let lo = 0.45;
  let hi = 0.95;
  let best = await toBlob(0.88);

  for (let i = 0; i < 8; i += 1) {
    const mid = (lo + hi) / 2;
    const blob = await toBlob(mid);
    best = blob;
    if (blob.size > MAX_FILE_BYTES) hi = mid;
    else if (blob.size < MIN_FILE_BYTES) lo = mid;
    else return blob;
  }

  if (best.size > MAX_FILE_BYTES) {
    best = await toBlob(0.42);
  }
  return best;
}

export function generateSampleRejectedPhoto(): Blob {
  const width = 900;
  const height = 1200;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available in this browser.");

  const wall = ctx.createLinearGradient(0, 0, width, 0);
  wall.addColorStop(0, "#6f6a62");
  wall.addColorStop(0.55, "#8d877c");
  wall.addColorStop(1, "#a39c90");
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "rgba(30, 24, 18, 0.28)";
  ctx.beginPath();
  ctx.ellipse(width * 0.5, height * 0.72, 230, 90, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#1d2430";
  ctx.beginPath();
  ctx.ellipse(width * 0.5, height * 0.92, 280, 220, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#2a1c16";
  ctx.beginPath();
  ctx.ellipse(width * 0.5, height * 0.34, 168, 210, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#5a3b2c";
  ctx.beginPath();
  ctx.ellipse(width * 0.5, height * 0.38, 132, 168, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#3a241c";
  ctx.beginPath();
  ctx.ellipse(width * 0.5, height * 0.22, 150, 90, 0, Math.PI, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#1a120e";
  ctx.beginPath();
  ctx.ellipse(width * 0.4, height * 0.36, 14, 10, 0, 0, Math.PI * 2);
  ctx.ellipse(width * 0.6, height * 0.36, 14, 10, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#2c1a14";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(width * 0.5, height * 0.4);
  ctx.lineTo(width * 0.5, height * 0.5);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(width * 0.5, height * 0.54, 28, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();

  ctx.fillStyle = "rgba(0,0,0,0.38)";
  ctx.fillRect(0, 0, width * 0.42, height);

  const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
  const raw = atob(dataUrl.split(",")[1]);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return new Blob([bytes], { type: "image/jpeg" });
}
