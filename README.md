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

## Project Structure

```
src/
├── app/
│   ├── (auth)/          # Authentication routes
│   │   ├── sign-in/
│   │   └── sign-up/
│   ├── layout.tsx       # Root layout
│   ├── page.tsx         # Landing page
│   └── globals.css      # Global styles
├── components/
│   └── ui/              # Reusable UI components
│       └── Button.tsx
└── lib/
    ├── supabase/        # Supabase client utilities
    │   ├── browser.ts   # Client-side Supabase client
    │   └── server.ts    # Server-side Supabase client
    └── utils.ts         # Utility functions
```

## Current Status

✅ Landing page with authentication CTAs  
✅ Authentication page placeholders  
✅ Supabase integration setup  
⏳ Dashboard and data collection features (coming soon)

## License

Private research project for NYUAD Capstone.


