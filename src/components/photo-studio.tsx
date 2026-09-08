"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ImageIcon,
  LoaderCircle,
  Shield,
  SunMedium,
  Upload,
  WandSparkles,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  applyFix,
  analyzePhoto,
  bitmapToWorkingCanvas,
  canvasFromImageData,
  cropToPassport,
  defaultHeadroom,
  encodePassportJpeg,
  formatBytes,
  generateSampleRejectedPhoto,
  loadImageBitmap,
  NEUTRAL_ADJUSTMENTS,
  suggestAdjustments,
  type Adjustments,
  type PhotoAnalysis,
  type PhotoCheck,
} from "@/lib/photo-engine";
import { PASSPORT_HEIGHT, PASSPORT_WIDTH, SPEC_SUMMARY } from "@/lib/passport-spec";
import { cn } from "@/lib/utils";

type StudioState = {
  fileName: string;
  originalUrl: string;
  fixedUrl: string;
  originalAnalysis: PhotoAnalysis;
  fixedAnalysis: PhotoAnalysis;
  jpegSize: number;
  adjustments: Adjustments;
};

function StatusIcon({ status }: { status: PhotoCheck["status"] }) {
  if (status === "pass") {
    return <CheckCircle2 className="size-4 text-emerald-700" />;
  }
  if (status === "warn") {
    return <AlertTriangle className="size-4 text-amber-600" />;
  }
  return <AlertTriangle className="size-4 text-destructive" />;
}

function StatusBadge({ status }: { status: PhotoCheck["status"] }) {
  if (status === "pass") {
    return (
      <Badge className="bg-emerald-700/12 text-emerald-900 border-emerald-700/20">
        Pass
      </Badge>
    );
  }
  if (status === "warn") {
    return (
      <Badge className="bg-amber-500/15 text-amber-900 border-amber-700/20">
        Close
      </Badge>
    );
  }
  return <Badge variant="destructive">Fail</Badge>;
}

export function PhotoStudio() {
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState<"idle" | "analyze" | "render">("idle");
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<StudioState | null>(null);
  const cropRef = useRef<ImageData | null>(null);
  const workingRef = useRef<HTMLCanvasElement | null>(null);
  const urlsRef = useRef<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const rememberUrl = (url: string) => {
    urlsRef.current.push(url);
    return url;
  };

  const resetUrls = () => {
    for (const url of urlsRef.current) URL.revokeObjectURL(url);
    urlsRef.current = [];
  };

  useEffect(() => {
    return () => resetUrls();
  }, []);

  const cropWorking = useCallback((headroom: number) => {
    const working = workingRef.current;
    if (!working) throw new Error("Photo is not loaded yet.");
    const passport = cropToPassport(working, headroom);
    const crop = passport
      .getContext("2d", { willReadFrequently: true })!
      .getImageData(0, 0, PASSPORT_WIDTH, PASSPORT_HEIGHT);
    cropRef.current = crop;
    return { passport, crop };
  }, []);

  const renderFromCrop = useCallback(async (crop: ImageData, adjustments: Adjustments) => {
    const fixed = applyFix(crop, adjustments);
    const canvas = canvasFromImageData(fixed);
    const blob = await encodePassportJpeg(canvas);
    const analysis = analyzePhoto(fixed, {
      fileBytes: blob.size,
      mime: "image/jpeg",
    });
    return { url: rememberUrl(URL.createObjectURL(blob)), analysis, size: blob.size, blob };
  }, []);

  const processFile = useCallback(
    async (file: File | Blob, fileName: string) => {
      setBusy("analyze");
      setError(null);
      try {
        resetUrls();
        const bitmap = await loadImageBitmap(file);
        const working = bitmapToWorkingCanvas(bitmap);
        bitmap.close();
        workingRef.current = working;
        const headroom = defaultHeadroom(working.width, working.height);
        const draft = cropToPassport(working, headroom);
        const draftCrop = draft
          .getContext("2d", { willReadFrequently: true })!
          .getImageData(0, 0, PASSPORT_WIDTH, PASSPORT_HEIGHT);
        const originalAnalysis = analyzePhoto(draftCrop, {
          fileBytes: file instanceof File ? file.size : undefined,
          mime: file.type || "image/jpeg",
        });
        const adjustments = { ...suggestAdjustments(originalAnalysis), headroom };
        const { crop } = cropWorking(adjustments.headroom);
        setBusy("render");
        const preview = document.createElement("canvas");
        const scale = Math.min(1, 720 / Math.max(working.width, working.height));
        preview.width = Math.max(1, Math.round(working.width * scale));
        preview.height = Math.max(1, Math.round(working.height * scale));
        preview.getContext("2d")!.drawImage(working, 0, 0, preview.width, preview.height);
        const originalPreview = rememberUrl(
          URL.createObjectURL(await encodePassportJpeg(preview)),
        );
        const fixed = await renderFromCrop(crop, adjustments);
        setState({
          fileName,
          originalUrl: originalPreview,
          fixedUrl: fixed.url,
          originalAnalysis,
          fixedAnalysis: fixed.analysis,
          jpegSize: fixed.size,
          adjustments,
        });
      } catch (err) {
        setState(null);
        setError(err instanceof Error ? err.message : "Could not read that image.");
      } finally {
        setBusy("idle");
      }
    },
    [cropWorking, renderFromCrop],
  );

  const onFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please drop a JPG photo (PNG is also accepted, then exported as JPEG).");
      return;
    }
    void processFile(file, file.name);
  };

  const updateAdjustments = async (next: Adjustments) => {
    if (!workingRef.current || !state) return;
    setState({ ...state, adjustments: next });
    setBusy("render");
    try {
      const headroomChanged = next.headroom !== state.adjustments.headroom;
      const crop = headroomChanged ? cropWorking(next.headroom).crop : cropRef.current;
      if (!crop) return;
      const fixed = await renderFromCrop(crop, next);
      setState((current) =>
        current
          ? {
              ...current,
              adjustments: next,
              fixedUrl: fixed.url,
              fixedAnalysis: fixed.analysis,
              jpegSize: fixed.size,
            }
          : current,
      );
    } finally {
      setBusy("idle");
    }
  };

  const lightingHeadline = useMemo(() => {
    const issue = state?.originalAnalysis.lightingIssue;
    if (issue === "too-dark") return "This photo is too dark for Passport Seva.";
    if (issue === "too-light") return "This photo is too light — facial detail is washing out.";
    if (issue === "uneven") return "Lighting is uneven across the face.";
    if (issue === "low-contrast") return "The face does not stand out from the background.";
    if (state) return "Lighting looks usable. Confirm the other Passport Seva checks.";
    return null;
  }, [state]);

  return (
    <div className="flex flex-col gap-8">
      <Alert className="border-primary/20 bg-card/90">
        <SunMedium />
        <AlertTitle>The message you are seeing</AlertTitle>
        <AlertDescription>
          “Your photo is too light or too dark. Try standing in front of a light
          background, standing where there’s even lighting to keep your face and
          features in focus, so they stand out from the background.”
        </AlertDescription>
      </Alert>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(20rem,0.95fr)]">
        <Card className="bg-card/95 shadow-sm">
          <CardHeader>
            <CardTitle className="font-heading text-xl">Your JPG</CardTitle>
            <CardDescription>
              Photos stay in this browser. Nothing is uploaded to a server.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/jpg,image/png,image/webp"
              className="sr-only"
              onChange={(event) => onFiles(event.target.files)}
            />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                onFiles(event.dataTransfer.files);
              }}
              className={cn(
                "flex min-h-44 flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center transition-colors",
                dragging
                  ? "border-primary bg-accent"
                  : "border-border bg-muted/40 hover:bg-muted/70",
              )}
            >
              <span className="flex size-11 items-center justify-center rounded-full bg-primary text-primary-foreground">
                {busy === "idle" ? (
                  <Upload className="size-5" />
                ) : (
                  <LoaderCircle className="size-5 animate-spin" />
                )}
              </span>
              <div>
                <p className="font-medium">Drop a passport JPG here</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  or click to choose a file from your phone or computer
                </p>
              </div>
            </button>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => void processFile(generateSampleRejectedPhoto(), "sample-too-dark.jpg")}
              >
                <ImageIcon data-icon="inline-start" />
                Try a too-dark sample
              </Button>
              {state && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    if (!state) return;
                    void updateAdjustments(suggestAdjustments(state.originalAnalysis));
                  }}
                >
                  <WandSparkles data-icon="inline-start" />
                  Re-run auto fix
                </Button>
              )}
            </div>

            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}

            {state && (
              <div className="grid gap-4 sm:grid-cols-2">
                <figure className="overflow-hidden rounded-xl bg-white ring-1 ring-foreground/10">
                  <div className="flex items-center justify-between px-3 py-2 text-xs text-muted-foreground">
                    <span>Your upload</span>
                    <span>full frame</span>
                  </div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={state.originalUrl}
                    alt="Original uploaded photo"
                    className="aspect-[7/9] w-full bg-[#f4f4f4] object-contain"
                  />
                </figure>
                <figure className="overflow-hidden rounded-xl bg-white ring-1 ring-foreground/10">
                  <div className="flex items-center justify-between px-3 py-2 text-xs text-muted-foreground">
                    <span>Prepared JPG</span>
                    <span>
                      {PASSPORT_WIDTH}×{PASSPORT_HEIGHT} · {formatBytes(state.jpegSize)}
                    </span>
                  </div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={state.fixedUrl}
                    alt="Lighting-corrected passport photo"
                    className="aspect-[7/9] w-full bg-white object-contain"
                  />
                </figure>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          <Card className="bg-card/95 shadow-sm">
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="font-heading text-xl">Lighting check</CardTitle>
                  <CardDescription>
                    {lightingHeadline ??
                      "Upload a photo to measure brightness, evenness, and background."}
                  </CardDescription>
                </div>
                {state && (
                  <Badge variant={state.fixedAnalysis.failedCount === 0 ? "default" : "destructive"}>
                    {state.fixedAnalysis.failedCount === 0
                      ? "Ready to download"
                      : `${state.fixedAnalysis.failedCount} issue${state.fixedAnalysis.failedCount === 1 ? "" : "s"}`}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {!state && (
                <p className="text-sm text-muted-foreground">
                  The Passport Seva checker looks at overall exposure and whether
                  your face is clearly darker or lighter than a plain white wall.
                  A dim room, a cream wall, or window light from one side is
                  usually why this exact error appears.
                </p>
              )}
              {state && (
                <ul className="flex flex-col gap-3">
                  {state.fixedAnalysis.checks.map((item) => {
                    const before = state.originalAnalysis.checks.find(
                      (check) => check.id === item.id,
                    );
                    return (
                      <li
                        key={item.id}
                        className="flex gap-3 rounded-lg bg-muted/50 px-3 py-2.5"
                      >
                        <StatusIcon status={item.status} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-medium">{item.label}</p>
                            <div className="flex items-center gap-1.5">
                              {before && before.status !== item.status && (
                                <span className="text-[11px] text-muted-foreground">
                                  was {before.status}
                                </span>
                              )}
                              <StatusBadge status={item.status} />
                            </div>
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">{item.detail}</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          {state && (
            <Card className="bg-card/95 shadow-sm">
              <CardHeader>
                <CardTitle className="font-heading text-xl">Fine-tune</CardTitle>
                <CardDescription>
                Auto-fix crops to a visafoto-style head-and-shoulder frame,
                exports 630×810, and turns the grey wall white. Drag the crop
                slider if you want more or less of the chest.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                <SliderRow
                  label="Crop like the sample"
                  hint={
                    state.adjustments.headroom <= 1.05
                      ? "tight 630×810"
                      : "showing more"
                  }
                  min={0.9}
                  max={1.45}
                  step={0.02}
                  value={state.adjustments.headroom}
                  onChange={(headroom) =>
                    void updateAdjustments({ ...state.adjustments, headroom })
                  }
                />
                <SliderRow
                  label="Exposure"
                  hint={
                    state.adjustments.exposure >= 0
                      ? `+${state.adjustments.exposure.toFixed(2)} stop`
                      : `${state.adjustments.exposure.toFixed(2)} stop`
                  }
                  min={-0.75}
                  max={1.25}
                  step={0.02}
                  value={state.adjustments.exposure}
                  onChange={(exposure) =>
                    void updateAdjustments({ ...state.adjustments, exposure })
                  }
                />
                <SliderRow
                  label="Feature contrast"
                  hint={state.adjustments.contrast.toFixed(2)}
                  min={0}
                  max={0.6}
                  step={0.01}
                  value={state.adjustments.contrast}
                  onChange={(contrast) =>
                    void updateAdjustments({ ...state.adjustments, contrast })
                  }
                />
                <SliderRow
                  label="Even out left / right"
                  hint={state.adjustments.evenLight.toFixed(2)}
                  min={-1}
                  max={1}
                  step={0.02}
                  value={state.adjustments.evenLight}
                  onChange={(evenLight) =>
                    void updateAdjustments({ ...state.adjustments, evenLight })
                  }
                />
                <SliderRow
                  label="Whiten background"
                  hint={state.adjustments.whiteBackground.toFixed(2)}
                  min={0}
                  max={1}
                  step={0.02}
                  value={state.adjustments.whiteBackground}
                  onChange={(whiteBackground) =>
                    void updateAdjustments({ ...state.adjustments, whiteBackground })
                  }
                />
                <Separator />
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    className="flex-1"
                    onClick={() => {
                      const link = document.createElement("a");
                      link.href = state.fixedUrl;
                      link.download = "indian-passport-photo-630x810.jpg";
                      link.click();
                    }}
                  >
                    <Download data-icon="inline-start" />
                    Download 630×810 JPG
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      void updateAdjustments({
                        ...NEUTRAL_ADJUSTMENTS,
                        headroom: state.adjustments.headroom,
                      })
                    }
                  >
                    Reset look
                  </Button>
                </div>
                {busy !== "idle" && (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <LoaderCircle className="size-4 animate-spin" />
                    Updating preview…
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Tabs defaultValue="fix" className="gap-4">
        <TabsList className="w-full max-w-xl">
          <TabsTrigger value="fix">What this tool fixes</TabsTrigger>
          <TabsTrigger value="retake">When to retake</TabsTrigger>
          <TabsTrigger value="spec">Passport Seva spec</TabsTrigger>
        </TabsList>
        <TabsContent value="fix" className="max-w-3xl text-sm leading-6 text-muted-foreground">
          <p>
            GPSP / Passport Seva 2.0 rejects photos that are too dark, too
            light, or where the face blends into the wall. A studio grey
            backdrop (around 240) looks white to the eye but fails the portal —
            this tool replaces it with pure white without recropping an
            already 630×810 file. If hair is already at the top of your
            original, we cannot invent the missing pixels; retake with a little
            space above the head.
          </p>
        </TabsContent>
        <TabsContent value="retake" className="max-w-3xl text-sm leading-6 text-muted-foreground">
          <p>
            Retake the photo if one side of the face is in deep shadow, if you
            used beauty mode, or if the wall behind you is coloured or dark.
            Face a large window (or two lamps at 45°), stand about a metre from a
            plain white wall, wear a dark top, take glasses off, and use the rear
            camera at eye level. The Ministry of External Affairs still wants a
            natural, unretouched face — this app only prepares the file, it does
            not invent lighting that was never there.
          </p>
        </TabsContent>
        <TabsContent value="spec" className="max-w-3xl">
          <dl className="grid gap-3 sm:grid-cols-2">
            {Object.entries(SPEC_SUMMARY).map(([key, value]) => (
              <div key={key} className="rounded-lg bg-card px-3 py-2 ring-1 ring-foreground/10">
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  {key}
                </dt>
                <dd className="mt-1 text-sm font-medium">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 flex items-start gap-2 text-sm text-muted-foreground">
            <Shield className="mt-0.5 size-4 shrink-0" />
            Official ICAO guidance also asks for a recent colour photo, mouth
            closed, eyes open, no red-eye, and no computer beautification.
          </p>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SliderRow({
  label,
  hint,
  min,
  max,
  step,
  value,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  value: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium">{label}</span>
        <span className="font-mono text-xs text-muted-foreground">{hint}</span>
      </div>
      <Slider
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        value={[value]}
        onValueChange={(next) => {
          const numeric = Array.isArray(next) ? next[0] : next;
          if (typeof numeric === "number") onChange(numeric);
        }}
      />
    </div>
  );
}
