"use client";

import { SessionProvider, useSession, signIn } from "next-auth/react";
import { Clock } from "lucide-react";

const AUTH_ENABLED = process.env.NEXT_PUBLIC_AUTH_ENABLED === "true";

export function Providers({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  if (!AUTH_ENABLED) return <>{children}</>;
  return <Gate>{children}</Gate>;
}

function Gate({ children }: { children: React.ReactNode }) {
  const { status } = useSession();

  if (status === "loading") {
    return (
      <div className="flex h-screen items-center justify-center text-ink-faint text-sm">
        Loading…
      </div>
    );
  }

  if (status === "unauthenticated") {
    return (
      <div className="flex h-screen flex-col items-center justify-center px-6 text-center">
        <div className="w-12 h-12 rounded-2xl bg-accent-soft flex items-center justify-center mb-4">
          <Clock size={22} className="text-accent" />
        </div>
        <h1 className="font-serif-display text-2xl mb-2">SuperPixel Clock</h1>
        <p className="text-ink-soft mb-8 max-w-xs text-sm">
          Sign in with your Slack account to clock in and out of projects.
        </p>
        <button
          onClick={() => signIn("slack")}
          className="rounded-xl bg-accent px-6 py-3 text-white font-medium hover:bg-accent-hover transition-colors"
        >
          Sign in with Slack
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
