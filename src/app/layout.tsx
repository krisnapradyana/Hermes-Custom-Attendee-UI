import type { Metadata, Viewport } from "next";
import "@fontsource-variable/plus-jakarta-sans";
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
          // Same theme mechanism as the main app (own subdomain = own saved
          // preference; defaults to the system theme).
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('hermes-theme')||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark');}catch(e){}})();`,
          }}
        />
      </head>
      <body className="antialiased">
        {/* Canvas pinned to the VIEWPORT (not the page): the aurora never
            scrolls, so glows stay in the screen corners at any page height —
            no seams, no mid-scroll patches (field screenshot). */}
        <div className="app-canvas fixed inset-0 -z-10" aria-hidden />
        <Providers>
          <AuthGate>{children}</AuthGate>
        </Providers>
      </body>
    </html>
  );
}
