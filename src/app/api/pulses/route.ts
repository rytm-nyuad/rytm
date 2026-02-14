import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/pulses — admin: all pulses, public: published only
export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let isAdmin = false;
  if (user?.email) {
    const { data: adminRow } = await supabase
      .from("pulse_admins")
      .select("email")
      .eq("email", user.email)
      .single();
    isAdmin = !!adminRow;
  }

  let query = supabase.from("pulses").select("*");

  if (isAdmin) {
    query = query.order("pulse_number", { ascending: false });
  } else {
    query = query
      .eq("is_published", true)
      .order("published_at", { ascending: false });
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ pulses: data, isAdmin });
}

// POST /api/pulses — admin only: create or update a pulse
export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: adminRow } = await supabase
    .from("pulse_admins")
    .select("email")
    .eq("email", user.email)
    .single();

  if (!adminRow) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();

  const {
    id,
    pulse_number,
    slug,
    title,
    subtitle,
    excerpt,
    content_markdown,
    cover_image_url,
    tags,
    is_published,
  } = body;

  // Build the record
  const record: Record<string, unknown> = {
    pulse_number,
    slug,
    title,
    subtitle: subtitle || null,
    excerpt: excerpt || null,
    content_markdown,
    cover_image_url: cover_image_url || null,
    tags: tags || [],
    is_published: is_published ?? false,
    author_user_id: user.id,
    author_name: body.author_name || user.email,
  };

  // Set published_at when first published
  if (is_published && !body.published_at) {
    record.published_at = new Date().toISOString();
  }

  let result;

  if (id) {
    // Update
    const { data, error } = await supabase
      .from("pulses")
      .update(record)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    result = data;
  } else {
    // Insert
    const { data, error } = await supabase
      .from("pulses")
      .insert(record)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    result = data;
  }

  return NextResponse.json({ pulse: result });
}

// DELETE /api/pulses?id=xxx — admin only
export async function DELETE(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: adminRow } = await supabase
    .from("pulse_admins")
    .select("email")
    .eq("email", user.email)
    .single();

  if (!adminRow) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const { error } = await supabase.from("pulses").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ deleted: true });
}
