# rytm

**Master your flow**

A modern web platform for human performance optimization and wellbeing data collection. Built for NYUAD Capstone.

## Tech Stack

- **Frontend framework**: Next.js 14+ (App Router) + TypeScript
- **Styling**: Tailwind CSS
- **Authentication + Database**: Supabase
- **AI layer**: OpenRouter API (LLM provider gateway)
- **Deployment**: Vercel

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- A Supabase account and project
- OpenRouter API key (for AI features)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/youssof1/rytm.git
cd rytm/rytm
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
   - Copy `.env.example` to `.env.local`
   - Fill in your Supabase project URL and anon key
   - Add your OpenRouter API key

4. Run the development server:
```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000) in your browser

src/

## Project Structure (2025)

```
src/
├── app/
│   ├── (auth)/              # Authentication routes (sign-in, sign-up, callback)
│   ├── api/
│   │   └── journal/         # Journal API endpoints (LLM, new thread)
│   ├── consent/             # Consent form and signing
│   ├── dashboard/           # Main dashboard UI
│   ├── layout.tsx           # Root layout
│   ├── page.tsx             # Landing page
│   └── globals.css          # Global styles
├── components/
│   ├── dashboard/           # Dashboard widgets (JournalChat, LogMealModal, etc)
│   └── ui/                  # Reusable UI components (Button, Input, Card, Field)
├── lib/
│   ├── db/                  # Database logic (journal, dashboard)
│   ├── llms/                # LLM config and system prompt
│   ├── supabase/            # Supabase client utilities
│   └── utils.ts             # Utility functions
├── types/                   # TypeScript types
supabase/
├── journal_schema.sql       # Full journal DB schema (threads, messages, RLS)
├── ...other SQL files       # Table and RLS setup
public/                      # Static assets
```

## LLM (AI Journal) Flow

- **Free mode:**
    - User messages are saved directly to `journal_messages` (mode = 'free'), no AI call
    - No thread, just daily log
- **Guided mode:**
    - Each day (or on "New Entry") creates a new `journal_thread`
    - User and AI messages are saved to `journal_messages` (mode = 'guided', thread_id)
    - On each user message, the last 3 user+AI message pairs (6 messages) are sent to the LLM
    - LLM is called via OpenRouter (see `src/lib/llms/config.ts`)
    - System prompt is editable in `JOURNAL_SYSTEM_PROMPT`
    - LLM response is saved to DB and shown in UI

**API:**
- `POST /api/journal` — Handles both free and guided journal messages
- `POST /api/journal/new-thread` — Closes current thread and creates a new one

**LLM Provider:**
- OpenRouter (proxy for OpenAI, Anthropic, etc)
- Model: `openai/gpt-4o-mini` (configurable)
- API key in `.env.local` as `OPENROUTER_API_KEY` (and `OPENAI_API_KEY` for compatibility)

## Database Schema (Journal)

- `journal_threads`: id, user_id, title, status, created_at, updated_at, last_message_at
- `journal_messages`: id, user_id, thread_id (nullable), mode ('free'|'guided'), role ('user'|'assistant'), content, created_at
- RLS policies: Only owner can read/write their threads/messages
- Triggers: Auto-update thread timestamps on new message
- Helper function: `get_or_create_active_thread(user_id)`

## Current Status

✅ Full dashboard with logging, check-ins, streaks, and journal
✅ Image upload for meals (Supabase Storage)
✅ Water and meal logging with custom UI
✅ Consent flow and signature required for account
✅ AI-guided and free-form journaling (LangChain.js + OpenRouter)
✅ Secure authentication and RLS everywhere
⏳ Analytics, calendar, and leaderboard (coming soon)

## Current Status

✅ Landing page with authentication CTAs  
✅ Authentication page placeholders  
✅ Supabase integration setup  
⏳ Dashboard and data collection features (coming soon)

## License

Private research project for NYUAD Capstone.


