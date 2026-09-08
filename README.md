# Passport Photo Prep

A browser-only tool for the two files Indian Passport Seva / GPSP 2.0 asks you to upload: an ICAO photograph and a scanned signature.

## Photograph

Built for the lighting rejection:

> Your photo is too light or too dark. Try standing in front of a light background, standing where there’s even lighting to keep your face and features in focus, so they stand out from the background.

It measures exposure, left/right evenness, and whether the face separates from the wall, then exports a **630 × 810 JPEG** in the **20–250 KB** window.

## Signature

GPSP 2.0 also needs a handwritten signature on white paper, cropped so it fills **80–85%** of a rectangle, with grey paper and stray marks removed, saved as **JPEG under 100 KB**. There is no official pixel size; this app exports **600 × 200**.

Sign with black or dark blue ink. Drop one or more scans; they never leave your device.

## Run locally

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:4521](http://127.0.0.1:4521). Use the **Photograph** and **Signature** tabs. Sample buttons on each tab show a typical rejection.

```bash
npm test
npm run build
npm start
```

## What it does

**Photo:** visafoto-style 7:9 crop, lighting and contrast, white wall, 630×810 JPEG.

**Signature:** find the ink, drop dust specks, whiten paper, darken faint strokes, crop to 80–85% fill, 600×200 JPEG under 100 KB.

## What it will not do

The Ministry of External Affairs asks for a natural, unaltered face. This app does not apply beauty filters. It also does not invent lighting, a white wall, or a signature that was never written.

## Official digital spec (as of GPSP 2.0)

| | Photograph | Signature |
| --- | --- | --- |
| Format | JPEG | JPEG |
| Pixels | Exactly 630 × 810 | Wide rectangle (600 × 200 here) |
| File size | 20–250 KB | Under 100 KB |
| Background | Plain white | Plain white paper |
| Subject | Face about 80–85% of the frame | Signature 80–85% of the box |
| Other | Even light, natural skin | Black or dark blue ink, no stray marks |

Always re-check [passportindia.gov.in](https://www.passportindia.gov.in) if the portal copy changes.
