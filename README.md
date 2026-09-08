# Passport Photo Prep

A browser-only tool for the Indian Passport Seva / GPSP 2.0 lighting rejection:

> Your photo is too light or too dark. Try standing in front of a light background, standing where there’s even lighting to keep your face and features in focus, so they stand out from the background.

It measures exposure, left/right evenness, and whether the face separates from the wall, then exports a **630 × 810 JPEG** in the **20–250 KB** window the current digital upload expects.

Photos never leave your device.

## Run locally

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:4521](http://127.0.0.1:4521). Drop a JPG, or use **Try a too-dark sample** to see the checker.

```bash
npm run build
npm start
```

## What it does

- Crops toward a 7:9 passport frame (630×810)
- Corrects underexposure / overexposure
- Evens mild left–right lighting
- Restores facial contrast so features stay readable
- Whitens a light wall to plain white (it will not invent a white background from a dark room)
- Encodes JPEG between 20 KB and 250 KB

## What it will not do

The Ministry of External Affairs asks for a natural, unaltered face. This app does not apply beauty filters, slimming, or skin smoothing. If one side of the face is in deep shadow or the wall is coloured, retake the photo facing a window, about a metre from a plain white wall.

## Official digital spec (as of GPSP 2.0)

| Item | Requirement |
| --- | --- |
| Format | JPEG |
| Pixels | Exactly 630 × 810 |
| File size | 20–250 KB |
| Background | Plain white, no shadows |
| Face | About 80–85% of the frame |
| Lighting | Even, natural skin tone |

Always re-check [passportindia.gov.in](https://www.passportindia.gov.in) if the portal copy changes.
