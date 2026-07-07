#!/usr/bin/env python3
"""
Apply supabase/user_behavior_profiles.sql using Supabase project credentials.

Requires in .env.local:
  NEXT_PUBLIC_SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY

Optional for first-time bootstrap (when the installer RPC is not in the DB yet):
  SUPABASE_DB_PASSWORD  — database password from Supabase dashboard
"""
from __future__ import annotations

import os
import sys
from pathlib import Path
from urllib.parse import quote_plus

try:
    from dotenv import load_dotenv
except ModuleNotFoundError:
    def load_dotenv(*args, **kwargs):
        return False


def project_ref(supabase_url: str) -> str:
    host = supabase_url.replace("https://", "").replace("http://", "").rstrip("/")
    return host.split(".")[0]


def postgres_url_from_supabase_url(supabase_url: str, password: str) -> str:
    ref = project_ref(supabase_url)
    encoded_password = quote_plus(password)
    return f"postgresql://postgres:{encoded_password}@db.{ref}.supabase.co:5432/postgres"


def table_exists(client) -> bool:
    try:
        client.table("user_behavior_profiles1").select("profile_id").limit(1).execute()
        return True
    except Exception as exc:
        message = str(exc)
        if "PGRST205" in message or "Could not find the table" in message:
            return False
        raise


def apply_via_rpc(client) -> bool:
    try:
        client.rpc("install_user_behavior_profiles_schema", {}).execute()
        return True
    except Exception as exc:
        message = str(exc)
        if "PGRST202" in message or "Could not find the function" in message:
            return False
        raise


def apply_via_postgres(supabase_url: str, password: str, sql_path: Path) -> None:
    try:
        import psycopg2
    except ModuleNotFoundError:
        print(
            "psycopg2-binary is required for direct Postgres apply. "
            "Run: pip install -r python/coach/requirements.txt",
            file=sys.stderr,
        )
        sys.exit(1)

    database_url = postgres_url_from_supabase_url(supabase_url, password)
    sql = sql_path.read_text(encoding="utf-8")
    conn = psycopg2.connect(database_url)
    conn.autocommit = True
    try:
        with conn.cursor() as cursor:
            cursor.execute(sql)
    finally:
        conn.close()


def main() -> None:
    load_dotenv(Path(__file__).resolve().parents[2] / ".env.local")

    supabase_url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    service_role_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    db_password = os.getenv("SUPABASE_DB_PASSWORD")

    if not supabase_url or not service_role_key:
        print(
            "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local.",
            file=sys.stderr,
        )
        sys.exit(1)

    sql_path = Path(__file__).resolve().parents[2] / "supabase" / "user_behavior_profiles.sql"

    from supabase import create_client

    client = create_client(supabase_url, service_role_key)

    if table_exists(client):
        print("user_behavior_profiles1 already exists.")
        sys.exit(0)

    if apply_via_rpc(client):
        if table_exists(client):
            print("Applied schema via install_user_behavior_profiles_schema() RPC.")
            sys.exit(0)
        print("RPC ran but user_behavior_profiles1 is still missing.", file=sys.stderr)
        sys.exit(1)

    if db_password:
        apply_via_postgres(supabase_url, db_password, sql_path)
        if table_exists(client):
            print(f"Applied schema from {sql_path} via Postgres.")
            sys.exit(0)
        print("Postgres apply finished but table is still missing.", file=sys.stderr)
        sys.exit(1)

    print(
        "Could not apply schema automatically.\n"
        "The installer RPC is not in your database yet.\n"
        "Either:\n"
        f"  1) Paste supabase/user_behavior_profiles.sql into the SQL editor for {supabase_url}\n"
        "  2) Add SUPABASE_DB_PASSWORD to .env.local and rerun this script",
        file=sys.stderr,
    )
    sys.exit(1)


if __name__ == "__main__":
    main()
