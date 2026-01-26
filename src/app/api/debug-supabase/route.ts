// app/api/debug-supabase/route.ts
import { NextResponse } from "next/server"

export async function GET() {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/health`
  )
  const text = await res.text()
  return NextResponse.json({ ok: true, text })
}
