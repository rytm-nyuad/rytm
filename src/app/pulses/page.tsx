import type { Metadata } from "next";
import { getPublishedPulses } from "@/lib/db/pulses";
import { PulsesClient } from "@/components/pulses/PulsesClient";
import { PageShell } from "@/components/PageShell";

export const metadata: Metadata = {
  title: "Pulses — RYTM",
  description:
    "Insights from building a performance intelligence engine. Essays on sleep science, circadian modeling, and the design decisions behind RYTM.",
};

// Force dynamic to always fetch latest data
export const dynamic = "force-dynamic";
export const revalidate = 0; // No caching whatsoever

export default async function PulsesPage() {
  const pulses = await getPublishedPulses();

  return (
    <PageShell navbarVariant="sticky">
      <div>
        {/* Client-side content with search and filtering */}
        <PulsesClient pulses={pulses} />

      {/* Footer */}
      <footer className="border-t border-gray-100 py-8 px-6 bg-white">
        <div className="max-w-5xl mx-auto text-center">
          <p className="text-xs text-gray-500">
            Master your flow • Privacy-first • Built for performance
          </p>
        </div>
      </footer>
      </div>
    </PageShell>
  );
}
