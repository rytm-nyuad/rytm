"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-4xl mx-auto px-6 py-12">
        {/* Back button */}
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-zinc-400 hover:text-white mb-8 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </Link>

        {/* Header */}
        <div className="mb-12 text-center">
          <h1 className="text-4xl font-bold mb-2">RYTM — Privacy</h1>
          <p className="text-zinc-400 mb-6">Last updated: February 9, 2026</p>
          
          <div className="mb-8">
            <p className="text-zinc-300 leading-relaxed">
              At RYTM, our goal is simple: help you understand your performance, habits, and wellbeing, and use that understanding to make you better through the RYTM AI Coach.
            </p>
            <p className="text-zinc-300 leading-relaxed mt-4">
              We built RYTM as a capstone research project, and we're now turning it into a product you can use. Because of that, we care a lot about being transparent with your data.
            </p>
        
          </div>
        </div>

        {/* Content */}
        <div className="prose prose-invert prose-zinc max-w-none space-y-8">
          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">What data we collect</h2>
            
            <div className="space-y-6">
              <div>
                <h3 className="text-xl font-semibold mb-2 text-white">1) Data you give us</h3>
                <p className="text-zinc-300 leading-relaxed mb-4">
                  When you sign up and use RYTM, you may share:
                </p>
                <ul className="list-disc list-inside text-zinc-300 space-y-1 ml-4">
                  <li>Your name and email</li>
                  <li>Your goals, check-ins, notes, or reflections</li>
                  <li>Anything you type or upload into the app</li>
                </ul>
                <p className="text-zinc-300 leading-relaxed mt-4">
                  This is your data, what you input is what we collect, and we use it to make RYTM useful for you.
                </p>
              </div>

              <div>
                <h3 className="text-xl font-semibold mb-2 text-white">2) Data from your wearable (Fitbit & WHOOP)</h3>
                <p className="text-zinc-300 leading-relaxed mb-4">
                  If you choose to connect your Fitbit or WHOOP, we collect only what you agree to in the OAuth permission screen.
                </p>
                <p className="text-zinc-300 leading-relaxed mb-2">
                  This may include things like:
                </p>
                <ul className="list-disc list-inside text-zinc-300 space-y-1 ml-4">
                  <li>Steps and activity</li>
                  <li>Sleep data</li>
                  <li>Heart rate and recovery metrics</li>
                  <li>Other performance-related stats</li>
                </ul>
                <p className="text-zinc-300 leading-relaxed mt-4">
                  There will be a clear list of what data we access during the connection process, and you can choose exactly what to share. We only use this data to provide insights and feedback in RYTM.
                </p>
                <p className="text-zinc-300 leading-relaxed mt-4">
                  You can disconnect your wearable at any time from your Fitbit/WHOOP settings.
                </p>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">How we use your data</h2>
            <p className="text-zinc-300 leading-relaxed mb-4">
              We use your data in three main ways:
            </p>

            <div className="space-y-6">
              <div>
                <h3 className="text-xl font-semibold mb-2 text-white">A) To power your RYTM experience</h3>
                <p className="text-zinc-300 leading-relaxed mb-2">
                  Your data helps us:
                </p>
                <ul className="list-disc list-inside text-zinc-300 space-y-1 ml-4">
                  <li>Show you insights and trends</li>
                  <li>Track your progress</li>
                  <li>Give you feedback through the RYTM AI Coach</li>
                  <li>Make your experience personalized and meaningful</li>
                </ul>
              </div>

              <div>
                <h3 className="text-xl font-semibold mb-2 text-white">B) For research and improving RYTM (anonymized)</h3>
                <p className="text-zinc-300 leading-relaxed mb-4">
                  Except for the public leaderboard (see below), your data is fully anonymized before we use it for:
                </p>
                <ul className="list-disc list-inside text-zinc-300 space-y-1 ml-4">
                  <li>Internal research</li>
                  <li>Improving our tools</li>
                  <li>Training our internal AI models</li>
                  <li>Making the RYTM AI Coach smarter</li>
                </ul>
                <p className="text-zinc-300 leading-relaxed mt-4 mb-2">
                  "Anonymized" means:
                </p>
                <ul className="list-disc list-inside text-zinc-300 space-y-1 ml-4">
                  <li>Your name is removed</li>
                  <li>Any personal identifiers are removed (eg. email, phone number, location)</li>
                  <li>The data cannot be traced back to you</li>
                </ul>
                <p className="text-zinc-300 leading-relaxed mt-4">
                  We do this so we can improve RYTM and your experience while still protecting your privacy.
                </p>
              </div>

              <div>
                <h3 className="text-xl font-semibold mb-2 text-white">C) Public Leaderboards (your choice)</h3>
                <p className="text-zinc-300 leading-relaxed mb-4">
                  This is the only place your real name may appear.
                </p>
                <p className="text-zinc-300 leading-relaxed mb-2">
                  If you opt in to the leaderboard:
                </p>
                <ul className="list-disc list-inside text-zinc-300 space-y-1 ml-4">
                  <li>Your name + selected performance stats may be visible to others</li>
                  <li>You're choosing to compete and be part of the public rankings</li>
                </ul>
                <p className="text-zinc-300 leading-relaxed mt-4 mb-2">
                  If you opt out:
                </p>
                <ul className="list-disc list-inside text-zinc-300 space-y-1 ml-4">
                  <li>You won't appear anywhere publicly</li>
                  <li>Your data stays anonymized for internal use only</li>
                </ul>
                {/* <p className="text-zinc-300 leading-relaxed mt-4">
                  You can change this anytime in settings.
                </p> */}
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">Sharing your data</h2>
            <p className="text-zinc-300 leading-relaxed mb-4">
              <strong>Your data is never shared or exposed to the public. We may use anonymized data internally for research, product improvement, and to generate your insights through our AI systems, with your identity fully stripped out.</strong>
            </p>
            
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">Your control</h2>
            <p className="text-zinc-300 leading-relaxed mb-4">
              You are in charge of your data. You can:
            </p>
            <ul className="list-disc list-inside text-zinc-300 space-y-1 ml-4">
              <li>View your data anytime</li>
              <li>Correct or update your information</li>
              <li>Delete your account and your personal data</li>
              <li>Disconnect Fitbit/WHOOP whenever you want</li>
              <li>Opt in or out of leaderboards</li>
            </ul>
            <p className="text-zinc-300 leading-relaxed mt-4">
              To request deletion or access, or for any further clarifications, just email:{" "}
              <a href="mailto: yms8589@nyu.edu" className="text-purple-400 hover:text-purple-300">
                yms8589@nyu.edu
              </a>
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">What happens if you delete your account?</h2>
            <ul className="list-disc list-inside text-zinc-300 space-y-2 ml-4">
              <li>Your personal, identifiable data is removed from active systems.</li>
              <li>Completely anonymized data may remain for research and model improvement, but it will never be linked to you.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">Security</h2>
            <p className="text-zinc-300 leading-relaxed">
              We use state of the art security practices like HTTPS and secure, cloud-based managed databases to protect your data. 
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">Questions?</h2>
            <p className="text-zinc-300 leading-relaxed mb-4">
              If anything here is unclear, or you want to know more, reach out to us at:
            </p>
            <div className="text-zinc-300 space-y-2 ml-4">
              <p>📧 <a href="mailto:yms8589@nyu.edu" className="text-purple-400 hover:text-purple-300">yms8589@nyu.edu</a></p>
              <p>🌐 <a href="https://rytm.pro" className="text-purple-400 hover:text-purple-300">https://rytm.pro</a></p>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="mt-12 pt-8 border-t border-zinc-800 text-center">
          <p className="text-zinc-500 text-sm">
            © 2026 RYTM. • Privacy-first • Research study
          </p>
        </div>
      </div>
    </div>
  );
}
