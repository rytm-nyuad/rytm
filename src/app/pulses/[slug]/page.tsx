import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  getPulseBySlug,
  getAdjacentPulses,
  getPublishedPulses,
} from "@/lib/db/pulses";
import { MarkdownRenderer } from "@/components/pulses/MarkdownRenderer";

export const dynamic = "force-dynamic";
export const revalidate = 0; // No caching whatsoever

interface PageProps {
  params: { slug: string };
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const pulse = await getPulseBySlug(params.slug);

  if (!pulse) {
    return { title: "Pulse Not Found — RYTM" };
  }

  return {
    title: `${pulse.title} — RYTM Pulses`,
    description: pulse.excerpt || pulse.subtitle || undefined,
    openGraph: {
      title: pulse.title,
      description: pulse.excerpt || pulse.subtitle || undefined,
      type: "article",
      publishedTime: pulse.published_at || undefined,
      tags: pulse.tags,
      ...(pulse.cover_image_url && { images: [pulse.cover_image_url] }),
    },
  };
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default async function PulseArticlePage({ params }: PageProps) {
  const pulse = await getPulseBySlug(params.slug);

  if (!pulse) {
    notFound();
  }

  // Debug logging
  console.log('Pulse cover_image_url:', pulse.cover_image_url);

  const adjacent = await getAdjacentPulses(pulse.pulse_number);

  return (
    <main className="min-h-screen bg-black text-white">
      {/* Nav */}
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-black/80 border-b border-white/[0.04]">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-6 py-5">
          <Link
            href="/"
            className="text-xl font-bold tracking-tight hover:text-zinc-300 transition-colors"
          >
            rytm
          </Link>
          <nav className="flex items-center gap-6">
            <Link
              href="/pulses"
              className="text-sm font-medium text-zinc-400 hover:text-white transition-colors"
            >
              Pulses
            </Link>
            <Link
              href="/sign-in"
              className="text-sm font-medium text-zinc-500 hover:text-white transition-colors"
            >
              Log in
            </Link>
            <Link
              href="/sign-up"
              className="text-sm font-medium px-4 py-2 bg-white text-black rounded-lg hover:bg-zinc-200 transition-colors"
            >
              Sign up
            </Link>
          </nav>
        </div>
      </header>

      {/* Back link */}
      <div className="max-w-3xl mx-auto px-6 pt-8">
        <Link
          href="/pulses"
          className="inline-flex items-center gap-2 text-sm text-zinc-500 hover:text-white transition-colors group"
        >
          <svg
            className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M7 16l-4-4m0 0l4-4m-4 4h18"
            />
          </svg>
          Back to Pulses
        </Link>
      </div>

      {/* Article */}
      <article className="max-w-3xl mx-auto px-6 pt-10 pb-20">
        {/* Meta row */}
        <div className="flex items-center gap-3 text-xs text-zinc-500 font-medium tracking-wide uppercase mb-6">
          <span className="text-zinc-400">
            Pulse #{String(pulse.pulse_number).padStart(3, "0")}
          </span>
          <span className="w-1 h-1 rounded-full bg-zinc-700" />
          <span>{formatDate(pulse.published_at)}</span>
          {pulse.author_name && (
            <>
              <span className="w-1 h-1 rounded-full bg-zinc-700" />
              <span>{pulse.author_name}</span>
            </>
          )}
        </div>

        {/* Title */}
        <h1 className="text-3xl md:text-5xl font-bold tracking-tight leading-[1.1] mb-5">
          {pulse.title}
        </h1>

        {/* Subtitle */}
        {pulse.subtitle && (
          <p className="text-xl text-zinc-400 leading-relaxed mb-6">
            {pulse.subtitle}
          </p>
        )}

        {/* Tags */}
        <div className="flex flex-wrap gap-2 mb-10">
          {pulse.tags.map((tag) => (
            <span
              key={tag}
              className="px-2.5 py-1 text-xs font-medium rounded-full bg-white/[0.06] text-zinc-400 border border-white/[0.06]"
            >
              {tag}
            </span>
          ))}
        </div>

        {/* Divider */}
        <div className="h-px bg-gradient-to-r from-transparent via-zinc-800 to-transparent mb-10" />

        {/* Cover image */}
        {pulse.cover_image_url && (
          <div className="mb-12 rounded-xl overflow-hidden border border-white/[0.06]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={pulse.cover_image_url}
              alt={pulse.title}
              className="w-full h-auto"
            />
          </div>
        )}

        {/* Content */}
        <div className="prose-rytm">
          <MarkdownRenderer content={pulse.content_markdown} />
        </div>

        {/* Bottom divider */}
        <div className="h-px bg-gradient-to-r from-transparent via-zinc-800 to-transparent mt-16 mb-10" />

        {/* Previous / Next navigation */}
        <nav className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {adjacent.previous ? (
            <Link
              href={`/pulses/${adjacent.previous.slug}`}
              className="group flex flex-col gap-2 p-5 rounded-xl border border-white/[0.06] hover:border-white/[0.12] transition-all"
            >
              <span className="text-xs text-zinc-600 uppercase tracking-wide">
                ← Previous
              </span>
              <span className="text-sm font-medium text-zinc-300 group-hover:text-white transition-colors">
                Pulse #{String(adjacent.previous.pulse_number).padStart(3, "0")}
                {" — "}
                {adjacent.previous.title.replace(/^Pulse #\d+\s*—?\s*/, "")}
              </span>
            </Link>
          ) : (
            <div />
          )}

          {adjacent.next ? (
            <Link
              href={`/pulses/${adjacent.next.slug}`}
              className="group flex flex-col gap-2 p-5 rounded-xl border border-white/[0.06] hover:border-white/[0.12] transition-all text-right md:col-start-2"
            >
              <span className="text-xs text-zinc-600 uppercase tracking-wide">
                Next →
              </span>
              <span className="text-sm font-medium text-zinc-300 group-hover:text-white transition-colors">
                Pulse #{String(adjacent.next.pulse_number).padStart(3, "0")}
                {" — "}
                {adjacent.next.title.replace(/^Pulse #\d+\s*—?\s*/, "")}
              </span>
            </Link>
          ) : null}
        </nav>
      </article>

      {/* Footer */}
      <footer className="border-t border-white/[0.04] py-8 px-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between text-xs text-zinc-600">
          <span>© {new Date().getFullYear()} rytm</span>
          <Link href="/pulses" className="hover:text-zinc-400 transition-colors">
            All Pulses
          </Link>
        </div>
      </footer>
    </main>
  );
}
