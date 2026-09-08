import { Camera, PenLine } from "lucide-react";
import { PhotoStudio } from "@/components/photo-studio";
import { SignatureStudio } from "@/components/signature-studio";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function Home() {
  return (
    <div className="passport-shell flex min-h-full flex-1 flex-col">
      <header className="border-b border-white/10 bg-[var(--passport-navy)] text-[var(--passport-paper)]">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-8 sm:px-6 sm:py-10">
          <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-[var(--passport-gold)]">
            Indian passport renewal · GPSP 2.0
          </p>
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <h1 className="font-heading max-w-xl text-4xl leading-none tracking-tight sm:text-5xl">
              Passport Photo Prep
            </h1>
            <p className="max-w-md text-sm leading-6 text-white/75">
              Prepare the two files GPSP 2.0 asks you to upload: an ICAO photo
              and a scanned signature. Both stay in this browser.
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-4 py-8 sm:px-6 sm:py-10">
        <Tabs defaultValue="signature" className="gap-6">
          <TabsList className="h-11 w-full max-w-md">
            <TabsTrigger value="photo" className="gap-2">
              <Camera className="size-4" />
              Photograph
            </TabsTrigger>
            <TabsTrigger value="signature" className="gap-2">
              <PenLine className="size-4" />
              Signature
            </TabsTrigger>
          </TabsList>
          <TabsContent value="photo">
            <PhotoStudio />
          </TabsContent>
          <TabsContent value="signature">
            <SignatureStudio />
          </TabsContent>
        </Tabs>
      </main>

      <footer className="mt-auto border-t border-foreground/10 px-4 py-6 text-center text-xs text-muted-foreground sm:px-6">
        Technical file prep for passportindia.gov.in. Photo: 630×810 JPEG,
        20–250 KB. Signature: JPEG under 100 KB. This is not a government
        website.
      </footer>
    </div>
  );
}
