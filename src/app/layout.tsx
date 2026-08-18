import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers, AuthGate } from "@/components/Providers";

export const metadata: Metadata = {
  title: "SuperPixel Clock",
  description: "Clock in and out of SuperPixel projects.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // The big clock button should never require pinch-zooming on a phone.
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          // Follow the same saved theme as the main app (shared domain).
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('hermes-theme')||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark');}catch(e){}})();`,
          }}
        />
      </head>
      <body className="antialiased">
        <Providers>
          <AuthGate>{children}</AuthGate>
        </Providers>
      </body>
    </html>
  );
}
