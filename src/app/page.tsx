import { PhotoStudio } from "@/components/photo-studio";

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
              Built for the Passport Seva lighting rejection: too light, too
              dark, or a face that does not stand out from the wall behind you.
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-4 py-8 sm:px-6 sm:py-10">
        <PhotoStudio />
      </main>

      <footer className="mt-auto border-t border-foreground/10 px-4 py-6 text-center text-xs text-muted-foreground sm:px-6">
        Technical file prep for passportindia.gov.in. Confirm the live portal
        still asks for a 630×810 JPEG under 250 KB before you upload. This is
        not a government website.
      </footer>
    </div>
  );
}
