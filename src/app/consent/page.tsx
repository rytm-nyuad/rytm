"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/Button";

export default function ConsentPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  const supabase = createClient();

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    // Use server endpoint to read HTTP-only cookies
    const resp = await fetch('/api/auth/session');
    const json = await resp.json();
    const session = json?.session;

    if (!session) {
      // Not logged in, redirect to sign-in
      router.push('/sign-in');
      return;
    }

    // Check if user has already signed consent
    const { data: existingSignature } = await supabase
      .from('consent_signatures')
      .select('id')
      .eq('user_id', session.user.id)
      .single();

    if (existingSignature) {
      // Already signed, redirect to dashboard
      router.push('/dashboard');
      return;
    }

    setLoading(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-white">Loading...</div>
      </div>
    );
  }

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
          <h1 className="text-4xl font-bold mb-2">Research Participant Consent Form</h1>
          <p className="text-zinc-400 mb-6">(Online Consent Version — Research Study)</p>
          
          <div className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">Study Title</h2>
            <p className="text-zinc-300">Wearable Data, Nutrition, and Daily Reflection Study (January–May)</p>
          </div>

          <div className="mb-4 text-zinc-400 text-sm">
            <p className="mb-1"><strong>Investigators:</strong> Ameena Zewail • Mariam Hafez • Renata Espinosa Gonzalez • Youssof Saleh</p>
            {/* <p className="mb-1"><strong>Faculty Advisors:</strong> Muhammad Shafique • Farah Shamout • Muhammad Abdullah Hanif</p> */}
            <p><strong>Institution:</strong> New York University Abu Dhabi</p>
          </div>
        </div>

        {/* Content */}
        <div className="prose prose-invert prose-zinc max-w-none space-y-8">
          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">1. Introduction & Purpose of the Study</h2>
            <p className="text-zinc-300 leading-relaxed mb-4">
              You are invited to participate in a research study conducted at New York University Abu Dhabi. Please read this form carefully. It explains what participation involves, what data will be collected, how it will be used, and what choices you have.
            </p>
            <p className="text-zinc-300 leading-relaxed mb-4">
              This study aims to collect and analyze wearable physiological signals, activity and sleep data, nutrition logs, and daily reflection inputs (journals and short conversations/check-ins). The goal is to explore relationships between physical signals, daily behaviors, and self-reported mental and overall well-being, and to evaluate how multimodal data can be combined to generate personalized insights that may inform future wellness and performance technologies.
            </p>
            <p className="text-zinc-300 leading-relaxed">
              This study is conducted for research purposes only. It is not a medical service, and it does not provide medical diagnosis, treatment, or clinical advice.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">2. What Data Will Be Collected</h2>
            <p className="text-zinc-300 leading-relaxed mb-4">
              If you participate, the study may collect the following categories of data:
            </p>
            
            <div className="space-y-6">
              <div>
                <h3 className="text-xl font-semibold mb-2 text-white">A) Wearable Device Data (Fitbit Charge 6)</h3>
                <p className="text-zinc-300 mb-2">Collected via the device and/or Fitbit app, including but not limited to:</p>
                <ul className="list-disc list-inside text-zinc-300 space-y-1 ml-4">
                  <li>Heart rate (resting and continuous)</li>
                  <li>Heart rate variability (if available)</li>
                  <li>Step count and activity intensity</li>
                  <li>Sleep duration and sleep stages/quality indicators</li>
                  <li>Estimated calorie expenditure and active minutes</li>
                  <li>Other standard wellness metrics produced by the device</li>
                </ul>
              </div>

              <div>
                <h3 className="text-xl font-semibold mb-2 text-white">B) Nutrition Data (Daily Food Logging)</h3>
                <p className="text-zinc-300 mb-2">Collected via a daily form, including:</p>
                <ul className="list-disc list-inside text-zinc-300 space-y-1 ml-4">
                  <li>Written descriptions of meals/snacks/drinks</li>
                  <li>Optional food photos (if you choose to upload them)</li>
                  <li>Meal timing and meal type (if requested)</li>
                </ul>
              </div>

              <div>
                <h3 className="text-xl font-semibold mb-2 text-white">C) Daily Self-Report Form Data (Mood / Overall State)</h3>
                <p className="text-zinc-300 mb-2">Collected via short daily check-ins, potentially including:</p>
                <ul className="list-disc list-inside text-zinc-300 space-y-1 ml-4">
                  <li>Overall well-being rating (physical + mental + emotional + spiritual, as you interpret it)</li>
                  <li>Stress, fatigue, soreness, motivation, or similar subjective measures</li>
                  <li>Optional short text explanation (if enabled)</li>
                </ul>
              </div>

              <div>
                <h3 className="text-xl font-semibold mb-2 text-white">D) Journals & Written Reflections</h3>
                <p className="text-zinc-300 mb-2">If included in the study workflow, you may be asked to submit:</p>
                <ul className="list-disc list-inside text-zinc-300 space-y-1 ml-4">
                  <li>Short daily or periodic journal entries</li>
                  <li>Reflections about your day, habits, mindset, or general experiences</li>
                  <li>Optional notes about training, study, sleep, or context</li>
                </ul>
              </div>

              <div>
                <h3 className="text-xl font-semibold mb-2 text-white">E) Conversations / Chat-Based Check-ins</h3>
                <p className="text-zinc-300 mb-2">If included in the workflow, you may interact through:</p>
                <ul className="list-disc list-inside text-zinc-300 space-y-1 ml-4">
                  <li>Short guided chat prompts (e.g., "How are you feeling today?")</li>
                  <li>Conversation-style check-ins intended to capture context and subjective state</li>
                  <li>Messages you write in response to prompts (not private messaging with others)</li>
                </ul>
                <p className="text-zinc-300 mt-2">
                  <strong>Important:</strong> You should avoid entering highly sensitive personal information in journals or chats (e.g., medical diagnoses, legal issues, or extremely private details). If you choose to share such information, it may still become part of the research dataset.
                </p>
              </div>

              <div>
                <h3 className="text-xl font-semibold mb-2 text-white">F) Basic Participant Information (Setup + Study Context)</h3>
                <p className="text-zinc-300 mb-2">To interpret the data, we may collect:</p>
                <ul className="list-disc list-inside text-zinc-300 space-y-1 ml-4">
                  <li>Height, weight, age, sex (and other non-sensitive profile fields if needed)</li>
                </ul>
              </div>
            </div>
            <p className="text-zinc-300 leading-relaxed mt-4">
              The above requirements are mandatory. Consistent compliance is expected for the integrity of the study. Participants who fail to meet these obligations (e.g., irregular device usage, missing food logs) will be withdrawn from the study, and the smartwatch will be collected by the research team.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">3. What You Will Be Asked To Do (Participant Responsibilities)</h2>
            <p className="text-zinc-300 leading-relaxed mb-4">
              By agreeing to participate, you acknowledge the study expectations below:
            </p>
            <ul className="list-disc list-inside text-zinc-300 space-y-2 ml-4">
              <li>Wear the Fitbit Charge 6 daily, including during sleep, except when charging or if wearing it causes discomfort/irritation.</li>
              <li>Allow collection of wearable data as described above.</li>
              <li>Complete a daily nutrition log, documenting meals/snacks/drinks (written, photo, or both).</li>
              <li>Complete daily check-ins (e.g., mood/overall state) as requested.</li>
              <li>Submit journal entries and/or chat-style reflections if they are part of the protocol.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">4. Study Duration (January–May)</h2>
            <p className="text-zinc-300 leading-relaxed">
              The study will run from January through May (academic semester period). During this time, you are expected to participate consistently.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">5. How Your Data Will Be Used</h2>
            <p className="text-zinc-300 leading-relaxed mb-4">
              The research team will use your data to:
            </p>
            <ul className="list-disc list-inside text-zinc-300 space-y-2 ml-4">
              <li>Analyze patterns and relationships across wearable signals, nutrition, flexibility, and self-reported state</li>
              <li>Explore personalized modeling of behaviors and context (e.g., how stress or sleep relates to nutrition choices)</li>
              <li>Develop research prototypes, summaries, and insights for academic evaluation</li>
            </ul>
            <p className="text-zinc-300 leading-relaxed mt-4 mb-2">
              Results may be presented in:
            </p>
            <ul className="list-disc list-inside text-zinc-300 space-y-1 ml-4 mb-4">
              <li>Capstone reports and presentations</li>
              <li>Academic posters, demonstrations, or papers (if applicable)</li>
            </ul>
            <p className="text-zinc-300 leading-relaxed">
              When results are shared, they will be presented in aggregate or using de-identified examples whenever possible.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">6. Data Handling, Privacy & Confidentiality</h2>
            
            <div className="space-y-4">
              <div>
                <h3 className="text-xl font-semibold mb-2 text-white">A) Storage and Access</h3>
                <ul className="list-disc list-inside text-zinc-300 space-y-1 ml-4">
                  <li>Data will be stored securely in research systems (e.g., protected databases such as SQL-based storage and associated research pipelines).</li>
                  <li>Access to identifiable data will be restricted to the research team and faculty advisors as needed.</li>
                </ul>
              </div>

              <div>
                <h3 className="text-xl font-semibold mb-2 text-white">B) Identifiers and De-Identification</h3>
                <ul className="list-disc list-inside text-zinc-300 space-y-1 ml-4">
                  <li>Your data will be associated with a participant ID wherever possible.</li>
                  <li>Identifying information (name, email) will be stored separately from research data when feasible.</li>
                </ul>
              </div>

              <div>
                <h3 className="text-xl font-semibold mb-2 text-white">C) Sharing & External Access</h3>
                <ul className="list-disc list-inside text-zinc-300 space-y-1 ml-4">
                  <li>Your personal identifiable information will not be shared publicly.</li>
                  <li>The research team will not sell your data.</li>
                  <li>Data will not be used for advertising.</li>
                </ul>
              </div>

              <div>
                <h3 className="text-xl font-semibold mb-2 text-white">D) Limits of Confidentiality</h3>
                <p className="text-zinc-300 leading-relaxed">
                  While reasonable safeguards will be used, no system can guarantee absolute security. There is a small risk of unauthorized access. The team will take steps to minimize this risk.
                </p>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">7. Risks and Discomforts</h2>
            <p className="text-zinc-300 leading-relaxed mb-4">
              Potential risks/discomforts include:
            </p>
            <ul className="list-disc list-inside text-zinc-300 space-y-1 ml-4">
              <li>Mild skin irritation from wearing the Fitbit</li>
              <li>Minor inconvenience or fatigue due to daily logging</li>
              <li>Discomfort from reflecting on mood or personal experiences in journals/chats</li>
            </ul>
            <p className="text-zinc-300 leading-relaxed mt-4">
              You may skip optional questions or withdraw at any time.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">8. Benefits</h2>
            <p className="text-zinc-300 leading-relaxed mb-4">
              There is no guaranteed direct benefit, but you may receive:
            </p>
            <ul className="list-disc list-inside text-zinc-300 space-y-1 ml-4">
              <li>Personalized summaries/feedback on sleep, activity, nutrition patterns, and general routines</li>
              <li>Increased self-awareness about habits and well-being</li>
              <li>Your participation contributes to research that may support future wellness technologies.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">9. Voluntary Participation & Withdrawal</h2>
            <ul className="list-disc list-inside text-zinc-300 space-y-2 ml-4">
              <li>Participation is voluntary.</li>
              <li>You may withdraw at any time without penalty.</li>
            </ul>
            <p className="text-zinc-300 leading-relaxed mt-4 mb-2">
              If you withdraw or are removed due to repeated non-compliance:
            </p>
            <ul className="list-disc list-inside text-zinc-300 space-y-1 ml-4">
              <li>Data collection will stop</li>
              <li>The device will be returned to the research team</li>
              <li>Data already collected up to the point of withdrawal may still be used in a de-identified form for analysis, unless the study later adopts a different policy.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">10. Questions / Contact Information</h2>
            <p className="text-zinc-300 leading-relaxed mb-4">
              For questions or concerns regarding this study, please contact:
            </p>
            <div className="text-zinc-300 space-y-2 ml-4">
              <p>Ameena Zewail — <a href="mailto:aa9656@nyu.edu" className="text-purple-400 hover:text-purple-300">aa9656@nyu.edu</a></p>
              <p>Mariam Hafez — <a href="mailto:mah9994@nyu.edu" className="text-purple-400 hover:text-purple-300">mah9994@nyu.edu</a></p>
              <p>Renata Espinosa Gonzalez — <a href="mailto:re2230@nyu.edu" className="text-purple-400 hover:text-purple-300">re2230@nyu.edu</a></p>
              <p>Youssof Saleh — <a href="mailto:yms8589@nyu.edu" className="text-purple-400 hover:text-purple-300">yms8589@nyu.edu</a></p>
              
              <p className="mt-4"><strong>Faculty Advisors:</strong></p>
              {/* <p>Muhammad Shafique — <a href="mailto:ms12713@nyu.edu" className="text-purple-400 hover:text-purple-300">ms12713@nyu.edu</a></p>
              <p>Farah Shamout — <a href="mailto:fs999@nyu.edu" className="text-purple-400 hover:text-purple-300">fs999@nyu.edu</a></p>
              <p>Muhammad Abdullah Hanif — <a href="mailto:mh6117@nyu.edu" className="text-purple-400 hover:text-purple-300">mh6117@nyu.edu</a></p> */}
            </div>
          </section>
        </div>

        {/* Proceed Button */}
        <div className="mt-12 flex justify-center">
          <Button
            onClick={() => router.push("/consent/sign")}
            className="bg-purple-600 hover:bg-purple-700 text-white px-8 py-3 text-lg"
          >
            I Understand — Proceed to Sign Consent
          </Button>
        </div>
      </div>
    </div>
  );
}
