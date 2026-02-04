"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/Button";
import { Field, FieldLabel } from "@/components/ui/field";
import Link from "next/link";

export default function ConsentSignPage() {
	const [email, setEmail] = useState("");
	const [userEmail, setUserEmail] = useState("");
	const [loading, setLoading] = useState(true);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const router = useRouter();

	const supabase = createClient();

	useEffect(() => {
		checkAuth();
	}, []);

	const checkAuth = async () => {
		// Use server endpoint to respect HTTP-only cookies
		const resp = await fetch('/api/auth/session');
		const json = await resp.json();
		const session = json?.session;

		if (!session) {
			router.push('/sign-in');
			return;
		}

		setUserEmail(session.user.email || '');

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

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError(null);

		// Verify email matches
		if (email.trim().toLowerCase() !== userEmail.toLowerCase()) {
			setError(
				"Email does not match your account email. Please enter your account email to confirm."
			);
			return;
		}

		setSubmitting(true);

		try {
			const resp = await fetch('/api/auth/session');
			const json = await resp.json();
			const session = json?.session;

			if (!session) {
				setError('Session expired. Please sign in again.');
				router.push('/sign-in');
				return;
			}

			// Insert consent signature
			const { error: insertError } = await supabase
				.from("consent_signatures")
				.insert({
					user_id: session.user.id,
					user_email: email.trim(),
					signed_at: new Date().toISOString(),
				});

			if (insertError) {
				throw insertError;
			}

			// Success - redirect to dashboard
			router.push("/dashboard");
		} catch (err: any) {
			setError(err.message || "Failed to save consent signature");
			setSubmitting(false);
		}
	};

	if (loading) {
		return (
			<div className="min-h-screen bg-black flex items-center justify-center">
				<div className="text-white">Loading...</div>
			</div>
		);
	}

	return (
		<div className="min-h-screen bg-black flex items-center justify-center p-6">
			<Card className="w-full max-w-2xl">
				<CardHeader className="text-center">
					<CardTitle>Sign Consent Form</CardTitle>
					<CardDescription>
						Please review the consent form and provide your signature to
						continue
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="mb-6">
						<div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 max-h-96 overflow-y-auto">
							<h3 className="font-semibold mb-2 text-white">
								Research Participant Consent Form
							</h3>
							<p className="text-sm text-zinc-400 mb-4">
								By signing below, you confirm that you have read and agree to
								the{" "}
								<Link
									href="/consent"
									target="_blank"
									className="text-purple-600 hover:text-purple-500 underline"
								>
									full consent form
								</Link>
								{" "}including:
							</p>
							<ul className="text-sm text-zinc-400 space-y-1 list-disc list-inside">
								<li>
									Data collection (wearables, nutrition, sessions, journals,
									check-ins)
								</li>
								<li>Study responsibilities and expectations</li>
								<li>Privacy and confidentiality measures</li>
								<li>Your right to withdraw at any time</li>
								<li>
									The study is for research purposes only (not medical care)
								</li>
							</ul>
						</div>
					</div>

					<form onSubmit={handleSubmit} className="space-y-6">
						{error && (
							<div className="bg-red-500/10 border border-red-500/50 rounded-lg p-3 text-red-500 text-sm">
								{error}
							</div>
						)}

						<Field>
							<FieldLabel htmlFor="email">
								Type your email to sign ({userEmail})
							</FieldLabel>
							<Input
								id="email"
								type="email"
								placeholder="your.email@example.com"
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								required
								disabled={submitting}
								autoComplete="email"
							/>
							<p className="text-xs text-zinc-500 mt-1">
								Your email serves as your electronic signature
							</p>
						</Field>

						<div className="flex gap-4">
							<Button
								type="button"
								variant="outline"
								onClick={() => router.push("/")}
								disabled={submitting}
								className="flex-1 border border-zinc-700 bg-zinc-900 text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
							>
								Cancel
							</Button>
							<Button
								type="submit"
								disabled={submitting || !email}
								className="flex-1"
							>
								{submitting ? "Signing..." : "I Agree and Sign"}
							</Button>
						</div>
					</form>
				</CardContent>
			</Card>
		</div>
	);
}
