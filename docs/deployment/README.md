# Deployment Guide - Rytm

## Overview

The deployment process is automated using GitHub Actions. When you push code to the `main` branch, it automatically builds a Docker image and deploys it to your DigitalOcean droplet.

```
Push to main → GitHub Actions → Build Docker image → SSH to droplet → Deploy
```

## Prerequisites

Before setting up, ensure you have:

1. **DigitalOcean Droplet** with Docker and Docker Compose installed
2. **GitHub Repository** at `https://github.com/youssof1/rytm`
3. **SSH Access** to your droplet (SSH key configured)
4. **Environment Variables** ready for production

## How It Works

### Step 1: GitHub Actions Workflow

The file `.github/workflows/deploy.yml` contains the deployment instructions.

**Workflow Trigger:**
- When you push to `main` branch, the workflow automatically runs
- Can also be manually triggered via `workflow_dispatch`

**What the workflow does:**
1. Checks out your code
2. Connects to your droplet via SSH
3. Pulls the latest code from git
4. Sets environment variables
5. Builds Docker image from `Dockerfile.prod`
6. Starts containers using `docker-compose.prod.yml`

### Step 2: Docker Build

When the workflow runs on your droplet:

```bash
docker compose -f docker-compose.prod.yml build app
```

This uses `Dockerfile.prod` which:
1. Installs Node.js dependencies
2. Builds the Next.js application
3. Creates an optimized production image with only production dependencies
4. Runs the app on port 3000

### Step 3: Docker Compose Deployment

```bash
docker compose -f docker-compose.prod.yml up -d --remove-orphans
```

This:
1. Pulls the latest image if available
2. Builds new image from Dockerfile
3. Starts the container with environment variables
4. Removes any old/orphaned containers
5. Runs in detached mode (background)

The `docker-compose.prod.yml` file defines:
- **Image**: Built from `Dockerfile.prod`
- **Ports**: Maps container port 3000 to host port 3000
- **Environment**: Passes all production variables
- **Restart**: Always restarts if it crashes
- **Health Check**: Checks if app is responsive every 30 seconds

## Setting Up GitHub Secrets

GitHub Secrets securely store sensitive information used during deployment.

**Add these secrets to your repository** (Settings → Secrets and variables → Actions):

### SSH Configuration
- `SSH_HOST` — Your droplet's IP address (e.g., `123.45.67.89`)
- `SSH_USER` — SSH username (usually `root`)
- `SSH_PORT` — SSH port (default `22`)
- `SSH_PRIVATE_KEY` — Your private SSH key (copy entire key content)

### Application Configuration
- `NEXT_PUBLIC_SUPABASE_URL` — Your Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase public API key
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service role key
- `OPENAI_API_KEY` — Your OpenAI/OpenRouter API key
- `NEXTAUTH_SECRET` — Secret for NextAuth authentication
- `NEXTAUTH_URL` — Your production domain (e.g., `https://your-domain.com`)

### Example SSH Key Setup

If you don't have an SSH key:

```bash
# Generate SSH key (on your local machine)
ssh-keygen -t rsa -b 4096 -f ~/.ssh/do_deploy

# Copy public key to droplet
ssh-copy-id -i ~/.ssh/do_deploy root@YOUR_DROPLET_IP

# Copy private key content to GitHub Secret (SSH_PRIVATE_KEY)
cat ~/.ssh/do_deploy | pbcopy  # macOS
# or on Linux:
cat ~/.ssh/do_deploy
# Then paste entire content into SSH_PRIVATE_KEY secret
```

## File Structure

```
.github/
  workflows/
    deploy.yml              # CD workflow that handles deployment

Dockerfile.prod             # Production Docker image definition
docker-compose.prod.yml     # Docker Compose configuration
.dockerignore              # Excludes unnecessary files from Docker build
.env.production            # Template for production environment variables
```

## Deployment Process Step-by-Step

### 1. Local Development

```bash
npm install
npm run dev  # Run locally on http://localhost:3000
```

### 2. Push to GitHub

```bash
git add .
git commit -m "Your changes"
git push origin main
```

### 3. GitHub Actions Triggers

- The workflow in `.github/workflows/deploy.yml` automatically runs
- GitHub builds and tests your code
- If successful, it connects to your droplet

### 4. On Your Droplet

The workflow executes these commands:

```bash
# Navigate to project directory
cd ~/rytm

# Pull latest code
git pull origin main

# Export environment variables from GitHub Secrets
export NEXT_PUBLIC_SUPABASE_URL='...'
export NEXT_PUBLIC_SUPABASE_ANON_KEY='...'
# ... (all other env vars)

# Build and deploy with Docker Compose
docker compose -f docker-compose.prod.yml pull app || true
docker compose -f docker-compose.prod.yml build app
docker compose -f docker-compose.prod.yml up -d --remove-orphans
```

### 5. Verify Deployment

```bash
# Check if container is running
docker ps

# View logs
docker compose -f docker-compose.prod.yml logs -f app

# Test the app
curl http://localhost:3000
```

## Environment Variables

Production environment variables are defined in `.env.production` and passed to the app via:

1. **GitHub Secrets** (stored securely)
2. **GitHub Actions** (exported during deployment)
3. **Docker** (passed to container via `docker-compose.prod.yml`)
4. **Next.js** (accessible in the app)

### Public vs Private Variables

- **Public** (prefixed with `NEXT_PUBLIC_`): Accessible in browser
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`

- **Private** (no prefix): Only accessible on server-side
  - `OPENAI_API_KEY`
  - `NEXTAUTH_SECRET`
  - `SUPABASE_SERVICE_ROLE_KEY`

## Monitoring Deployment

### View GitHub Actions

1. Go to your repository
2. Click **Actions** tab
3. Click the latest workflow run
4. Expand steps to see detailed logs

### SSH into Droplet

```bash
ssh -i ~/.ssh/do_deploy root@YOUR_DROPLET_IP
cd ~/rytm
```

### Check Container Status

```bash
# See running containers
docker ps

# View app logs
docker compose -f docker-compose.prod.yml logs -f app

# Check health
curl http://localhost:3000

# Restart if needed
docker compose -f docker-compose.prod.yml restart app
```

## Troubleshooting

### Deployment Failed

1. **Check GitHub Actions logs**
   - Go to Actions tab → click workflow → view error message

2. **Common issues:**
   - SSH credentials incorrect → verify secrets
   - Port 3000 already in use → `sudo lsof -i :3000`
   - Environment variables missing → check all secrets are added
   - Docker build failed → check `Dockerfile.prod` syntax

### SSH Connection Issues

```bash
# Test SSH connection locally
ssh -i ~/.ssh/do_deploy root@YOUR_DROPLET_IP

# Check SSH key permissions
chmod 600 ~/.ssh/do_deploy
chmod 644 ~/.ssh/do_deploy.pub
```

### App Won't Start

```bash
# SSH into droplet
ssh root@YOUR_DROPLET_IP
cd ~/rytm

# View logs
docker compose -f docker-compose.prod.yml logs app

# Check running containers
docker ps

# Rebuild from scratch
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml up -d
```

### Port Already in Use

```bash
# Find process on port 3000
sudo lsof -i :3000

# Kill the process
kill -9 <PID>

# Restart containers
docker compose -f docker-compose.prod.yml restart app
```

## Manual Deployment (without CI/CD)

If you need to deploy manually:

```bash
# SSH into droplet
ssh root@YOUR_DROPLET_IP

# Navigate to project
cd ~/rytm

# Pull latest code
git pull origin main

# Create .env file with values (or update existing)
nano .env  # Edit environment variables

# Deploy
docker compose -f docker-compose.prod.yml pull app || true
docker compose -f docker-compose.prod.yml build app
docker compose -f docker-compose.prod.yml up -d --remove-orphans

# Verify
docker compose -f docker-compose.prod.yml logs app
```

## Rollback

If deployment causes issues, rollback to previous version:

```bash
# SSH into droplet
ssh root@YOUR_DROPLET_IP
cd ~/rytm

# Reset to previous commit
git reset --hard HEAD~1

# Redeploy
docker compose -f docker-compose.prod.yml build app
docker compose -f docker-compose.prod.yml up -d
```

## Summary

The deployment pipeline is simple:

1. **You** push code to `main`
2. **GitHub Actions** automatically builds and deploys
3. **SSH** connects to your droplet securely
4. **Docker Compose** builds image and starts container
5. **Your app** is live on `http://YOUR_DROPLET_IP:3000`

All sensitive information is stored securely in GitHub Secrets and never exposed in your code or logs.
