Daily streak report — setup & scheduling

Overview

This script runs once per day and sends a report with:
- users who missed submitting `daily_overall` for two consecutive local days
- users who submitted `daily_overall` after the configured cutoff time for two consecutive days
- users who failed a streak for 2 days in a row (two consecutive `daily_summary.is_complete = false`) and which checklist items they missed (meal, water, journal, checkin, overall)

Configuration (.env)

Create a `.env` in the project root (or use your secrets manager) with the following keys:

- SUPABASE_URL: Supabase project URL (or NEXT_PUBLIC_SUPABASE_URL)
- SUPABASE_SERVICE_ROLE_KEY: Supabase service role key (required to read server-side data)
- REPORT_TO_EMAIL: Recipient email address for the report
- REPORT_FROM_EMAIL: Optional; email address used as From (defaults to SMTP_USER)
- SMTP_HOST: SMTP server host
- SMTP_PORT: SMTP server port (e.g. 587)
- SMTP_USER: SMTP username
- SMTP_PASS: SMTP password
- SMTP_SECURE: 'true' if using TLS/SMTPS, otherwise 'false'
- REPORT_TIMEZONE: Optional default timezone (e.g. 'UTC') used when `profiles.timezone` missing. Defaults to 'UTC'.
- REPORT_CUTOFF_HOUR: Hour for cutoff (24h) — default 14
- REPORT_CUTOFF_MIN: Minute for cutoff — default 30

Scheduling options

You asked for the report to run automatically at 04:00 UAE time (Asia/Dubai). UAE is UTC+4, so that is 00:00 UTC. Below are three scheduling approaches — pick the one that fits your deployment.

1) Server cron on your DigitalOcean droplet (recommended if you manage the droplet)

- Save `.env` to `/home/nyuad/rytm/.env` on the droplet (permissions restricted).
- Add a cron entry that sets the timezone and runs the script at 04:00 Asia/Dubai every day.

Example crontab (edit with `crontab -e`):

```cron
# run daily at 04:00 Asia/Dubai
TZ=Asia/Dubai
0 4 * * * cd /home/nyuad/rytm && /usr/bin/env bash -lc 'export $(cat .env | xargs) && node scripts/daily_streak_report.js >> /home/nyuad/rytm/logs/daily_streak_report.log 2>&1'
```

Notes:
- Using `TZ=Asia/Dubai` ensures cron runs in UAE local time.
- Make sure `logs/` exists and is writable, or change the redirection path.

2) Docker Compose + system cron

Because running cron inside containers is fragile, a simple pattern is to run the script in a short-lived container and call it from the droplet's system cron. Add this service to your `docker-compose.yml` (or `docker-compose.override.yml`):

```yaml
services:
  daily-report:
    image: node:18-alpine
    working_dir: /app
    volumes:
      - ./:/app
    environment:
      - SUPABASE_URL
      - SUPABASE_SERVICE_ROLE_KEY
      - REPORT_TO_EMAIL
      - REPORT_FROM_EMAIL
      - SMTP_HOST
      - SMTP_PORT
      - SMTP_USER
      - SMTP_PASS
      - SMTP_SECURE
      - REPORT_TIMEZONE
      - REPORT_CUTOFF_HOUR
      - REPORT_CUTOFF_MIN
    entrypoint: ["/bin/sh", "-c", "node scripts/daily_streak_report.js"]
    # note: this service doesn't run continuously; cron will `docker compose run --rm daily-report`
```

Then schedule a system cron on the droplet (same as above) that runs:

```bash
cd /home/nyuad/rytm && /usr/bin/env bash -lc 'export $(cat .env | xargs) && docker compose run --rm daily-report >> /home/nyuad/rytm/logs/daily_streak_report.log 2>&1'
```

3) GitHub Actions scheduled workflow (CI-managed, no server cron required)

If you prefer running this via GitHub Actions (it runs in UTC), schedule the workflow at `0 0 * * *` (midnight UTC = 04:00 Asia/Dubai).

Create `.github/workflows/daily-streak-report.yml` with:

```yaml
name: Daily streak report
on:
  schedule:
    - cron: '0 0 * * *' # 00:00 UTC => 04:00 UAE (Asia/Dubai)
  workflow_dispatch: {}

jobs:
  run-report:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version: '18'

      - name: Install deps
        run: npm ci

      - name: Run report
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          REPORT_TO_EMAIL: ${{ secrets.REPORT_TO_EMAIL }}
          REPORT_FROM_EMAIL: ${{ secrets.REPORT_FROM_EMAIL }}
          SMTP_HOST: ${{ secrets.SMTP_HOST }}
          SMTP_PORT: ${{ secrets.SMTP_PORT }}
          SMTP_USER: ${{ secrets.SMTP_USER }}
          SMTP_PASS: ${{ secrets.SMTP_PASS }}
          SMTP_SECURE: ${{ secrets.SMTP_SECURE }}
          REPORT_TIMEZONE: 'UTC'
          REPORT_CUTOFF_HOUR: ${{ secrets.REPORT_CUTOFF_HOUR }}
          REPORT_CUTOFF_MIN: ${{ secrets.REPORT_CUTOFF_MIN }}
        run: node scripts/daily_streak_report.js
```

GitHub Secrets to add

Add the following repository secrets (Settings → Secrets → Actions):
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- REPORT_TO_EMAIL
- REPORT_FROM_EMAIL (optional)
- SMTP_HOST
- SMTP_PORT
- SMTP_USER
- SMTP_PASS
- SMTP_SECURE (true/false)
- REPORT_CUTOFF_HOUR (optional, default 14)
- REPORT_CUTOFF_MIN (optional, default 30)

DigitalOcean / Continuous Deployment notes

- If you deploy from GitHub Actions to your droplet, keep the report runner separated from your web service.
- Recommended approaches:
  - Use Droplet system cron (easy) and keep `.env` on the droplet with limited permissions.
  - Or run via GitHub Actions (no server changes) and add secrets to the GitHub repository.

Security notes

- `SUPABASE_SERVICE_ROLE_KEY` is powerful — keep it in secrets and don't expose it in client-side code.
- Limit who can access the report mailbox and protect `.env` on the droplet (use file permissions `600`).

If you'd like I can:
- Add the GitHub Actions workflow file to this repo.
- Add a small `docker-compose` file and a suggested `crontab` entry in the repo.
- Switch the script output to HTML email for easier reading.

Tell me which of the above you'd like me to add to the repository now (workflow, docker-compose snippet file, or crontab sample).