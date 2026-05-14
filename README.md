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
   - Add any other required keys such as `SUPABASE_SERVICE_ROLE_KEY` and `OPENAI_API_KEY` all can be found in .env.example

Example `.env.local`:
```env
NEXT_PUBLIC_SUPABASE_URL=https://<your-supabase-url>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
OPENROUTER_API_KEY=<your-openrouter-api-key>
OPENAI_API_KEY=<your-openai-api-key>
```

4. Set up the Python virtual environment for the coach pipeline:
```bash
cd python/coach
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

5. Run the development server:
```bash
npm run dev
```

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

## Current Status

✅ Full dashboard with logging, check-ins, streaks, and journal
✅ Image upload for meals (Supabase Storage)
✅ Water and meal logging with custom UI
✅ Consent flow and signature required for account
✅ AI-guided and free-form journaling (LangChain.js + OpenRouter)
✅ Secure authentication and RLS everywhere
✅ Landing page with authentication CTAs  
✅ Authentication page placeholders  
✅ Supabase integration setup  
⏳ Dashboard and data collection features (coming soon)
⏳ Analytics, calendar (coming soon)

## License

Private research project for NYUAD Capstone.


