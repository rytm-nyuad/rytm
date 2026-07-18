#!/usr/bin/env python3
"""
LangGraph Pipeline Runner - Entry point for morning coach pipeline
Usage: python run_pipeline.py <user_id> <for_date> <overall_score> <ingestion_run_id>

LLM provider is selected via env:
  COACH_LLM_PROVIDER=openai|openrouter
  COACH_LLM_MODEL=... (optional)
"""
import sys
import json
import os
from supabase import create_client
from langgraph_pipeline import MorningCoachPipeline
from llm_config import resolve_coach_pipeline_llm_config

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
    supabase_url = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
    supabase_key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

    if not all([supabase_url, supabase_key]):
        print(json.dumps({'error': 'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'}))
        sys.exit(1)

    try:
        llm_config = resolve_coach_pipeline_llm_config()
    except ValueError as e:
        print(json.dumps({'error': str(e)}))
        sys.exit(1)

    client = create_client(supabase_url, supabase_key)

    # Create and run pipeline
    pipeline = MorningCoachPipeline(client, llm_config=llm_config)
    
    try:
        result = pipeline.run(user_id, for_date, overall_score, ingestion_run_id)
        print(json.dumps(result))
        sys.exit(0)
    except Exception as e:
        print(json.dumps({'error': str(e)}))
        sys.exit(1)

if __name__ == '__main__':
    main()
