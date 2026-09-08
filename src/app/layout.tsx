import type { Metadata } from "next";
import { Fraunces, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Passport Photo Prep — Indian Passport Seva photo & signature",
  description:
    "Prepare GPSP 2.0 uploads in the browser: a 630×810 ICAO photo and a signature JPEG under 100 KB, with white paper and 80–85% fill.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} h-full antialiased light`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
