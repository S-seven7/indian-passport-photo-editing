import {
  SIGNATURE_COVERAGE_MAX,
  SIGNATURE_COVERAGE_MIN,
  SIGNATURE_HEIGHT,
  SIGNATURE_MAX_FILE_BYTES,
  SIGNATURE_WIDTH,
} from "./passport-spec";
import type { CheckStatus, PhotoCheck } from "./photo-engine";

export type SignatureCheck = PhotoCheck;

export type InkBox = {
  x: number;
  y: number;
  w: number;
  h: number;
  inkPixels: number;
};

export type SignatureAnalysis = {
  width: number;
  height: number;
  paperLuma: number;
  inkLuma: number;
  inkIsBlue: boolean;
  coverage: number;
  coverageX: number;
  coverageY: number;
  touchesEdge: boolean;
  strayMarks: number;
  looksLikePhoto: boolean;
  checks: SignatureCheck[];
  failedCount: number;
};

export type SignatureAdjustments = {
  inkBoost: number;
  whitePaper: number;
  coverage: number;
};

export const DEFAULT_SIGNATURE_ADJUSTMENTS: SignatureAdjustments = {
  inkBoost: 1,
  whitePaper: 1,
  coverage: 0.825,
};

function luma(r: number, g: number, b: number) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function chroma(r: number, g: number, b: number) {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function idx(x: number, y: number, width: number) {
  return (y * width + x) * 4;
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const i = clamp(Math.floor((sorted.length - 1) * p), 0, sorted.length - 1);
  return sorted[i];
}

function boxBlur(src: Float32Array, width: number, height: number, radius: number) {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const r = Math.max(1, radius);
  const span = r * 2 + 1;

  for (let y = 0; y < height; y += 1) {
    let sum = 0;
    const row = y * width;
    for (let x = -r; x <= r; x += 1) {
      sum += src[row + clamp(x, 0, width - 1)];
    }
    for (let x = 0; x < width; x += 1) {
      tmp[row + x] = sum / span;
      sum += src[row + clamp(x + r + 1, 0, width - 1)];
      sum -= src[row + clamp(x - r, 0, width - 1)];
    }
  }

  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let y = -r; y <= r; y += 1) {
      sum += tmp[clamp(y, 0, height - 1) * width + x];
    }
    for (let y = 0; y < height; y += 1) {
      out[y * width + x] = sum / span;
      sum += tmp[clamp(y + r + 1, 0, height - 1) * width + x];
      sum -= tmp[clamp(y - r, 0, height - 1) * width + x];
    }
  }

  return out;
}

function readLumaMap(data: Uint8ClampedArray, width: number, height: number) {
  const map = new Float32Array(width * height);
  for (let i = 0, p = 0; i < map.length; i += 1, p += 4) {
    map[i] = luma(data[p], data[p + 1], data[p + 2]);
  }
  return map;
}

function buildInkMask(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): { mask: Uint8Array; paperLuma: number; corrected: Float32Array } {
  const lumaMap = readLumaMap(data, width, height);
  const radius = Math.max(6, Math.round(Math.min(width, height) / 70));
  const blur = boxBlur(lumaMap, width, height, radius);
  const corrected = new Float32Array(lumaMap.length);
  const sample: number[] = [];
  const step = Math.max(1, Math.floor(lumaMap.length / 4000));
  for (let i = 0; i < lumaMap.length; i += step) {
    const local = Math.max(blur[i], 1);
    corrected[i] = (lumaMap[i] / local) * 220;
    sample.push(lumaMap[i]);
  }
  for (let i = 0; i < lumaMap.length; i += 1) {
    if (i % step === 0) continue;
    const local = Math.max(blur[i], 1);
    corrected[i] = (lumaMap[i] / local) * 220;
  }

  const paperLuma = percentile(sample, 0.9);
  const mask = new Uint8Array(lumaMap.length);
  for (let i = 0, p = 0; i < lumaMap.length; i += 1, p += 4) {
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    const c = chroma(r, g, b);
    const dark = lumaMap[i] < paperLuma - 18;
    const ratioDark = corrected[i] < 188;
    const blueInk = b > r + 12 && b > g + 4 && lumaMap[i] < paperLuma - 8;
    mask[i] = dark && (ratioDark || c > 14 || blueInk || lumaMap[i] < paperLuma - 36) ? 1 : 0;
  }
  return { mask, paperLuma, corrected };
}

type Component = { id: number; area: number; minX: number; minY: number; maxX: number; maxY: number };

function connectedInk(mask: Uint8Array, width: number, height: number) {
  const labels = new Int32Array(mask.length);
  const components: Component[] = [];
  let nextId = 1;
  const stack = new Int32Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const start = y * width + x;
      if (!mask[start] || labels[start]) continue;
      let top = 0;
      stack[top++] = start;
      labels[start] = nextId;
      let area = 0;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      while (top > 0) {
        const i = stack[--top];
        area += 1;
        const cx = i % width;
        const cy = (i / width) | 0;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        const neighbors = [i - 1, i + 1, i - width, i + width];
        for (const n of neighbors) {
          if (n < 0 || n >= mask.length || !mask[n] || labels[n]) continue;
          const nx = n % width;
          const ny = (n / width) | 0;
          if (Math.abs(nx - cx) + Math.abs(ny - cy) !== 1) continue;
          labels[n] = nextId;
          stack[top++] = n;
        }
      }
      components.push({ id: nextId, area, minX, minY, maxX, maxY });
      nextId += 1;
    }
  }
  return { labels, components };
}

function keepSignatureComponents(components: Component[]) {
  if (components.length === 0) return new Set<number>();
  const largest = components.reduce((a, b) => (a.area >= b.area ? a : b));
  const minArea = Math.max(24, Math.round(largest.area * 0.08));
  const keep = new Set<number>();
  for (const component of components) {
    const bw = component.maxX - component.minX + 1;
    const bh = component.maxY - component.minY + 1;
    if (component.area >= minArea && (bw >= 8 || bh >= 8 || component.area >= largest.area * 0.2)) {
      keep.add(component.id);
    }
  }
  if (keep.size === 0) keep.add(largest.id);
  return keep;
}

export function measureInk(image: ImageData): {
  box: InkBox | null;
  paperLuma: number;
  inkLuma: number;
  inkIsBlue: boolean;
  strayMarks: number;
  looksLikePhoto: boolean;
  mask: Uint8Array;
} {
  const { width, height, data } = image;
  const { mask, paperLuma } = buildInkMask(data, width, height);
  const { labels, components } = connectedInk(mask, width, height);
  const keep = keepSignatureComponents(components);
  const strayMarks = components.filter((component) => !keep.has(component.id)).length;

  const cleaned = new Uint8Array(mask.length);
  let inkPixels = 0;
  let inkLumaSum = 0;
  let blueVotes = 0;
  let colorVotes = 0;
  let midtoneColor = 0;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;

  for (let i = 0, p = 0; i < mask.length; i += 1, p += 4) {
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    const c = chroma(r, g, b);
    const y = luma(r, g, b);
    if (c > 36 && y > 40 && y < 190) midtoneColor += 1;
    if (!keep.has(labels[i])) continue;
    cleaned[i] = 1;
    inkPixels += 1;
    inkLumaSum += y;
    if (b > r + 8) blueVotes += 1;
    if (c > 18) colorVotes += 1;
    const x = i % width;
    const row = (i / width) | 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (row < minY) minY = row;
    if (row > maxY) maxY = row;
  }

  const looksLikePhoto = midtoneColor / Math.max(1, width * height) > 0.12;
  if (inkPixels < 40) {
    return {
      box: null,
      paperLuma,
      inkLuma: 255,
      inkIsBlue: false,
      strayMarks,
      looksLikePhoto,
      mask: cleaned,
    };
  }

  return {
    box: {
      x: minX,
      y: minY,
      w: maxX - minX + 1,
      h: maxY - minY + 1,
      inkPixels,
    },
    paperLuma,
    inkLuma: inkLumaSum / inkPixels,
    inkIsBlue: blueVotes > inkPixels * 0.35 && colorVotes > inkPixels * 0.2,
    strayMarks,
    looksLikePhoto,
    mask: cleaned,
  };
}

function statusForCoverage(coverage: number): CheckStatus {
  if (coverage >= SIGNATURE_COVERAGE_MIN && coverage <= SIGNATURE_COVERAGE_MAX + 0.03) return "pass";
  if (coverage >= 0.7 && coverage <= 0.95) return "warn";
  return "fail";
}

export function analyzeSignature(
  image: ImageData,
  meta?: { fileBytes?: number; mime?: string },
): SignatureAnalysis {
  const measured = measureInk(image);
  const box = measured.box;
  const coverageX = box ? box.w / image.width : 0;
  const coverageY = box ? box.h / image.height : 0;
  const coverage = Math.max(coverageX, coverageY);
  const margin = 0.02;
  const touchesEdge = box
    ? box.x <= image.width * margin ||
      box.y <= image.height * margin ||
      box.x + box.w >= image.width * (1 - margin) ||
      box.y + box.h >= image.height * (1 - margin)
    : false;

  const checks: SignatureCheck[] = [
    {
      id: "format",
      label: "JPEG file",
      status: !meta?.mime || meta.mime === "image/jpeg" || meta.mime === "image/jpg" ? "pass" : "warn",
      detail:
        !meta?.mime || meta.mime === "image/jpeg" || meta.mime === "image/jpg"
          ? "Passport Seva wants a .jpg."
          : "This is not a JPEG. The prepared download will be saved as JPG.",
      value: meta?.mime ?? "image/jpeg",
    },
    {
      id: "filesize",
      label: "Under 100 KB",
      status:
        meta?.fileBytes == null
          ? "warn"
          : meta.fileBytes <= SIGNATURE_MAX_FILE_BYTES
            ? "pass"
            : "fail",
      detail:
        meta?.fileBytes == null
          ? "File size will be checked on the prepared JPG."
          : meta.fileBytes <= SIGNATURE_MAX_FILE_BYTES
            ? "Small enough for the GPSP 2.0 signature upload."
            : "Too large for the portal. Typical embassy guidance is 100 KB or less.",
      value: meta?.fileBytes != null ? `${Math.round(meta.fileBytes / 1024)} KB` : undefined,
    },
    {
      id: "paper",
      label: "White paper",
      status: measured.paperLuma >= 245 ? "pass" : measured.paperLuma >= 220 ? "warn" : "fail",
      detail:
        measured.paperLuma >= 245
          ? "Background is plain white."
          : measured.paperLuma >= 220
            ? "Paper still looks slightly grey. The fixer will push it to white."
            : "Grey or shadowed paper is a common rejection. Sign on white paper and we’ll whiten the scan.",
      value: String(Math.round(measured.paperLuma)),
    },
    {
      id: "ink",
      label: "Dark ink",
      status: !box
        ? "fail"
        : measured.inkLuma <= 55
          ? "pass"
          : measured.inkLuma <= 95
            ? "warn"
            : "fail",
      detail: !box
        ? "No handwritten stroke was found. Use black or dark blue ink on white paper."
        : measured.inkIsBlue
          ? measured.inkLuma <= 70
            ? "Dark blue ink is accepted."
            : "Blue ink is a bit faint. We’ll darken it without turning it grey."
          : measured.inkLuma <= 55
            ? "Ink is dark enough to read on a scan."
            : "Ink looks washed out. Use a black or dark blue pen, or let the fixer boost the stroke.",
      value: box ? String(Math.round(measured.inkLuma)) : undefined,
    },
    {
      id: "coverage",
      label: "Fills 80–85% of the box",
      status: !box ? "fail" : statusForCoverage(coverage),
      detail: !box
        ? "Nothing to measure."
        : coverage >= SIGNATURE_COVERAGE_MIN && coverage <= SIGNATURE_COVERAGE_MAX + 0.03
          ? "The signature fills the rectangle the way GPSP 2.0 asks."
          : coverage < SIGNATURE_COVERAGE_MIN
            ? "Too much empty paper around the signature. We’ll crop in."
            : "Crop is too tight — the stroke is touching the edge of the box.",
      value: `${Math.round(coverage * 100)}%`,
    },
    {
      id: "edges",
      label: "Clear margin",
      status: !box ? "fail" : touchesEdge ? "fail" : "pass",
      detail: touchesEdge
        ? "The signature touches the edge of the image. Leave a little white paper around it."
        : "There is a white margin around the stroke.",
    },
    {
      id: "marks",
      label: "No stray marks",
      status: measured.strayMarks === 0 ? "pass" : measured.strayMarks <= 4 ? "warn" : "fail",
      detail:
        measured.strayMarks === 0
          ? "No dust specks or extra marks around the signature."
          : "Small marks around the ink will be removed.",
      value: String(measured.strayMarks),
    },
    {
      id: "shape",
      label: "Wide rectangle",
      status:
        image.width / image.height >= 2
          ? "pass"
          : image.width / image.height >= 1.4
            ? "warn"
            : "fail",
      detail:
        image.width / image.height >= 2
          ? `${image.width}×${image.height} is a wide crop.`
          : "A wide rectangular crop (about 3:1) matches the portal preview. We’ll export 600×200.",
      value: `${image.width}×${image.height}`,
    },
  ];

  if (measured.looksLikePhoto) {
    checks.push({
      id: "photo",
      label: "Looks like a signature",
      status: "warn",
      detail:
        "This file has a lot of colour and mid-tones, more like a photograph than a pen scan. Crop to just the signature on white paper.",
    });
  }

  return {
    width: image.width,
    height: image.height,
    paperLuma: measured.paperLuma,
    inkLuma: measured.inkLuma,
    inkIsBlue: measured.inkIsBlue,
    coverage,
    coverageX,
    coverageY,
    touchesEdge,
    strayMarks: measured.strayMarks,
    looksLikePhoto: measured.looksLikePhoto,
    checks,
    failedCount: checks.filter((check) => check.status === "fail").length,
  };
}

export function suggestSignatureAdjustments(analysis: SignatureAnalysis): SignatureAdjustments {
  return {
    whitePaper: 1,
    coverage: DEFAULT_SIGNATURE_ADJUSTMENTS.coverage,
    inkBoost: analysis.inkLuma > 80 ? 1.15 : analysis.inkLuma > 55 ? 1 : 0.85,
  };
}

function samplePixel(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
): [number, number, number] {
  const x0 = clamp(Math.floor(x), 0, width - 1);
  const y0 = clamp(Math.floor(y), 0, height - 1);
  const x1 = clamp(x0 + 1, 0, width - 1);
  const y1 = clamp(y0 + 1, 0, height - 1);
  const sx = x - x0;
  const sy = y - y0;
  const i00 = idx(x0, y0, width);
  const i10 = idx(x1, y0, width);
  const i01 = idx(x0, y1, width);
  const i11 = idx(x1, y1, width);
  const mix = (a: number, b: number, t: number) => a + (b - a) * t;
  return [0, 1, 2].map((c) =>
    mix(mix(data[i00 + c], data[i10 + c], sx), mix(data[i01 + c], data[i11 + c], sx), sy),
  ) as [number, number, number];
}

export function cleanSignature(image: ImageData, adjustments: SignatureAdjustments): ImageData {
  const measured = measureInk(image);
  const out = new ImageData(image.width, image.height);
  const { data } = image;
  const dest = out.data;
  const inkTarget = measured.inkIsBlue ? [18, 42, 118] : [18, 18, 20];
  const boost = clamp(adjustments.inkBoost, 0, 1.5);
  const paperMix = clamp(adjustments.whitePaper, 0, 1);

  for (let i = 0, p = 0; i < measured.mask.length; i += 1, p += 4) {
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    dest[p + 3] = 255;
    if (!measured.mask[i]) {
      dest[p] = Math.round(r + (255 - r) * paperMix);
      dest[p + 1] = Math.round(g + (255 - g) * paperMix);
      dest[p + 2] = Math.round(b + (255 - b) * paperMix);
      continue;
    }
    const y = luma(r, g, b);
    const strength = clamp((measured.paperLuma - y) / 90, 0.35, 1) * boost;
    dest[p] = Math.round(r + (inkTarget[0] - r) * strength);
    dest[p + 1] = Math.round(g + (inkTarget[1] - g) * strength);
    dest[p + 2] = Math.round(b + (inkTarget[2] - b) * strength);
  }
  return out;
}

export function placeSignature(
  cleaned: ImageData,
  box: InkBox,
  coverage = DEFAULT_SIGNATURE_ADJUSTMENTS.coverage,
): ImageData {
  const out = new ImageData(SIGNATURE_WIDTH, SIGNATURE_HEIGHT);
  const dest = out.data;
  for (let p = 0; p < dest.length; p += 4) {
    dest[p] = 255;
    dest[p + 1] = 255;
    dest[p + 2] = 255;
    dest[p + 3] = 255;
  }

  const target = clamp(coverage, 0.7, 0.94);
  const pad = 2;
  const srcX = Math.max(0, box.x - pad);
  const srcY = Math.max(0, box.y - pad);
  const srcW = Math.min(cleaned.width - srcX, box.w + pad * 2);
  const srcH = Math.min(cleaned.height - srcY, box.h + pad * 2);
  const scale = Math.min(
    (SIGNATURE_WIDTH * target) / Math.max(1, box.w),
    (SIGNATURE_HEIGHT * target) / Math.max(1, box.h),
  );
  const dw = srcW * scale;
  const dh = srcH * scale;
  const dx0 = (SIGNATURE_WIDTH - dw) / 2;
  const dy0 = (SIGNATURE_HEIGHT - dh) / 2;

  for (let y = 0; y < SIGNATURE_HEIGHT; y += 1) {
    for (let x = 0; x < SIGNATURE_WIDTH; x += 1) {
      if (x < dx0 || y < dy0 || x >= dx0 + dw || y >= dy0 + dh) continue;
      const u = (x - dx0 + 0.5) / scale - 0.5;
      const v = (y - dy0 + 0.5) / scale - 0.5;
      const [r, g, b] = samplePixel(cleaned.data, cleaned.width, cleaned.height, srcX + u, srcY + v);
      const p = idx(x, y, SIGNATURE_WIDTH);
      dest[p] = r;
      dest[p + 1] = g;
      dest[p + 2] = b;
      dest[p + 3] = 255;
    }
  }
  return out;
}

export function applySignatureFix(
  image: ImageData,
  adjustments: SignatureAdjustments = DEFAULT_SIGNATURE_ADJUSTMENTS,
): ImageData {
  const cleaned = cleanSignature(image, adjustments);
  const measured = measureInk(cleaned);
  if (!measured.box) {
    const blank = new ImageData(SIGNATURE_WIDTH, SIGNATURE_HEIGHT);
    for (let p = 0; p < blank.data.length; p += 4) {
      blank.data[p] = 255;
      blank.data[p + 1] = 255;
      blank.data[p + 2] = 255;
      blank.data[p + 3] = 255;
    }
    return blank;
  }
  return placeSignature(cleaned, measured.box, adjustments.coverage);
}

export async function encodeSignatureJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
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

  let best = await toBlob(0.92);
  if (best.size <= SIGNATURE_MAX_FILE_BYTES) return best;
  let lo = 0.35;
  let hi = 0.92;
  for (let i = 0; i < 8; i += 1) {
    const mid = (lo + hi) / 2;
    const blob = await toBlob(mid);
    if (blob.size > SIGNATURE_MAX_FILE_BYTES) hi = mid;
    else {
      lo = mid;
      best = blob;
    }
  }
  if (best.size > SIGNATURE_MAX_FILE_BYTES) best = await toBlob(0.32);
  return best;
}

export function generateSampleRejectedSignature(): Blob {
  const width = 1400;
  const height = 900;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available in this browser.");

  const paper = ctx.createLinearGradient(0, 0, width, height);
  paper.addColorStop(0, "#d8d4cc");
  paper.addColorStop(0.55, "#ece8e1");
  paper.addColorStop(1, "#cfc9c0");
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "rgba(90, 86, 78, 0.16)";
  ctx.beginPath();
  ctx.ellipse(width * 0.5, height * 0.52, 280, 90, -0.12, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(92, 104, 138, 0.55)";
  ctx.lineWidth = 7;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(width * 0.38, height * 0.52);
  ctx.bezierCurveTo(width * 0.4, height * 0.38, width * 0.44, height * 0.66, width * 0.47, height * 0.5);
  ctx.bezierCurveTo(width * 0.5, height * 0.34, width * 0.52, height * 0.62, width * 0.56, height * 0.48);
  ctx.bezierCurveTo(width * 0.6, height * 0.36, width * 0.63, height * 0.58, width * 0.68, height * 0.5);
  ctx.stroke();

  ctx.fillStyle = "rgba(70, 70, 70, 0.35)";
  ctx.fillRect(80, 70, 6, 6);
  ctx.fillRect(width - 120, 110, 8, 5);
  ctx.fillRect(160, height - 90, 7, 7);

  const dataUrl = canvas.toDataURL("image/jpeg", 0.88);
  const raw = atob(dataUrl.split(",")[1]);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return new Blob([bytes], { type: "image/jpeg" });
}
