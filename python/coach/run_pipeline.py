#!/usr/bin/env python3
"""
LangGraph Pipeline Runner - Entry point for morning coach pipeline
Usage: python run_pipeline.py <user_id> <for_date> <overall_score> <ingestion_run_id>
"""
import sys
import json
import os
from supabase import create_client
from langgraph_pipeline import MorningCoachPipeline

try:
    from dotenv import load_dotenv
except ModuleNotFoundError:
    def load_dotenv(*args, **kwargs):
        return False

# Load environment variables
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '..', '.env.local'))

def main():
    if len(sys.argv) != 5:
        print(json.dumps({'error': 'Usage: run_pipeline.py <user_id> <for_date> <overall_score> <ingestion_run_id>'}))
        sys.exit(1)
    
    user_id = sys.argv[1]
    for_date = sys.argv[2]
    overall_score = int(sys.argv[3])
    ingestion_run_id = sys.argv[4]
    
    # Initialize Supabase client
    required_env = {
        'NEXT_PUBLIC_SUPABASE_URL': os.getenv('NEXT_PUBLIC_SUPABASE_URL'),
        'SUPABASE_SERVICE_ROLE_KEY': os.getenv('SUPABASE_SERVICE_ROLE_KEY'),
        'OPENROUTER_API_KEY': os.getenv('OPENROUTER_API_KEY'),
    }
    missing_env = [name for name, value in required_env.items() if not value]

    if missing_env:
        print(json.dumps({'error': 'Missing environment variables', 'missing': missing_env}))
        sys.exit(1)

    supabase_url = required_env['NEXT_PUBLIC_SUPABASE_URL']
    supabase_key = required_env['SUPABASE_SERVICE_ROLE_KEY']
    openrouter_key = required_env['OPENROUTER_API_KEY']

    client = create_client(supabase_url, supabase_key)

    # Create and run pipeline
    pipeline = MorningCoachPipeline(client, openrouter_key)
    
    try:
        result = pipeline.run(user_id, for_date, overall_score, ingestion_run_id)
        print(json.dumps(result))
        sys.exit(0)
    except Exception as e:
        print(json.dumps({'error': str(e)}))
        sys.exit(1)

if __name__ == '__main__':
    main()
