# rytm

**Master your flow**

A modern web platform for human performance optimization and wellbeing data collection.

## Visual Overview

The screenshots below, together with the a one pager diagram, provide a structured overview of RYTM’s concept, user experience, and core functionality.

### Dashboard

The main home screen: daily streak, weekly progress, and the RYTM Coach entry point.



### AI Insights

Personalized morning briefs that synthesize sleep, nutrition, mood, and wearable data into narrative insights and actionable next steps.



### Capstone Poster

Project overview — architecture, features, and research context from the NYUAD Capstone presentation.



## Tech Stack

- **Frontend framework**: Next.js 14+ App Router + TypeScript
- **Styling**: Tailwind CSS
- **Authentication + Database**: Supabase
- **AI layer**: OpenRouter API and OpenAI API
- **Python pipeline**: Coach pipeline under `python/coach`
- **Deployment**: Vercel / Node.js-compatible hosting

---



## Getting Started



### Prerequisites

Before setting up the project, make sure you have:

- Node.js 18+ and npm
- Python 3.10+ recommended
- Git
- Access to the private GitHub repository
- A Supabase account and project
- An OpenRouter API key
- An OpenAI API key, if using OpenAI-backed features

---



## 1. Clone the Repository

This repository is private, so your GitHub account must have access to the `rytm-nyuad` organization/repository.

GitHub no longer supports password authentication for Git operations over HTTPS. Use one of the following authentication methods.

### Option A: Clone using GitHub CLI

First authenticate:

```bash
gh auth login
```

Follow the prompts, then check that authentication worked:

```bash
gh auth status
```

Then clone the repository:

```bash
git clone https://github.com/rytm-nyuad/rytm.git
cd rytm
```



### Option B: Clone using SSH

If you have SSH set up with GitHub:

```bash
git clone git@github.com:rytm-nyuad/rytm.git
cd rytm
```



### Option C: Clone using HTTPS with a Personal Access Token

```bash
git clone https://github.com/rytm-nyuad/rytm.git
cd rytm
```

When prompted for your password, paste a GitHub Personal Access Token instead of your GitHub password.

---



## 2. Install Node Dependencies

From the project root:

```bash
npm install
```

You may see npm warnings about deprecated packages or vulnerabilities from transitive dependencies. These warnings do not necessarily prevent the app from running.

To inspect the issues:

```bash
npm audit
```

---



## 3. Set Up Environment Variables

Copy the example environment file:

```bash
cp .env.example .env.local
```

Then open `.env.local` and fill in the required values.

At minimum, the app may require values such as:

```env
NEXT_PUBLIC_SUPABASE_URL=https://<your-supabase-project-url>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-supabase-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<your-supabase-service-role-key>

OPENROUTER_API_KEY=<your-openrouter-api-key>
OPENAI_API_KEY=<your-openai-api-key>
```

---



## 4. Set Up the Python Coach Pipeline

The project includes a Python-based coach pipeline under `python/coach`.

From the project root:

```bash
cd python/coach
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Then return to the project root before running the Next.js app:

```bash
cd ../..
```

If you are on Windows, activate the virtual environment with:

```bash
.venv\Scripts\activate
```

---



## 5. Run the Development Server

From the project root:

```bash
npm run dev
```

Then open:

```text
http://localhost:3000
```

---



## Project Structure

```text
src/
├── app/
│   ├── (auth)/              # Authentication routes
│   ├── api/                 # API routes
│   ├── consent/             # Consent flow and signature page
│   ├── dashboard/           # Main dashboard UI
│   ├── layout.tsx           # Root layout
│   ├── page.tsx             # Landing page
│   └── globals.css          # Global styles
├── components/
│   ├── dashboard/           # Dashboard widgets and modals
│   └── ui/                  # Reusable UI components
├── lib/
│   ├── db/                  # Database logic
│   ├── llms/                # LLM configuration and prompts
│   ├── supabase/            # Supabase client utilities
│   └── utils.ts             # Utility functions
├── types/                   # TypeScript types

python/
└── coach/                   # Python coach pipeline

supabase/                    # All database schemas and migrations (applied manually)
├── function_rpcs.sql        # RPC functions for timezone-aware writes
├── journal_schema.sql       # Journal tables
├── meal_processing_schema.sql
└── ...                      # Other schema, RLS, and migration SQL files

public/                      # Static assets
```

---



## Main Features

- Landing page with authentication calls to action
- Supabase authentication
- Consent flow with signature requirement
- Dashboard for wellbeing and performance data collection
- Daily check-ins and logging flows
- Meal and water logging
- Image upload support for meal logs using Supabase Storage
- AI-guided and free-form journaling
- Python coach pipeline for personalized recommendations
- Secure database access patterns using Supabase and RLS

---



## License

Private research project for NYUAD Capstone.

```

```

