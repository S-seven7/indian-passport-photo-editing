import {
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
  headroom: number;
};

export const NEUTRAL_ADJUSTMENTS: Adjustments = {
  exposure: 0,
  contrast: 0.12,
  evenLight: 0,
  whiteBackground: 1,
  headroom: 1.2,
};

export type FaceBox = {
  cx: number;
  cy: number;
  faceW: number;
  faceH: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
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
  if (chroma(r, g, b) < 32) return false;
  if (cr < 128 || cr > 185) return false;
  if (cb < 72 || cb > 140) return false;
  return true;
}

function chroma(r: number, g: number, b: number) {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

/**
 * Sample the wall behind the head only. Bottom corners of a passport crop
 * are almost always dark clothing, so they must not count as background.
 */
function sampleWallBackground(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): { mean: number; std: number; rgb: Rgb; spread: number } {
  const regions: Array<[number, number, number, number]> = [
    [0, 0, width * 0.2, height * 0.16],
    [width * 0.8, 0, width, height * 0.16],
    [width * 0.32, 0, width * 0.68, height * 0.07],
    [0, height * 0.06, width * 0.09, height * 0.45],
    [width * 0.91, height * 0.06, width, height * 0.45],
  ];

  const lumas: number[] = [];
  const pixels: Rgb[] = [];

  for (const [x0, y0, x1, y1] of regions) {
    const xa = Math.max(0, Math.floor(x0));
    const ya = Math.max(0, Math.floor(y0));
    const xb = Math.min(width - 1, Math.ceil(x1));
    const yb = Math.min(height - 1, Math.ceil(y1));
    for (let y = ya; y <= yb; y += 2) {
      for (let x = xa; x <= xb; x += 2) {
        const i = idx(x, y, width);
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        if (isSkin(r, g, b)) continue;
        lumas.push(luma(r, g, b));
        pixels.push({ r, g, b });
      }
    }
  }

  if (lumas.length < 8) {
    const fallback = sampleRect(data, width, 0, 0, width * 0.16, height * 0.12);
    return { mean: fallback.mean, std: fallback.std, rgb: fallback.rgb, spread: 0 };
  }

  const sorted = [...lumas].sort((a, b) => a - b);
  const pivot = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.72))];
  let sum = 0;
  let sumSq = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  let minY = 255;
  let maxY = 0;

  for (let i = 0; i < pixels.length; i += 1) {
    if (Math.abs(lumas[i] - pivot) > 38) continue;
    sum += lumas[i];
    sumSq += lumas[i] * lumas[i];
    r += pixels[i].r;
    g += pixels[i].g;
    b += pixels[i].b;
    count += 1;
    minY = Math.min(minY, lumas[i]);
    maxY = Math.max(maxY, lumas[i]);
  }

  if (count === 0) {
    const mean = pivot;
    return { mean, std: 0, rgb: { r: mean, g: mean, b: mean }, spread: 0 };
  }

  const mean = sum / count;
  return {
    mean,
    std: Math.sqrt(Math.max(0, sumSq / count - mean * mean)),
    rgb: { r: r / count, g: g / count, b: b / count },
    spread: maxY - minY,
  };
}

export function findFaceBox(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): FaceBox | null {
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
    minX,
    minY,
    maxX,
    maxY,
  };
}

export function computePassportCrop(
  srcW: number,
  srcH: number,
  face: FaceBox | null,
  headroom = 1.2,
) {
  const aspect = PASSPORT_WIDTH / PASSPORT_HEIGHT;
  const room = clamp(headroom, 0.85, 1.7);

  if (!face) {
    let cropW: number;
    let cropH: number;
    if (srcW / srcH > aspect) {
      cropH = srcH;
      cropW = srcH * aspect;
    } else {
      cropW = srcW;
      cropH = srcW / aspect;
    }
    return {
      x: (srcW - cropW) / 2,
      y: (srcH - cropH) / 2,
      w: cropW,
      h: cropH,
    };
  }

  // Skin box is forehead-to-chin. Keep hair above and shoulders below.
  const top = face.minY - face.faceH * 0.48;
  const bottom = face.maxY + face.faceH * 0.58;
  const left = face.minX - face.faceW * 0.28;
  const right = face.maxX + face.faceW * 0.28;
  const subjectW = Math.max(32, right - left);
  const subjectH = Math.max(32, bottom - top);
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;

  let cropH = Math.max(subjectH, subjectW / aspect) * room;
  let cropW = cropH * aspect;

  if (cropW < subjectW) {
    cropW = subjectW;
    cropH = cropW / aspect;
  }
  if (cropH < subjectH) {
    cropH = subjectH;
    cropW = cropH * aspect;
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
  // Prefer keeping the crown of the head, not the belly.
  y = clamp(Math.min(y, Math.max(0, top)), 0, srcH - cropH);

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
  const wall = sampleWallBackground(data, width, height);
  const backgroundLuma = wall.mean;
  const backgroundRgb = wall.rgb;

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
  const bgSpread = wall.spread;
  const backgroundIsLight = backgroundLuma >= 210;
  const faceBgGap = backgroundLuma - faceRegion.mean;
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
      !backgroundIsLight || faceBgGap < 24
        ? "fail"
        : backgroundLuma < 235 || faceBgGap < 36
          ? "warn"
          : "pass",
      !backgroundIsLight
        ? "The wall behind the head is still grey or cream. It needs to be plain white."
        : faceBgGap < 24
          ? "Face and background are too similar in brightness."
          : "The face is clearly darker than a light wall, so features separate cleanly.",
      `wall ${Math.round(backgroundLuma)} · gap ${Math.round(faceBgGap)}`,
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
      backgroundIsLight && bgSpread < 32 ? "pass" : backgroundLuma >= 170 ? "warn" : "fail",
      backgroundIsLight
        ? bgSpread >= 32
          ? "The wall is light but uneven — a leftover shadow or colour cast is still visible."
          : "The area behind the head reads as a plain light backdrop."
        : "Grey, cream, or shadowed walls fail Passport Seva. Use Whiten background to push that wall to white.",
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
  if (analysis.faceLuma < 128) {
    exposure = clamp((138 - analysis.faceLuma) / 68, 0, 1.25);
  } else if (analysis.faceLuma > 168) {
    exposure = clamp((158 - analysis.faceLuma) / 80, -0.75, 0);
  }
  if (analysis.shadowClip > 0.08) {
    exposure = clamp(exposure + analysis.shadowClip * 0.9, -0.75, 1.25);
  }

  let contrast = 0.22;
  if (analysis.faceStd < 24) contrast += (24 - analysis.faceStd) / 40;
  contrast = clamp(contrast, 0.12, 0.58);

  const evenLight = clamp((analysis.rightLuma - analysis.leftLuma) / 22, -1, 1);

  return {
    exposure,
    contrast,
    evenLight,
    whiteBackground: 1,
    headroom: 1.22,
  };
}

function colorDist(r: number, g: number, b: number, seed: Rgb) {
  const dr = r - seed.r;
  const dg = g - seed.g;
  const db = b - seed.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function isGrowableBackground(
  r: number,
  g: number,
  b: number,
  current: Rgb,
  localThreshold: number,
  wall: Rgb,
  face: Rgb,
) {
  const distFace = colorDist(r, g, b, face);
  const distWall = colorDist(r, g, b, wall);
  if (distFace + 12 < distWall && distFace < 62) return false;
  const y = luma(r, g, b);
  const currentY = luma(current.r, current.g, current.b);
  const dist = colorDist(r, g, b, current);
  if (dist <= localThreshold) return true;
  const lowChroma = chroma(r, g, b) < 52 && chroma(current.r, current.g, current.b) < 58;
  if (lowChroma && Math.abs(y - currentY) <= 50 && y >= 40) return true;
  return false;
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
  const wall = sampleWallBackground(data, width, height);
  const faceSample = sampleRect(
    data,
    width,
    width * 0.32,
    height * 0.2,
    width * 0.68,
    height * 0.58,
  );
  const faceRgb = faceSample.rgb;

  const looksLikeWall = (r: number, g: number, b: number) => {
    const y = luma(r, g, b);
    if (colorDist(r, g, b, wall.rgb) <= 64) return true;
    return chroma(r, g, b) < 50 && Math.abs(y - wall.mean) <= 56 && y >= 40;
  };

  const enqueue = (x: number, y: number) => {
    const p = y * width + x;
    if (visited[p]) return;
    visited[p] = 1;
    qx[qe] = x;
    qy[qe] = y;
    qe += 1;
  };

  const seedIfWall = (x: number, y: number) => {
    const i = idx(x, y, width);
    if (looksLikeWall(data[i], data[i + 1], data[i + 2])) enqueue(x, y);
  };

  const edgeLimit = Math.floor(height * 0.74);
  for (let x = 0; x < width; x += 1) {
    seedIfWall(x, 0);
    seedIfWall(x, 1);
  }
  for (let y = 0; y < edgeLimit; y += 1) {
    seedIfWall(0, y);
    seedIfWall(width - 1, y);
  }

  while (qs < qe) {
    const x = qx[qs];
    const y = qy[qs];
    qs += 1;
    const i = idx(x, y, width);
    const current = { r: data[i], g: data[i + 1], b: data[i + 2] };
    mask[y * width + x] = 1;

    const tryNeighbor = (nx: number, ny: number) => {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;
      const p = ny * width + nx;
      if (visited[p]) return;
      const ni = idx(nx, ny, width);
      if (
        !isGrowableBackground(
          data[ni],
          data[ni + 1],
          data[ni + 2],
          current,
          threshold,
          wall.rgb,
          faceRgb,
        )
      ) {
        return;
      }
      enqueue(nx, ny);
    };

    tryNeighbor(x - 1, y);
    tryNeighbor(x + 1, y);
    tryNeighbor(x, y - 1);
    tryNeighbor(x, y + 1);
  }

  const face = findFaceBox(data, width, height);
  if (face) {
    const rx = Math.max(face.faceW * 0.58, 36);
    const ry = Math.max(face.faceH * 0.62, 44);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const dx = (x - face.cx) / rx;
        const dy = (y - face.cy) / ry;
        if (dx * dx + dy * dy <= 1) mask[y * width + x] = 0;
      }
    }
  }

  let covered = 0;
  for (let i = 0; i < mask.length; i += 1) if (mask[i] > 0.5) covered += 1;

  if (covered < width * height * 0.06) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = idx(x, y, width);
        const pixel = { r: data[i], g: data[i + 1], b: data[i + 2] };
        const distWall = colorDist(pixel.r, pixel.g, pixel.b, wall.rgb);
        const distFace = colorDist(pixel.r, pixel.g, pixel.b, faceRgb);
        const yv = luma(pixel.r, pixel.g, pixel.b);
        const nx = x / width - 0.5;
        const inCenter = Math.abs(nx) < 0.26 && y > height * 0.12 && y < height * 0.7;
        if (inCenter && distFace <= distWall) continue;
        if (
          distWall < 58 ||
          (chroma(pixel.r, pixel.g, pixel.b) < 44 &&
            Math.abs(yv - wall.mean) < 48 &&
            yv > 45)
        ) {
          mask[y * width + x] = 1;
        }
      }
    }
    if (face) {
      const rx = Math.max(face.faceW * 0.58, 36);
      const ry = Math.max(face.faceH * 0.62, 44);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const dx = (x - face.cx) / rx;
          const dy = (y - face.cy) / ry;
          if (dx * dx + dy * dy <= 1) mask[y * width + x] = 0;
        }
      }
    }
  }

  return blurMask(mask, width, height, 2);
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
  const lift = Math.max(0, exposure) * 0.42;
  t = t + lift * (1 - t) * (1 - t);
  const c = 1 + contrast * 1.85;
  t = (t - pivot) * c + pivot;
  return clamp(t * 255, 0, 255);
}

function subjectPercentile(
  data: Uint8ClampedArray,
  mask: Float32Array | null,
  width: number,
  height: number,
  p: number,
) {
  const hist = new Uint32Array(256);
  let count = 0;
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      if (mask && mask[y * width + x] > 0.4) continue;
      const i = idx(x, y, width);
      hist[Math.round(luma(data[i], data[i + 1], data[i + 2]))] += 1;
      count += 1;
    }
  }
  if (count === 0) return 128;
  const target = count * p;
  let acc = 0;
  for (let i = 0; i < 256; i += 1) {
    acc += hist[i];
    if (acc >= target) return i;
  }
  return 255;
}

function unsharpSubject(
  dest: Uint8ClampedArray,
  mask: Float32Array | null,
  width: number,
  height: number,
  amount: number,
) {
  const copy = new Uint8ClampedArray(dest);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      if (mask && mask[y * width + x] > 0.55) continue;
      const i = idx(x, y, width);
      for (let c = 0; c < 3; c += 1) {
        let mean = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            mean += copy[idx(x + dx, y + dy, width) + c];
          }
        }
        mean /= 9;
        dest[i + c] = clamp(copy[i + c] + amount * (copy[i + c] - mean), 0, 255);
      }
    }
  }
}

export function applyFix(source: ImageData, adjustments: Adjustments): ImageData {
  const { width, height } = source;
  const src = source.data;
  const out = new ImageData(width, height);
  const dest = out.data;
  dest.set(src);

  const canWhiten = adjustments.whiteBackground > 0.05;
  const mask = canWhiten
    ? buildBackgroundMask(src, width, height, 28 + adjustments.whiteBackground * 18)
    : null;

  const low = subjectPercentile(src, mask, width, height, 0.08);
  const high = subjectPercentile(src, mask, width, height, 0.94);
  const levelSpan = Math.max(18, high - low);
  const levelStrength = levelSpan < 40 || low < 55 || high > 210 ? 0.72 : 0.35;

  const pivot = clamp(
    sampleRect(src, width, width * 0.3, height * 0.18, width * 0.7, height * 0.58).mean / 255,
    0.28,
    0.62,
  );
  const sideBoost = (adjustments.evenLight || 0) * 0.42;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = idx(x, y, width);
      const maskVal = mask ? mask[y * width + x] : 0;
      const bg = Math.pow(maskVal * adjustments.whiteBackground, 0.5);
      let r = src[i];
      let g = src[i + 1];
      let b = src[i + 2];

      if (bg < 0.88) {
        const even = ((0.5 - x / width) * 2) * sideBoost * 255;
        const y0 = luma(r, g, b);
        const leveled = ((y0 - low) / levelSpan) * 160 + 48;
        const y1 = y0 * (1 - levelStrength) + leveled * levelStrength;
        const scale = y0 > 1 ? y1 / y0 : 1;
        r = applyCurve(r * scale + even, adjustments.exposure, adjustments.contrast, pivot);
        g = applyCurve(g * scale + even, adjustments.exposure, adjustments.contrast, pivot);
        b = applyCurve(b * scale + even, adjustments.exposure, adjustments.contrast, pivot);
      }

      if (bg > 0) {
        const white = Math.min(1, bg * 1.18);
        r = r * (1 - white) + 255 * white;
        g = g * (1 - white) + 255 * white;
        b = b * (1 - white) + 255 * white;
      }

      dest[i] = r;
      dest[i + 1] = g;
      dest[i + 2] = b;
      dest[i + 3] = 255;
    }
  }

  unsharpSubject(dest, mask, width, height, 0.32);
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

export function cropToPassport(source: HTMLCanvasElement, headroom = 1.2): HTMLCanvasElement {
  const ctx = source.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas is not available in this browser.");
  const imageData = ctx.getImageData(0, 0, source.width, source.height);
  const face = findFaceBox(imageData.data, source.width, source.height);
  const crop = computePassportCrop(source.width, source.height, face, headroom);

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
  wall.addColorStop(0, "#9a9388");
  wall.addColorStop(0.5, "#b7b0a4");
  wall.addColorStop(1, "#c9c2b6");
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "rgba(70, 60, 48, 0.18)";
  ctx.beginPath();
  ctx.ellipse(width * 0.5, height * 0.7, 210, 80, 0, 0, Math.PI * 2);
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

  ctx.fillStyle = "rgba(40, 32, 24, 0.22)";
  ctx.fillRect(0, 0, width * 0.28, height);

  const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
  const raw = atob(dataUrl.split(",")[1]);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return new Blob([bytes], { type: "image/jpeg" });
}
