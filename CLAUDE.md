# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

RYTM is a wellness tracking platform built for NYUAD Capstone. Users log meals (with photo AI analysis), hydration, mood check-ins, and journal entries. It integrates with Fitbit and WHOOP wearables and includes an AI-guided journaling system.

## Commands

```bash
npm run dev          # Start dev server on localhost:3000
npm run build        # Production build
npm run lint         # ESLint via Next.js
npm test             # Jest tests (--runInBand)

# Scripts (run via tsx)
npm run meal:nightly      # Nightly meal AI processing
npm run meal:backfill     # Backfill historical meal data
npm run meal:test         # Test single meal processing
npm run meal:check-env    # Verify environment setup
npm run daily-streak-report
```

## Tech Stack

- **Framework**: Next.js 14 (App Router) with TypeScript (strict mode)
- **Database + Auth**: Supabase (PostgreSQL with RLS)
- **AI**: OpenRouter (gateway to LLMs, default `openai/gpt-4o-mini`) via LangChain.js; OpenAI Vision API for meal photo analysis
- **Styling**: Tailwind CSS with dark mode support
- **Deployment**: GitHub Actions → DigitalOcean via Docker (`Dockerfile.prod` + `docker-compose.prod.yml`)

## Architecture

### Data Flow Pattern

All database writes go through **Supabase RPC functions** (defined in `supabase/function_rpcs.sql`) rather than direct table inserts. This ensures timezone-aware backlogging — entries before 4am local time count for the previous day.

### Supabase Client Hierarchy

- `src/lib/supabase/browser.ts` — Client components
- `src/lib/supabase/server.ts` — Server components & API routes (cookie-managed)
- `src/lib/supabase/admin.ts` — Service-role client for scripts/admin operations
- `src/lib/supabase/public.ts` — Anon/public client

### AI Journal System (`src/llm-service/`)

Two modes:
- **Free mode**: Messages saved directly, no LLM call
- **Guided mode**: LangChain agent loads last 6 messages as context, calls LLM via OpenRouter, returns response. Agent is stateless — all state lives in the DB.

Entry points: `POST /api/journal` and `POST /api/journal/new-thread`.

### Meal Processing (`src/lib/meal-processing/`)

OpenAI Vision API analyzes meal photos for nutritional estimates. Runs nightly via GitHub Actions cron (`nightly-meal-processing.yml`) or on-demand via API.

### Access Control

- Supabase Auth (email/password) with session cookies
- `middleware.ts` enforces an email allowlist (`src/lib/allowlist.ts`) — unauthorized users redirect to `/coming-soon`
- All tables use RLS policies scoping data to the owning user

### Timezone Handling

Canonical timezone resolution order: Fitbit profile → user profiles table → browser fallback → UTC. The `src/lib/time.ts` module manages this with a 1-minute per-user cache.

### Database Schema

SQL schemas live in `supabase/` (not managed by migrations — applied manually). Key tables: `journal_threads`, `journal_messages`, `daily_overall`, `meal_logs`, `water_intake_logs`, `daily_checkins`, `daily_summary`, `daily_todos`, `pulses`, `fitbit_*`, `whoop_*`.

### CI/CD Workflows (`.github/workflows/`)

- `deploy.yml` — CD on push to `main` (SSH → Docker build on DigitalOcean)
- Scheduled crons: nightly meal processing, daily streak reports, Fitbit batch sync, leaderboard sync, daily summary prep

## Path Aliases

`@/*` maps to `./src/*` (configured in `tsconfig.json`).
