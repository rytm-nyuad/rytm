#!/usr/bin/env python3
"""
Apply correlation archetype + cohort baseline SQL schemas.

Requires in .env.local:
  NEXT_PUBLIC_SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY

Optional for first-time bootstrap:
  SUPABASE_DB_PASSWORD
"""
from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Optional
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


def table_exists(client, table: str) -> bool:
    try:
        client.table(table).select("*").limit(1).execute()
        return True
    except Exception as exc:
        message = str(exc)
        if "PGRST205" in message or "Could not find the table" in message:
            return False
        raise


def apply_via_rpc(client, fn_name: str) -> bool:
    try:
        client.rpc(fn_name, {}).execute()
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


def ensure_table(
    client,
    *,
    table: str,
    installer_rpc: str,
    sql_path: Path,
    supabase_url: str,
    db_password: Optional[str],
) -> None:
    if table_exists(client, table):
        print(f"{table} already exists.")
        return

    if apply_via_rpc(client, installer_rpc):
        if table_exists(client, table):
            print(f"Applied {table} via {installer_rpc}().")
            return
        print(f"RPC ran but {table} is still missing.", file=sys.stderr)
        sys.exit(1)

    if db_password:
        apply_via_postgres(supabase_url, db_password, sql_path)
        # Also need claim/promote from full SQL for archetypes table.
        if table_exists(client, table):
            print(f"Applied schema from {sql_path} via Postgres.")
            return
        print("Postgres apply finished but table is still missing.", file=sys.stderr)
        sys.exit(1)

    print(
        f"Could not apply schema for {table} automatically.\n"
        f"Paste {sql_path} into the Supabase SQL editor, or set SUPABASE_DB_PASSWORD.",
        file=sys.stderr,
    )
    sys.exit(1)


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

    root = Path(__file__).resolve().parents[2]
    from supabase import create_client

    client = create_client(supabase_url, service_role_key)

    ensure_table(
        client,
        table="user_correlation_archetypes1",
        installer_rpc="install_user_correlation_archetypes_schema",
        sql_path=root / "supabase" / "user_correlation_archetypes.sql",
        supabase_url=supabase_url,
        db_password=db_password,
    )
    ensure_table(
        client,
        table="correlation_cohort_baselines1",
        installer_rpc="install_correlation_cohort_baselines_schema",
        sql_path=root / "supabase" / "correlation_cohort_baselines.sql",
        supabase_url=supabase_url,
        db_password=db_password,
    )


if __name__ == "__main__":
    main()
