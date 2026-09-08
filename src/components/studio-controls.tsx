"use client";

import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import type { PhotoCheck } from "@/lib/photo-engine";

export function StatusIcon({ status }: { status: PhotoCheck["status"] }) {
  if (status === "pass") {
    return <CheckCircle2 className="size-4 text-emerald-700" />;
  }
  if (status === "warn") {
    return <AlertTriangle className="size-4 text-amber-600" />;
  }
  return <AlertTriangle className="size-4 text-destructive" />;
}

export function StatusBadge({ status }: { status: PhotoCheck["status"] }) {
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

export function SliderRow({
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
