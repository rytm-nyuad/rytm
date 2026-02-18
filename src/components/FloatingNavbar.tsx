"use client";

import Link from "next/link";
import Image from "next/image";

type NavbarVariant = "floating" | "sticky";

interface NavbarProps {
  variant?: NavbarVariant;
}

export function Navbar({ variant = "floating" }: NavbarProps) {
  if (variant === "floating") {
    return (
      <header className="fixed top-3 sm:top-5 left-1/2 -translate-x-1/2 z-50 w-auto max-w-[95vw] sm:max-w-none">
        <nav className="h-10 sm:h-14 rounded-full bg-neutral-900 px-1.5 sm:px-3 shadow-[0_8px_32px_rgba(0,0,0,0.25)] flex items-center gap-0.5 sm:gap-1">
          {/* Logo */}
          <Link
            href="/"
            className="w-8 h-8 sm:w-11 sm:h-11 rounded-full bg-white flex items-center justify-center shrink-0 hover:bg-white/90 transition-colors"
          >
            <Image
              src="/rytm.svg"
              alt="RYTM"
              width={36}
              height={36}
              className="w-full h-full object-contain p-1"
            />
          </Link>

          {/*
          Center: Pulses (temporarily removed from navbar)
          <Link
            href="/pulses"
            className="inline-flex items-center gap-2 h-9 px-5 text-sm font-medium text-white hover:text-white/80 transition-colors"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 13h4l3-9 4 18 3-9h4"
              />
            </svg>
            <span>Pulses</span>
          </Link>
          */}

          {/* Right: Login + Sign up */}
          <Link
            href="/sign-in"
            className="h-7 sm:h-9 px-2 sm:px-4 text-xs sm:text-sm font-medium text-white hover:text-white/80 transition-colors flex items-center shrink-0"
          >
            Log in
          </Link>
          <Link
            href="/sign-up"
            className="h-8 sm:h-10 px-3 sm:px-6 rounded-full bg-white text-neutral-900 text-xs sm:text-sm font-medium flex items-center hover:bg-white/90 transition-colors shrink-0"
          >
            Sign up
          </Link>
        </nav>
      </header>
    );
  }

  // Sticky variant - full width line with centered pill
  return (
    <header className="sticky top-0 z-50 w-full bg-white/80 backdrop-blur-md border-b border-black/10">
      <div className="flex justify-center py-2 sm:py-3 px-2 sm:px-4">
        <nav className="h-10 sm:h-14 rounded-full bg-neutral-900 px-1.5 sm:px-3 shadow-[0_8px_32px_rgba(0,0,0,0.25)] flex items-center gap-0.5 sm:gap-1">
          {/* Logo */}
          <Link
            href="/"
            className="w-8 h-8 sm:w-11 sm:h-11 rounded-full bg-white flex items-center justify-center shrink-0 hover:bg-white/90 transition-colors"
          >
            <Image
              src="/rytm.svg"
              alt="RYTM"
              width={36}
              height={36}
              className="w-full h-full object-contain p-1"
            />
          </Link>

          {/* Center: Pulses */}
          <Link
            href="/pulses"
            className="inline-flex items-center gap-1 sm:gap-2 h-7 sm:h-9 px-2 sm:px-5 text-xs sm:text-sm font-medium text-white hover:text-white/80 transition-colors"
          >
            <svg
              className="w-3.5 h-3.5 sm:w-4 sm:h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 13h4l3-9 4 18 3-9h4"
              />
            </svg>
            <span className="hidden xs:inline sm:inline">Pulses</span>
          </Link>

          {/* Right: Login + Sign up */}
          <Link
            href="/sign-in"
            className="h-7 sm:h-9 px-2 sm:px-4 text-xs sm:text-sm font-medium text-white hover:text-white/80 transition-colors flex items-center shrink-0"
          >
            Log in
          </Link>
          <Link
            href="/sign-up"
            className="h-8 sm:h-10 px-3 sm:px-6 rounded-full bg-white text-neutral-900 text-xs sm:text-sm font-medium flex items-center hover:bg-white/90 transition-colors shrink-0"
          >
            Sign up
          </Link>
        </nav>
      </div>
    </header>
  );
}

// Keep backwards compatibility
export { Navbar as FloatingNavbar };
