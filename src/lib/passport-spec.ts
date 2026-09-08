export const PASSPORT_WIDTH = 630;
export const PASSPORT_HEIGHT = 810;
export const MIN_FILE_BYTES = 20 * 1024;
export const MAX_FILE_BYTES = 250 * 1024;
export const FACE_COVERAGE_MIN = 0.8;
export const FACE_COVERAGE_MAX = 0.85;

export const SPEC_SUMMARY = {
  format: "JPEG (.jpg)",
  pixels: "630 × 810",
  fileSize: "20 KB – 250 KB",
  background: "Plain white, no shadows",
  face: "80–85% of the frame, front view",
  lighting: "Even front light, natural skin tone",
} as const;

export const SIGNATURE_WIDTH = 600;
export const SIGNATURE_HEIGHT = 200;
export const SIGNATURE_MAX_FILE_BYTES = 100 * 1024;
export const SIGNATURE_COVERAGE_MIN = 0.8;
export const SIGNATURE_COVERAGE_MAX = 0.85;

export const SIGNATURE_SPEC_SUMMARY = {
  format: "JPEG (.jpg)",
  pixels: "About 600 × 200 (wide rectangle)",
  fileSize: "Under 100 KB",
  background: "Plain white paper, no shadows or stray marks",
  ink: "Black or dark blue, handwritten",
  coverage: "Signature fills 80–85% of the box",
} as const;
