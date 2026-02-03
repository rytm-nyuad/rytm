// Daily streak report
// Usage: set environment variables and run `node scripts/daily_streak_report.js`

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');   

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const REPORT_TO = process.env.REPORT_TO_EMAIL;
const REPORT_TIMEZONE = process.env.REPORT_TIMEZONE || 'UTC';
const CUTOFF_HOUR = parseInt(process.env.REPORT_CUTOFF_HOUR || '14', 10);
const CUTOFF_MIN = parseInt(process.env.REPORT_CUTOFF_MIN || '30', 10);

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
if (!REPORT_TO) {
  console.error('Missing REPORT_TO_EMAIL - set environment variable');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

function formatDateInTimeZone(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function isBeforeCutoff(isoTimestamp, timeZone, cutoffHour = CUTOFF_HOUR, cutoffMin = CUTOFF_MIN) {
  if (!isoTimestamp) return false;
  const d = new Date(isoTimestamp);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour12: false, hour: '2-digit', minute: '2-digit' }).formatToParts(d);
  // formatToParts returns array like [{type:'hour',value:'13'},{type:'literal',value:':'},{type:'minute',value:'05'}...]
  const hourPart = parts.find(p => p.type === 'hour')?.value || '00';
  const minutePart = parts.find(p => p.type === 'minute')?.value || '00';
  const hour = parseInt(hourPart, 10);
  const minute = parseInt(minutePart, 10);
  if (hour < cutoffHour) return true;
  if (hour === cutoffHour && minute <= cutoffMin) return true;
  return false;
}

async function generateReport(supabaseClient = supabase, opts = {}) {
  const TZ_FALLBACK = opts.REPORT_TIMEZONE || REPORT_TIMEZONE;
  const cutoffHour = opts.CUTOFF_HOUR ?? CUTOFF_HOUR;
  const cutoffMin = opts.CUTOFF_MIN ?? CUTOFF_MIN;

  // Fetch participants from profiles
  const { data: profiles, error: profilesErr } = await supabaseClient.from('profiles').select('user_id,email,timezone,first_name,last_name').not('email', 'is', null);
  if (profilesErr) {
    throw new Error('Failed to load profiles: ' + JSON.stringify(profilesErr));
  }

  const missedOneDay = [];
  const missedTwoDays = [];
  const lateTwoDays = [];
  const details = [];
  const failedStreaks = [];
  const failedStreaksThreeDays = [];

  for (const p of profiles) {
    const tz = p.timezone || TZ_FALLBACK || 'UTC';
    const userName = [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email;

    const now = new Date();
    // compute local dates for yesterday, day-before-yesterday, and 3 days ago in user's tz
    const yesterdayDate = formatDateInTimeZone(new Date(Date.now() - 24 * 60 * 60 * 1000), tz);
    const prev2Date = formatDateInTimeZone(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), tz);
    const prev3Date = formatDateInTimeZone(new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), tz);

    // fetch daily_summary rows for these dates (we rely on this to know which parts are complete)
    const { data: sums, error: sumsErr } = await supabaseClient
      .from('daily_summary')
      .select('date,has_overall,has_meal,has_water,has_journal,has_checkin,is_complete')
      .eq('user_id', p.user_id)
      .in('date', [yesterdayDate, prev2Date, prev3Date]);

    if (sumsErr) {
      console.warn('daily_summary query failed for', p.user_id, sumsErr.message);
      continue;
    }

    const sumMap = new Map((sums || []).map(s => [s.date, s]));
    const yRow = sumMap.get(yesterdayDate) || null;
    const p2Row = sumMap.get(prev2Date) || null;
    const p3Row = sumMap.get(prev3Date) || null;
    const yHas = !!(yRow?.has_overall);
    const p2Has = !!(p2Row?.has_overall);
    const p3Has = !!(p3Row?.has_overall);

    // fetch daily_overall created_at to check submission times
    const { data: overalls, error: overErr } = await supabaseClient
      .from('daily_overall')
      .select('date,created_at')
      .eq('user_id', p.user_id)
      .in('date', [yesterdayDate, prev2Date, prev3Date]);

    if (overErr) {
      console.warn('daily_overall query failed for', p.user_id, overErr.message);
    }

    const overallMap = new Map((overalls || []).map(o => [o.date, o]));
    const yCreated = overallMap.get(yesterdayDate)?.created_at || null;
    const p2Created = overallMap.get(prev2Date)?.created_at || null;
    const p3Created = overallMap.get(prev3Date)?.created_at || null;

    const yOnTime = yCreated ? isBeforeCutoff(yCreated, tz, cutoffHour, cutoffMin) : false;
    const p2OnTime = p2Created ? isBeforeCutoff(p2Created, tz, cutoffHour, cutoffMin) : false;
    const p3OnTime = p3Created ? isBeforeCutoff(p3Created, tz, cutoffHour, cutoffMin) : false;

    // Determine missing items per-day (for reporting what they're slacking on)
    function missingItemsForRow(row) {
      if (!row) return ['overall'];
      const missing = [];
      if (!row.has_meal) missing.push('meal');
      if (!row.has_water) missing.push('water');
      if (!row.has_journal) missing.push('journal');
      if (!row.has_checkin) missing.push('checkin');
      if (!row.has_overall) missing.push('overall');
      return missing;
    }

    const yMissing = missingItemsForRow(yRow);
    const p2Missing = missingItemsForRow(p2Row);

    // missed 1 day (yesterday only)
    if (!yHas && p2Has) {
      missedOneDay.push({ user_id: p.user_id, email: p.email, name: userName, date: yesterdayDate, missing: yMissing });
    }

    // missed if both days have no overall
    if (!yHas && !p2Has) {
      missedTwoDays.push({ user_id: p.user_id, email: p.email, name: userName, dates: [prev2Date, yesterdayDate], missing: { [prev2Date]: p2Missing, [yesterdayDate]: yMissing } });
    }

    // late if both days had an overall but both were after cutoff (i.e., not onTime)
    // Interpret: if they didn't submit at all (missing), it's not a "late" entry for these conditions.
    if ((yHas && !yOnTime) && (p2Has && !p2OnTime)) {
      lateTwoDays.push({ user_id: p.user_id, email: p.email, name: userName, dates: [prev2Date, yesterdayDate], created_at: [p2Created, yCreated] });
    }

    // failed streak: if both days are not complete (is_complete false), report per-item deficits
    const yComplete = !!(yRow?.is_complete);
    const p2Complete = !!(p2Row?.is_complete);
    if (!yComplete && !p2Complete) {
      // aggregate what items are missing across the two days
      const aggregated = new Set();
      p2Missing.forEach(i => aggregated.add(i));
      yMissing.forEach(i => aggregated.add(i));
      const aggregatedArr = Array.from(aggregated);
      failedStreaks.push({ user_id: p.user_id, email: p.email, name: userName, dates: [prev2Date, yesterdayDate], missing_by_date: { [prev2Date]: p2Missing, [yesterdayDate]: yMissing }, missing_summary: aggregatedArr });
    }

    // failed streak: 3 consecutive days incomplete
    const p3Complete = !!(p3Row?.is_complete);
    const p3Missing = missingItemsForRow(p3Row);
    if (!yComplete && !p2Complete && !p3Complete) {
      const aggregated = new Set();
      p3Missing.forEach(i => aggregated.add(i));
      p2Missing.forEach(i => aggregated.add(i));
      yMissing.forEach(i => aggregated.add(i));
      const aggregatedArr = Array.from(aggregated);
      failedStreaksThreeDays.push({ user_id: p.user_id, email: p.email, name: userName, dates: [prev3Date, prev2Date, yesterdayDate], missing_by_date: { [prev3Date]: p3Missing, [prev2Date]: p2Missing, [yesterdayDate]: yMissing }, missing_summary: aggregatedArr });
    }

    details.push({ user_id: p.user_id, email: p.email, tz, yesterdayDate, prev2Date, yHas, p2Has, yCreated, p2Created, yOnTime, p2OnTime, yMissing, p2Missing, yComplete, p2Complete });
  }

  // Build email content
  let text = `Daily streak report\n\n`;
  text += `Cutoff time: ${String(cutoffHour).padStart(2, '0')}:${String(cutoffMin).padStart(2, '0')} (${TZ_FALLBACK})\n\n`;

  if (missedOneDay.length) {
    text += `=== 1-Day Missers (${missedOneDay.length}) ===\n`;
    missedOneDay.forEach(u => { text += `- ${u.name || u.email} (${u.email}) — date: ${u.date} — missing: ${u.missing.join(', ')}\n`; });
    text += `\n`;
  }

  if (missedTwoDays.length) {
    text += `=== Missed Daily Overall (${missedTwoDays.length}) ===\n`;
    missedTwoDays.forEach(u => { text += `- ${u.name || u.email} (${u.email}) — dates: ${u.dates.join(', ')}\n`; });
    text += `\n`;
  }

  if (failedStreaks.length) {
    text += `=== Failed Streak - 2 Days (${failedStreaks.length}) ===\n`;
    failedStreaks.forEach(u => {
      text += `- ${u.name || u.email} (${u.email}) — dates: ${u.dates.join(', ')} — missing: ${u.missing_summary.join(', ')}\n`;
      text += `  breakdown: ${Object.entries(u.missing_by_date).map(([d, arr]) => `${d}: [${arr.join(', ')}]`).join(' ; ')}\n`;
    });
    text += `\n`;
  }

  if (failedStreaksThreeDays.length) {
    text += `=== Failed Streak - 3 Days (${failedStreaksThreeDays.length}) ===\n`;
    failedStreaksThreeDays.forEach(u => {
      text += `- ${u.name || u.email} (${u.email}) — dates: ${u.dates.join(', ')} — missing: ${u.missing_summary.join(', ')}\n`;
      text += `  breakdown: ${Object.entries(u.missing_by_date).map(([d, arr]) => `${d}: [${arr.join(', ')}]`).join(' ; ')}\n`;
    });
    text += `\n`;
  }

  if (lateTwoDays.length) {
    text += `=== Late Submissions - 2 Days (${lateTwoDays.length}) ===\n`;
    lateTwoDays.forEach(u => { text += `- ${u.name || u.email} (${u.email}) — dates: ${u.dates.join(', ')}\n`; });
    text += `\n`;
  }

  // optional: include details as CSV
  text += `Details:\n`;
  details.forEach(d => {
    text += `${d.email},${d.user_id},${d.tz},${d.prev2Date},${d.p2Has ? '1' : '0'},${d.p2Created || ''},${d.p2OnTime ? 'on-time' : 'late'},${d.yesterdayDate},${d.yHas ? '1' : '0'},${d.yCreated || ''},${d.yOnTime ? 'on-time' : 'late'}\n`;
  });

  const html = buildHtml({ missedOneDay, missedTwoDays, lateTwoDays, failedStreaks, failedStreaksThreeDays, details, cutoffHour, cutoffMin, TZ_FALLBACK });

  return { text, html, missedOneDay, missedTwoDays, lateTwoDays, failedStreaks, failedStreaksThreeDays, details };
}

function buildHtml({ missedOneDay, missedTwoDays, lateTwoDays, failedStreaks, failedStreaksThreeDays, details, cutoffHour, cutoffMin, TZ_FALLBACK }) {
  const buildTable = (columns, rows) => {
    const headerStyle = "background-color:#f5f5f5;border:1px solid #ddd;padding:10px;text-align:left;font-weight:bold;color:#333";
    const cellStyle = "border:1px solid #eee;padding:10px;vertical-align:top";
    const alternateStyle = "background-color:#fafafa";
    
    return `
      <table style="border-collapse:collapse;width:100%;font-family:Arial,Helvetica,sans-serif;margin-bottom:20px"> 
        <thead>
          <tr>${columns.map(c => `<th style="${headerStyle}">${c}</th>`).join('')}</tr>
        </thead>
        <tbody>
          ${rows.map((r, idx) => `<tr style="${idx % 2 === 1 ? alternateStyle : ''};">${r.map(cell => `<td style="${cellStyle}">${cell}</td>`).join('')}</tr>`).join('')}
        </tbody>
      </table>
    `;
  };

  const sectionHeaderStyle = "color:#fff;background-color:#1976d2;padding:12px;border-radius:4px;font-size:16px;font-weight:bold;margin-top:20px;margin-bottom:10px";

  let html = `<!doctype html><html><head><style>
    body { font-family:Arial,Helvetica,sans-serif; color:#222; line-height:1.6; }
    h2 { color:#1976d2; border-bottom:3px solid #1976d2; padding-bottom:10px; }
    .section-header { ${sectionHeaderStyle} }
    .count { background-color:#d32f2f; color:#fff; padding:2px 8px; border-radius:3px; }
  </style></head><body>`;
  
  html += `<h2>📊 Daily Streak Report</h2>`;
  html += `<p style="color:#666"><strong>Cutoff time:</strong> ${String(cutoffHour).padStart(2,'0')}:${String(cutoffMin).padStart(2,'0')} (${TZ_FALLBACK})</p>`;

  if ((missedOneDay || []).length) {
    html += `<div class="section-header">⚠️ 1-Day Missers <span class="count">${missedOneDay.length}</span></div>`;
    const rows = missedOneDay.map(u => [u.name || u.email, u.email, u.date, u.missing.join(', ')]);
    html += buildTable(['Name', 'Email', 'Date', 'Missing'], rows);
  }

  if ((missedTwoDays || []).length) {
    html += `<div class="section-header">❌ Missed Daily Overall (2 Days) <span class="count">${missedTwoDays.length}</span></div>`;
    const rows = missedTwoDays.map(u => [u.name || u.email, u.email, u.dates.join(', '), u.missing && Object.entries(u.missing).map(([d, arr]) => `${d}: [${arr.join(', ')}]`).join('<br/>') || '']);
    html += buildTable(['Name', 'Email', 'Dates', 'Missing Breakdown'], rows);
  }

  if ((failedStreaks || []).length) {
    html += `<div class="section-header">📉 Failed Streak (2 Days) <span class="count">${failedStreaks.length}</span></div>`;
    const rows = failedStreaks.map(u => [u.name || u.email, u.email, u.dates.join(', '), u.missing_summary.join(', '), Object.entries(u.missing_by_date).map(([d, arr]) => `${d}: [${arr.join(', ')}]`).join('<br/>')]);
    html += buildTable(['Name', 'Email', 'Dates', 'Missing Summary', 'Per-Day Breakdown'], rows);
  }

  if ((failedStreaksThreeDays || []).length) {
    html += `<div class="section-header">🔴 Failed Streak (3 Days) <span class="count">${failedStreaksThreeDays.length}</span></div>`;
    const rows = failedStreaksThreeDays.map(u => [u.name || u.email, u.email, u.dates.join(', '), u.missing_summary.join(', '), Object.entries(u.missing_by_date).map(([d, arr]) => `${d}: [${arr.join(', ')}]`).join('<br/>')]);
    html += buildTable(['Name', 'Email', 'Dates', 'Missing Summary', 'Per-Day Breakdown'], rows);
  }

  if ((lateTwoDays || []).length) {
    html += `<div class="section-header">⏰ Late Submissions (2 Days) <span class="count">${lateTwoDays.length}</span></div>`;
    const rows = lateTwoDays.map(u => [u.name || u.email, u.email, u.dates.join(', ')]);
    html += buildTable(['Name', 'Email', 'Dates'], rows);
  }

  html += `<hr style="margin-top:30px;border:none;border-top:1px solid #ddd">`;
  html += `<h3 style="color:#666">Summary</h3>`;
  html += `<ul style="line-height:2">
    <li>1-Day Missers: <strong>${(missedOneDay || []).length}</strong></li>
    <li>Missed 2 Days: <strong>${(missedTwoDays || []).length}</strong></li>
    <li>Failed Streak (2 Days): <strong>${(failedStreaks || []).length}</strong></li>
    <li>Failed Streak (3 Days): <strong>${(failedStreaksThreeDays || []).length}</strong></li>
    <li>Late (2 Days): <strong>${(lateTwoDays || []).length}</strong></li>
  </ul>`;

  html += `</body></html>`;
  return html;
}

async function main() {
  try {
    const result = await generateReport(supabase, { REPORT_TIMEZONE, CUTOFF_HOUR, CUTOFF_MIN });

    if ((result.missedOneDay.length === 0) && (result.missedTwoDays.length === 0) && (result.lateTwoDays.length === 0) && (result.failedStreaks.length === 0) && (result.failedStreaksThreeDays.length === 0)) {
      console.log('No users matched criteria; no email sent.');
      return;
    }

    // create transporter
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });

    const subject = `Daily streak alert: ${result.missedOneDay.length} (1d), ${result.missedTwoDays.length} (2d), ${result.failedStreaks.length} (fail-2d), ${result.failedStreaksThreeDays.length} (fail-3d), ${result.lateTwoDays.length} late`;

    const mailOptions = {
      from: process.env.REPORT_FROM_EMAIL || process.env.SMTP_USER,
      to: REPORT_TO,
      subject,
      text: result.text,
      html: result.html
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Report sent:', info.messageId || info.response || info);
  } catch (err) {
    console.error('Failed to generate/send report:', err);
    process.exitCode = 1;
  }
}

module.exports = { generateReport, buildHtml, main };

if (require.main === module) {
  main();
}
