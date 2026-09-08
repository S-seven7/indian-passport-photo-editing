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

import {
  analyzeSignature,
  applySignatureFix,
  cleanSignature,
  measureInk,
  suggestSignatureAdjustments,
} from "./signature-engine";

function paint(
  image: ImageData,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  r: number,
  g: number,
  b: number,
) {
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

function fill(image: ImageData, r: number, g: number, b: number) {
  paint(image, 0, 0, image.width, image.height, r, g, b);
}

function check(id: string, analysis: ReturnType<typeof analyzeSignature>) {
  return analysis.checks.find((item) => item.id === id);
}

const greyScan = new ImageData(800, 400);
fill(greyScan, 196, 192, 186);
paint(greyScan, 220, 180, 560, 228, 28, 28, 32);
paint(greyScan, 40, 30, 46, 36, 40, 40, 40);
paint(greyScan, 740, 340, 748, 348, 50, 50, 50);

const before = analyzeSignature(greyScan, { fileBytes: 800_000, mime: "image/jpeg" });
if (before.paperLuma > 230) throw new Error(`Grey paper looked white: ${before.paperLuma}`);
if (check("coverage", before)?.status === "pass") {
  throw new Error("Loose crop should fail coverage");
}
if (check("filesize", before)?.status !== "fail") {
  throw new Error("800 KB scan should fail the 100 KB check");
}

const cleaned = cleanSignature(greyScan, {
  inkBoost: 1,
  whitePaper: 1,
  coverage: 0.825,
});
const cleanedMeasure = measureInk(cleaned);
if (!cleanedMeasure.box) throw new Error("Signature lost during clean");
if (cleanedMeasure.paperLuma < 250) {
  throw new Error(`Paper stayed grey: ${cleanedMeasure.paperLuma}`);
}
if (cleanedMeasure.inkLuma > 40) {
  throw new Error(`Ink stayed faint: ${cleanedMeasure.inkLuma}`);
}
if (cleanedMeasure.strayMarks !== 0) {
  throw new Error(`Specks were kept: ${cleanedMeasure.strayMarks}`);
}

const fixed = applySignatureFix(greyScan, suggestSignatureAdjustments(before));
if (fixed.width !== 600 || fixed.height !== 200) {
  throw new Error(`Output size ${fixed.width}×${fixed.height}`);
}
const after = analyzeSignature(fixed, { fileBytes: 40_000, mime: "image/jpeg" });
if (after.paperLuma < 250) throw new Error(`Prepared paper ${after.paperLuma}`);
if (after.failedCount > 0) {
  throw new Error(
    `Prepared signature still fails: ${after.checks
      .filter((item) => item.status === "fail")
      .map((item) => item.id)
      .join(", ")}`,
  );
}
if (after.coverage < 0.78 || after.coverage > 0.9) {
  throw new Error(`Coverage ${after.coverage}`);
}

const faint = new ImageData(700, 280);
fill(faint, 248, 248, 246);
paint(faint, 160, 110, 520, 158, 168, 170, 176);
const faintFixed = applySignatureFix(faint, { inkBoost: 1.15, whitePaper: 1, coverage: 0.825 });
const faintAfter = analyzeSignature(faintFixed, { fileBytes: 32_000, mime: "image/jpeg" });
if (faintAfter.inkLuma > 70) {
  throw new Error(`Faint ink was not darkened: ${faintAfter.inkLuma}`);
}

const blue = new ImageData(700, 260);
fill(blue, 255, 255, 255);
paint(blue, 140, 90, 540, 150, 36, 62, 150);
const blueFixed = applySignatureFix(blue, { inkBoost: 1, whitePaper: 1, coverage: 0.825 });
const blueInk = measureInk(blueFixed);
if (!blueInk.inkIsBlue) throw new Error("Dark blue ink was turned black");
if (blueInk.inkLuma > 80) throw new Error(`Blue ink too light: ${blueInk.inkLuma}`);

const edge = new ImageData(600, 200);
fill(edge, 255, 255, 255);
paint(edge, 0, 80, 500, 130, 20, 20, 20);
const edgeBefore = analyzeSignature(edge);
if (!edgeBefore.touchesEdge) throw new Error("Edge contact was missed");
const edgeFixed = applySignatureFix(edge, { inkBoost: 0.85, whitePaper: 1, coverage: 0.825 });
const edgeAfter = analyzeSignature(edgeFixed, { fileBytes: 28_000, mime: "image/jpeg" });
if (edgeAfter.touchesEdge) throw new Error("Prepared signature still touches the edge");

const square = new ImageData(400, 400);
fill(square, 210, 210, 208);
paint(square, 80, 180, 320, 230, 22, 22, 24);
const squareAfter = analyzeSignature(
  applySignatureFix(square, { inkBoost: 1, whitePaper: 1, coverage: 0.825 }),
  { fileBytes: 24_000, mime: "image/jpeg" },
);
if (squareAfter.width / squareAfter.height < 2) {
  throw new Error("Square scan was not exported as a wide rectangle");
}

const shadowed = new ImageData(900, 500);
fill(shadowed, 210, 206, 198);
paint(shadowed, 180, 140, 720, 360, 176, 172, 164);
paint(shadowed, 260, 230, 640, 268, 36, 40, 48);
const shadowedFixed = applySignatureFix(shadowed, {
  inkBoost: 1,
  whitePaper: 1,
  coverage: 0.825,
});
let greyBlob = 0;
for (let p = 0; p < shadowedFixed.data.length; p += 4) {
  const y =
    0.2126 * shadowedFixed.data[p] +
    0.7152 * shadowedFixed.data[p + 1] +
    0.0722 * shadowedFixed.data[p + 2];
  if (y > 55 && y < 220) greyBlob += 1;
}
if (greyBlob > 600 * 200 * 0.08) {
  throw new Error(`Paper shadow became a grey blob (${greyBlob} mid-grey pixels)`);
}
const corner = (x: number, y: number) => {
  const i = (y * shadowedFixed.width + x) * 4;
  return (
    0.2126 * shadowedFixed.data[i] +
    0.7152 * shadowedFixed.data[i + 1] +
    0.0722 * shadowedFixed.data[i + 2]
  );
};
if (corner(2, 2) < 250 || corner(597, 197) < 250) {
  throw new Error("Prepared corners are not white");
}
const shadowedAfter = analyzeSignature(shadowedFixed, { fileBytes: 30_000, mime: "image/jpeg" });
if (shadowedAfter.failedCount > 0) {
  throw new Error(
    `Shadowed scan still fails: ${shadowedAfter.checks
      .filter((item) => item.status === "fail")
      .map((item) => item.id)
      .join(", ")}`,
  );
}

console.log(
  JSON.stringify(
    {
      beforePaper: Math.round(before.paperLuma),
      afterPaper: Math.round(after.paperLuma),
      coverage: Number(after.coverage.toFixed(3)),
      faintInk: Math.round(faintAfter.inkLuma),
      blue: blueInk.inkIsBlue,
    },
    null,
    2,
  ),
);
console.log("ok");
