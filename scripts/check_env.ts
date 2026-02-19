// ============================================================
// Environment & Connection Test
// ============================================================
// Quick diagnostic to verify all credentials are working.
//
// Usage: npm run meal:check-env
// ============================================================

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

console.log('\n🔍 RYTM Environment & Connection Check\n');

// ── 1. Check environment variables ──
console.log('📋 Environment Variables:');

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const openaiKey = process.env.OPENAI_API_KEY;

console.log(`   SUPABASE_URL:             ${supabaseUrl ? '✅ Set' : '❌ Missing'}`);
if (supabaseUrl) console.log(`      → ${supabaseUrl}`);

console.log(`   SUPABASE_SERVICE_ROLE_KEY: ${supabaseKey ? '✅ Set' : '❌ Missing'}`);
if (supabaseKey) console.log(`      → ${supabaseKey.substring(0, 20)}...${supabaseKey.substring(supabaseKey.length - 10)}`);

console.log(`   OPENAI_API_KEY:           ${openaiKey ? '✅ Set' : '❌ Missing'}`);
if (openaiKey) console.log(`      → ${openaiKey.substring(0, 10)}...${openaiKey.substring(openaiKey.length - 4)}`);

if (!supabaseUrl || !supabaseKey || !openaiKey) {
  console.log('\n❌ Missing required environment variables!\n');
  process.exit(1);
}

async function runTests() {
  // ── 2. Test Supabase Connection ──
  console.log('\n🔌 Testing Supabase Connection...');

  try {
    const supabase = createClient(supabaseUrl!, supabaseKey!, {
      auth: { persistSession: false },
    });

    // Try a simple query
    const { data, error } = await supabase
      .from('meal_logs')
      .select('id')
      .limit(1);

    if (error) {
      console.log(`   ❌ Supabase query failed: ${error.message}`);
      console.log(`      Error code: ${error.code}`);
      console.log(`      Details: ${JSON.stringify(error.details)}`);
    } else {
      console.log(`   ✅ Supabase connected successfully`);
      console.log(`      → Found ${data?.length ?? 0} meal(s) in test query`);
    }
  } catch (err: any) {
    console.log(`   ❌ Supabase connection error: ${err.message}`);
  }

  // ── 3. Test OpenAI Connection ──
  console.log('\n🤖 Testing OpenAI Connection...');

  try {
    const openai = new OpenAI({ apiKey: openaiKey });
    
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: 'Say "OK" if you can hear me.' }],
      max_tokens: 5,
    });

    const reply = response.choices[0]?.message?.content;
    console.log(`   ✅ OpenAI connected successfully`);
    console.log(`      → Test response: "${reply}"`);
  } catch (err: any) {
    console.log(`   ❌ OpenAI connection error: ${err.message}`);
    if (err.status) console.log(`      → HTTP Status: ${err.status}`);
    if (err.type) console.log(`      → Error Type: ${err.type}`);
  }

  console.log('\n✅ Environment check complete!\n');
}

runTests().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
