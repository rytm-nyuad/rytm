"use client";

import { useState, useMemo, useRef } from "react";
import Link from "next/link";
import { PulsePreview } from "@/lib/db/pulses";

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

interface PulsesClientProps {
  pulses: PulsePreview[];
}

export function PulsesClient({ pulses }: PulsesClientProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const searchRef = useRef<HTMLElement>(null);
  const articlesRef = useRef<HTMLElement>(null);

  // Extract all unique tags
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    pulses.forEach((pulse) => {
      pulse.tags.forEach((tag) => tagSet.add(tag));
    });
    return Array.from(tagSet).sort();
  }, [pulses]);

  // Filter pulses
  const filteredPulses = useMemo(() => {
    return pulses.filter((pulse) => {
      // Search filter
      const matchesSearch =
        !searchQuery ||
        pulse.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        pulse.subtitle?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        pulse.excerpt?.toLowerCase().includes(searchQuery.toLowerCase());

      // Tag filter
      const matchesTag = !selectedTag || pulse.tags.includes(selectedTag);

      return matchesSearch && matchesTag;
    });
  }, [pulses, searchQuery, selectedTag]);

  // Get the latest published pulse for featured section
  const latestPulse = pulses.length > 0 ? pulses[0] : null;

  return (
    <>
      {/* Header Section */}
      <section className="pt-4 pb-6 px-6 bg-white">
        <div className="max-w-7xl mx-auto text-center">
          <h1 className="text-5xl md:text-6xl font-bold tracking-tight text-gray-900 mb-2">
            RYTM Pulses
          </h1>
          <p className="text-xl text-gray-600 mb-1 max-w-2xl mx-auto">
            Insights from building a performance intelligence engine.
          </p>
          {/* Supporting text removed for tighter gap */}
        </div>
      </section>

      {/* Hero Article Section */}
      {latestPulse && (
        <section className="py-4 px-6 bg-white">
          <div className="max-w-7xl mx-auto">
            <Link
              href={`/pulses/${latestPulse.slug}`}
              className="group block"
            >
              <article className="relative h-[340px] md:h-[420px] rounded-3xl overflow-hidden cursor-pointer transition-all duration-300 ease-out group-hover:scale-[1.02] border border-black/10 shadow-[0_20px_60px_rgba(0,0,0,0.15)]">
                {/* Background Image */}
                {latestPulse.cover_image_url ? (
                  <div className="absolute inset-0">
                    <img
                      src={latestPulse.cover_image_url}
                      alt={latestPulse.title}
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  </div>
                ) : (
                  <div className="absolute inset-0 bg-gradient-to-br from-gray-800 to-gray-900" />
                )}

                {/* Global Overlay - Light */}
                <div className="absolute inset-0 bg-black/25" />

                {/* Bottom Gradient Overlay - Strong for Readability */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent" />

                {/* Optional Arrow Icon - Top Right */}
                <div className="absolute top-6 right-6 opacity-0 group-hover:opacity-100 transition-all duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5">
                  <svg
                    className="w-8 h-8 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M7 17L17 7M17 7H7M17 7V17"
                    />
                  </svg>
                </div>

                {/* Text Panel Module - Glass Effect */}
                <div className="absolute left-6 bottom-6 md:left-10 md:bottom-8 max-w-2xl">
                  <div className="bg-black/20 backdrop-blur-md rounded-2xl p-3 md:p-5 transition-colors duration-300 group-hover:bg-black/30">
                    {/* Category Tag */}
                    {latestPulse.tags[0] && (
                      <span className="inline-block px-3 py-1 text-xs rounded-full bg-white/15 text-white/90 border border-white/15 mb-3">
                        {latestPulse.tags[0]}
                      </span>
                    )}

                    {/* Title */}
                    <h2 className="text-2xl md:text-4xl font-bold text-white mb-3 leading-tight tracking-tight line-clamp-2">
                      {latestPulse.title}
                    </h2>

                    {/* Description */}
                    {latestPulse.excerpt && (
                      <p className="text-sm md:text-base text-white/80 mb-4 line-clamp-2">
                        {latestPulse.excerpt}
                      </p>
                    )}

                    {/* Meta: Author + Date */}
                    <div className="flex items-center gap-3 text-sm text-white/65">
                      {latestPulse.author_name && (
                        <span className="font-medium">{latestPulse.author_name}</span>
                      )}
                      {latestPulse.published_at && (
                        <>
                          <span>•</span>
                          <span>{formatDate(latestPulse.published_at)}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </article>
            </Link>

            {/* View All Pulses Button - Centered with spacing, always visible above the fold */}
            <div className="flex justify-center mt-8">
              <button
                onClick={() => {
                  const element = searchRef.current;
                  if (element) {
                    const y = element.getBoundingClientRect().top + window.scrollY - 80; // 80px offset for navbar
                    window.scrollTo({ top: y, behavior: 'smooth' });
                  }
                }}
                className="flex flex-col items-center gap-2 text-gray-600 hover:text-gray-900 transition-all duration-300 group cursor-pointer"
                aria-label="View all pulses"
              >
                <div className="text-sm font-semibold tracking-wide uppercase opacity-80 group-hover:opacity-100">
                  View All Pulses
                </div>
                <div className="text-2xl animate-bounce">↓</div>
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Search & Filter Controls */}
      <section ref={searchRef} className="bg-gray-50 border-b border-gray-100 py-4 px-6">
        <div className="max-w-5xl mx-auto">
          {/* Search Bar */}
          <div className="mb-4">
            <div className="relative">
              <svg
                className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <input
                type="text"
                placeholder="Search pulses..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-12 pr-4 py-3 rounded-xl border border-gray-200 bg-white text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent transition-all"
              />
            </div>
          </div>

          {/* Filter Chips */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setSelectedTag(null)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                selectedTag === null
                  ? "bg-gray-900 text-white"
                  : "bg-white text-gray-700 border border-gray-200 hover:border-gray-300"
              }`}
            >
              All Articles
            </button>
            {allTags.map((tag) => (
              <button
                key={tag}
                onClick={() => setSelectedTag(tag === selectedTag ? null : tag)}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-all capitalize ${
                  selectedTag === tag
                    ? "bg-gray-900 text-white"
                    : "bg-white text-gray-700 border border-gray-200 hover:border-gray-300"
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Pulses Grid */}
      <section ref={articlesRef} className="bg-white py-12 px-6">
        <div className="max-w-5xl mx-auto">
          {filteredPulses.length === 0 ? (
            <div className="text-center py-24">
              <p className="text-gray-500 text-lg">
                {searchQuery || selectedTag
                  ? "No pulses match your filters."
                  : "No pulses yet. Stay tuned."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredPulses.map((pulse) => (
                <Link
                  key={pulse.id}
                  href={`/pulses/${pulse.slug}`}
                  className="group block"
                >
                  <article className="h-full bg-white rounded-xl border border-gray-200 overflow-hidden transition-all duration-300 hover:shadow-lg hover:border-gray-300">
                    {/* Cover Image */}
                    {pulse.cover_image_url && (
                      <div className="aspect-[16/9] overflow-hidden bg-gray-100">
                        <img
                          src={pulse.cover_image_url}
                          alt={pulse.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      </div>
                    )}

                    <div className="p-6">
                      {/* Author Name */}
                      {pulse.author_name && (
                        <p className="text-xs font-medium text-gray-500 mb-2">
                          By {pulse.author_name}
                        </p>
                      )}

                      {/* Tag + Date */}
                      <div className="flex items-center gap-2 mb-3">
                        {pulse.tags[0] && (
                          <span className="px-2.5 py-0.5 text-xs font-medium text-orange-600 bg-orange-50 rounded-full">
                            {pulse.tags[0]}
                          </span>
                        )}
                        <span className="text-xs text-gray-500">
                          {formatDate(pulse.published_at)}
                        </span>
                      </div>

                      {/* Title */}
                      <h3 className="text-lg font-semibold text-gray-900 leading-snug mb-2 group-hover:text-gray-700 transition-colors line-clamp-2">
                        {pulse.title}
                      </h3>

                      {/* Excerpt */}
                      {pulse.excerpt && (
                        <p className="text-sm text-gray-600 leading-relaxed mb-4 line-clamp-3">
                          {pulse.excerpt}
                        </p>
                      )}

                      {/* Read CTA */}
                      <div className="flex items-center gap-1.5 text-sm font-medium text-gray-900 group-hover:gap-2 transition-all">
                        <span>Read</span>
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
                            d="M17 8l4 4m0 0l-4 4m4-4H3"
                          />
                        </svg>
                      </div>
                    </div>
                  </article>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
