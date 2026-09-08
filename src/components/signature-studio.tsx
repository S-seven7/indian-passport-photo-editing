"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Download,
  ImageIcon,
  LoaderCircle,
  PenLine,
  Shield,
  Trash2,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SliderRow, StatusBadge, StatusIcon } from "@/components/studio-controls";
import {
  SIGNATURE_HEIGHT,
  SIGNATURE_SPEC_SUMMARY,
  SIGNATURE_WIDTH,
} from "@/lib/passport-spec";
import {
  bitmapToWorkingCanvas,
  canvasFromImageData,
  formatBytes,
  loadImageBitmap,
} from "@/lib/photo-engine";
import {
  analyzeSignature,
  applySignatureFix,
  DEFAULT_SIGNATURE_ADJUSTMENTS,
  encodeSignatureJpeg,
  generateSampleRejectedSignature,
  suggestSignatureAdjustments,
  type SignatureAdjustments,
  type SignatureAnalysis,
} from "@/lib/signature-engine";
import { cn } from "@/lib/utils";

type SignatureJob = {
  id: string;
  fileName: string;
  originalUrl: string;
  fixedUrl: string;
  originalAnalysis: SignatureAnalysis;
  fixedAnalysis: SignatureAnalysis;
  jpegSize: number;
  adjustments: SignatureAdjustments;
};

function nextId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function SignatureStudio() {
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState<"idle" | "analyze" | "render">("idle");
  const [error, setError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<SignatureJob[]>([]);
  const workingRef = useRef<Map<string, ImageData>>(new Map());
  const urlsRef = useRef<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const rememberUrl = (url: string) => {
    urlsRef.current.push(url);
    return url;
  };

  useEffect(() => {
    const urls = urlsRef.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, []);

  const renderPrepared = useCallback(async (source: ImageData, adjustments: SignatureAdjustments) => {
    const fixed = applySignatureFix(source, adjustments);
    const canvas = canvasFromImageData(fixed);
    const blob = await encodeSignatureJpeg(canvas);
    const analysis = analyzeSignature(fixed, {
      fileBytes: blob.size,
      mime: "image/jpeg",
    });
    return { url: rememberUrl(URL.createObjectURL(blob)), analysis, size: blob.size, image: fixed };
  }, []);

  const processFiles = useCallback(
    async (files: File[]) => {
      const images = files.filter((file) => file.type.startsWith("image/"));
      if (images.length === 0) {
        setError("Please drop a photo or scan of a signature (JPG or PNG).");
        return;
      }
      setBusy("analyze");
      setError(null);
      try {
        const created: SignatureJob[] = [];
        for (const file of images) {
          const bitmap = await loadImageBitmap(file);
          const working = bitmapToWorkingCanvas(bitmap, 1800);
          bitmap.close();
          const source = working
            .getContext("2d", { willReadFrequently: true })!
            .getImageData(0, 0, working.width, working.height);
          const originalAnalysis = analyzeSignature(source, {
            fileBytes: file.size,
            mime: file.type || "image/jpeg",
          });
          const adjustments = suggestSignatureAdjustments(originalAnalysis);
          const preview = document.createElement("canvas");
          const scale = Math.min(1, 900 / Math.max(working.width, working.height));
          preview.width = Math.max(1, Math.round(working.width * scale));
          preview.height = Math.max(1, Math.round(working.height * scale));
          preview.getContext("2d")!.drawImage(working, 0, 0, preview.width, preview.height);
          const originalUrl = rememberUrl(URL.createObjectURL(await encodeSignatureJpeg(preview)));
          setBusy("render");
          const prepared = await renderPrepared(source, adjustments);
          const id = nextId();
          workingRef.current.set(id, source);
          created.push({
            id,
            fileName: file.name,
            originalUrl,
            fixedUrl: prepared.url,
            originalAnalysis,
            fixedAnalysis: prepared.analysis,
            jpegSize: prepared.size,
            adjustments,
          });
        }
        setJobs((current) => [...current, ...created]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not read that image.");
      } finally {
        setBusy("idle");
      }
    },
    [renderPrepared],
  );

  const onFiles = (list: FileList | null) => {
    if (!list?.length) return;
    void processFiles(Array.from(list));
  };

  const updateJob = async (id: string, adjustments: SignatureAdjustments) => {
    const source = workingRef.current.get(id);
    const current = jobs.find((job) => job.id === id);
    if (!source || !current) return;
    setJobs((list) => list.map((job) => (job.id === id ? { ...job, adjustments } : job)));
    setBusy("render");
    try {
      const prepared = await renderPrepared(source, adjustments);
      setJobs((list) =>
        list.map((job) =>
          job.id === id
            ? {
                ...job,
                adjustments,
                fixedUrl: prepared.url,
                fixedAnalysis: prepared.analysis,
                jpegSize: prepared.size,
              }
            : job,
        ),
      );
    } finally {
      setBusy("idle");
    }
  };

  const removeJob = (id: string) => {
    workingRef.current.delete(id);
    setJobs((list) => list.filter((job) => job.id !== id));
  };

  return (
    <div className="flex flex-col gap-8">
      <Alert className="border-primary/20 bg-card/90">
        <PenLine />
        <AlertTitle>GPSP 2.0 signature upload</AlertTitle>
        <AlertDescription>
          Sign on plain white paper with black or dark blue ink, then photograph
          or scan it. The portal wants a JPEG under 100 KB, a white background,
          and the signature filling 80–85% of a rectangular box — not a full
          page of paper.
        </AlertDescription>
      </Alert>

      <Card className="bg-card/95 shadow-sm">
        <CardHeader>
          <CardTitle className="font-heading text-xl">Your signature scans</CardTitle>
          <CardDescription>
            Drop one or more files. They stay in this browser; nothing is
            uploaded to a server.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/webp"
            multiple
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
              <p className="font-medium">Drop signature photos here</p>
              <p className="mt-1 text-sm text-muted-foreground">
                JPG or PNG · you can add several at once
              </p>
            </div>
          </button>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() =>
                void processFiles([
                  new File([generateSampleRejectedSignature()], "sample-grey-signature.jpg", {
                    type: "image/jpeg",
                  }),
                ])
              }
            >
              <ImageIcon data-icon="inline-start" />
              Try a grey / faint sample
            </Button>
            {jobs.length > 0 && (
              <Button variant="secondary" onClick={() => inputRef.current?.click()}>
                <Upload data-icon="inline-start" />
                Add another
              </Button>
            )}
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </CardContent>
      </Card>

      {jobs.length === 0 && (
        <p className="text-sm text-muted-foreground">
          A phone photo of a whole A4 page almost always fails: the file is too
          large, the paper looks grey, and the signature is a thin strip in the
          middle. This checker crops to the ink, whitens the paper, darkens
          faint strokes, and exports a 600×200 JPG.
        </p>
      )}

      {jobs.map((job, index) => (
        <div
          key={job.id}
          className="grid gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(20rem,0.95fr)]"
        >
          <Card className="bg-card/95 shadow-sm">
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="font-heading text-xl">
                    Signature {jobs.length > 1 ? index + 1 : ""}
                  </CardTitle>
                  <CardDescription className="break-all">{job.fileName}</CardDescription>
                </div>
                <Button variant="ghost" size="icon" onClick={() => removeJob(job.id)} aria-label="Remove">
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid gap-4">
                <figure className="overflow-hidden rounded-xl bg-white ring-1 ring-foreground/10">
                  <div className="flex items-center justify-between px-3 py-2 text-xs text-muted-foreground">
                    <span>Your upload</span>
                    <span>
                      {job.originalAnalysis.width}×{job.originalAnalysis.height}
                    </span>
                  </div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={job.originalUrl}
                    alt={`Original signature ${job.fileName}`}
                    className="max-h-56 w-full bg-[#f4f4f4] object-contain"
                  />
                </figure>
                <figure className="overflow-hidden rounded-xl bg-white ring-1 ring-foreground/10">
                  <div className="flex items-center justify-between px-3 py-2 text-xs text-muted-foreground">
                    <span>Prepared JPG</span>
                    <span>
                      {SIGNATURE_WIDTH}×{SIGNATURE_HEIGHT} · {formatBytes(job.jpegSize)}
                    </span>
                  </div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={job.fixedUrl}
                    alt={`Prepared signature ${job.fileName}`}
                    className="aspect-[3/1] w-full bg-white object-contain"
                  />
                </figure>
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-col gap-6">
            <Card className="bg-card/95 shadow-sm">
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="font-heading text-xl">Signature check</CardTitle>
                    <CardDescription>
                      {job.fixedAnalysis.failedCount === 0
                        ? "This file matches the GPSP 2.0 signature guidance."
                        : "The prepared file still has issues — retake on white paper with a darker pen."}
                    </CardDescription>
                  </div>
                  <Badge variant={job.fixedAnalysis.failedCount === 0 ? "default" : "destructive"}>
                    {job.fixedAnalysis.failedCount === 0
                      ? "Ready to download"
                      : `${job.fixedAnalysis.failedCount} issue${job.fixedAnalysis.failedCount === 1 ? "" : "s"}`}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-3">
                  {job.fixedAnalysis.checks.map((item) => {
                    const beforeItem = job.originalAnalysis.checks.find((check) => check.id === item.id);
                    return (
                      <li key={item.id} className="flex gap-3 rounded-lg bg-muted/50 px-3 py-2.5">
                        <StatusIcon status={item.status} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-medium">{item.label}</p>
                            <div className="flex items-center gap-1.5">
                              {beforeItem && beforeItem.status !== item.status && (
                                <span className="text-[11px] text-muted-foreground">
                                  was {beforeItem.status}
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
              </CardContent>
            </Card>

            <Card className="bg-card/95 shadow-sm">
              <CardHeader>
                <CardTitle className="font-heading text-xl">Fine-tune</CardTitle>
                <CardDescription>
                  Auto-fix whitened the paper and cropped to 80–85% fill. Drag
                  if the stroke is too tight or still faint.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                <SliderRow
                  label="Fill the box"
                  hint={`${Math.round(job.adjustments.coverage * 100)}%`}
                  min={0.72}
                  max={0.92}
                  step={0.01}
                  value={job.adjustments.coverage}
                  onChange={(coverage) => void updateJob(job.id, { ...job.adjustments, coverage })}
                />
                <SliderRow
                  label="Darken ink"
                  hint={job.adjustments.inkBoost.toFixed(2)}
                  min={0.4}
                  max={1.35}
                  step={0.02}
                  value={job.adjustments.inkBoost}
                  onChange={(inkBoost) => void updateJob(job.id, { ...job.adjustments, inkBoost })}
                />
                <SliderRow
                  label="Whiten paper"
                  hint={job.adjustments.whitePaper.toFixed(2)}
                  min={0}
                  max={1}
                  step={0.02}
                  value={job.adjustments.whitePaper}
                  onChange={(whitePaper) => void updateJob(job.id, { ...job.adjustments, whitePaper })}
                />
                <Separator />
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    className="flex-1"
                    onClick={() => {
                      const link = document.createElement("a");
                      link.href = job.fixedUrl;
                      link.download =
                        jobs.length > 1
                          ? `indian-passport-signature-${index + 1}.jpg`
                          : "indian-passport-signature.jpg";
                      link.click();
                    }}
                  >
                    <Download data-icon="inline-start" />
                    Download signature JPG
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      void updateJob(job.id, suggestSignatureAdjustments(job.originalAnalysis))
                    }
                  >
                    <WandSparkles data-icon="inline-start" />
                    Re-run auto fix
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      void updateJob(job.id, {
                        ...DEFAULT_SIGNATURE_ADJUSTMENTS,
                        coverage: job.adjustments.coverage,
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
          </div>
        </div>
      ))}

      <Tabs defaultValue="how" className="gap-4">
        <TabsList className="w-full max-w-xl">
          <TabsTrigger value="how">How to sign</TabsTrigger>
          <TabsTrigger value="fix">What this tool fixes</TabsTrigger>
          <TabsTrigger value="spec">GPSP 2.0 spec</TabsTrigger>
        </TabsList>
        <TabsContent value="how" className="max-w-3xl text-sm leading-6 text-muted-foreground">
          <p>
            Use a black or dark blue ballpoint on a blank white sheet. Sign the
            way you sign your passport — not in pencil, not in marker that
            blobs. Photograph it in even light, or scan it. Crop loosely around
            the signature if you can; the app will tighten the box. Do not add
            a date, a stamp, or printed text in the same frame.
          </p>
        </TabsContent>
        <TabsContent value="fix" className="max-w-3xl text-sm leading-6 text-muted-foreground">
          <p>
            Embassy guidance for GPSP 2.0 is to crop a rectangle so the
            signature covers 80–85% of the box, remove a grey background and
            stray marks, save as JPG, and stay around 100 KB. This tool does
            that in the browser. It cannot invent a signature that was never
            written, and it will not forge or copy someone else’s mark.
          </p>
        </TabsContent>
        <TabsContent value="spec" className="max-w-3xl">
          <dl className="grid gap-3 sm:grid-cols-2">
            {Object.entries(SIGNATURE_SPEC_SUMMARY).map(([key, value]) => (
              <div key={key} className="rounded-lg bg-card px-3 py-2 ring-1 ring-foreground/10">
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">{key}</dt>
                <dd className="mt-1 text-sm font-medium">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 flex items-start gap-2 text-sm text-muted-foreground">
            <Shield className="mt-0.5 size-4 shrink-0" />
            There is no official pixel size on the portal. 600×200 is a
            practical wide rectangle that matches the 80–85% crop instruction.
          </p>
        </TabsContent>
      </Tabs>
    </div>
  );
}
