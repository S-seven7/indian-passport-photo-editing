class ImageDataPolyfill {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }
}

globalThis.ImageData = ImageDataPolyfill as unknown as typeof ImageData;

import { analyzePhoto, applyFix, computePassportCrop, suggestAdjustments } from "./photo-engine";

function paint(image: ImageData, x0: number, y0: number, x1: number, y1: number, r: number, g: number, b: number) {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * image.width + x) * 4;
      image.data[i] = r;
      image.data[i + 1] = g;
      image.data[i + 2] = b;
      image.data[i + 3] = 255;
    }
  }
}

function oval(
  image: ImageData,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  r: number,
  g: number,
  b: number,
) {
  for (let y = Math.max(0, cy - ry); y < Math.min(image.height, cy + ry); y += 1) {
    for (let x = Math.max(0, cx - rx); x < Math.min(image.width, cx + rx); x += 1) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) {
        const i = (y * image.width + x) * 4;
        image.data[i] = r;
        image.data[i + 1] = g;
        image.data[i + 2] = b;
        image.data[i + 3] = 255;
      }
    }
  }
}

const photo = new ImageData(630, 810);
paint(photo, 0, 0, 630, 810, 176, 168, 156);
paint(photo, 80, 560, 550, 810, 28, 36, 48);
oval(photo, 315, 300, 140, 180, 132, 88, 64);

const before = analyzePhoto(photo);
const fixed = applyFix(photo, {
  exposure: 0.15,
  contrast: 0.2,
  evenLight: 0,
  whiteBackground: 1,
  headroom: 1.22,
});
const after = analyzePhoto(fixed);

const standout = (analysis: typeof before) =>
  analysis.checks.find((check) => check.id === "standout");

const report = {
  beforeWall: Math.round(before.backgroundLuma),
  afterWall: Math.round(after.backgroundLuma),
  beforeStandout: standout(before),
  afterStandout: standout(after),
};

console.log(JSON.stringify(report, null, 2));

if (after.backgroundLuma < 210) {
  throw new Error(`Wall luma after fix is ${after.backgroundLuma}, expected >= 210`);
}
if (standout(after)?.status === "fail") {
  throw new Error(`Standout still fails: ${standout(after)?.detail}`);
}
if (after.faceLuma > 180) {
  throw new Error(`Face was washed out (${after.faceLuma})`);
}

const greyWall = new ImageData(630, 810);
paint(greyWall, 0, 0, 630, 810, 118, 114, 108);
paint(greyWall, 70, 540, 560, 810, 22, 30, 42);
oval(greyWall, 315, 310, 145, 185, 118, 78, 56);
const greyFixed = applyFix(greyWall, {
  exposure: 0.2,
  contrast: 0.18,
  evenLight: 0,
  whiteBackground: 1,
  headroom: 1.22,
});
const greyAfter = analyzePhoto(greyFixed);
if (greyAfter.backgroundLuma < 210 || standout(greyAfter)?.status === "fail") {
  throw new Error(
    `Grey wall still fails: luma ${greyAfter.backgroundLuma} ${standout(greyAfter)?.status}`,
  );
}

const face = {
  cx: 400,
  cy: 360,
  faceW: 220,
  faceH: 280,
  minX: 290,
  minY: 220,
  maxX: 510,
  maxY: 500,
};
const crop = computePassportCrop(900, 1200, face, 1.22);
const hairTop = face.minY - face.faceH * 0.48;
if (crop.y > hairTop + 2) {
  throw new Error(`Crop cuts hair: y=${crop.y} hairTop=${hairTop}`);
}
if (crop.y + crop.h < face.maxY - 2) {
  throw new Error(`Crop cuts chin: bottom=${crop.y + crop.h} chin=${face.maxY}`);
}

const dark = new ImageData(630, 810);
paint(dark, 0, 0, 630, 810, 150, 146, 140);
paint(dark, 90, 560, 540, 810, 24, 28, 36);
oval(dark, 315, 305, 140, 180, 72, 46, 34);
const darkBefore = analyzePhoto(dark);
const darkFixed = applyFix(dark, suggestAdjustments(darkBefore));
const darkAfter = analyzePhoto(darkFixed);
if (darkAfter.faceLuma < 100) {
  throw new Error(`Dark face stayed too dark: ${darkAfter.faceLuma}`);
}
if (darkAfter.lightingIssue === "too-dark") {
  throw new Error("Lighting issue still too-dark after auto-fix");
}

console.log("ok");
