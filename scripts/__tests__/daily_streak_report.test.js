const path = require('path');
const { jest } = require('@jest/globals');

describe('daily_streak_report', () => {
  beforeAll(() => {
    // freeze time to 2026-02-03T00:00:00Z => 04:00 Asia/Dubai
    jest.useFakeTimers('modern');
    jest.setSystemTime(new Date('2026-02-03T00:00:00Z'));
  });
  afterAll(() => {
    jest.useRealTimers();
  });

  test('generateReport builds correct lists and html', async () => {
    // Prepare mock data
    const profiles = [
      { user_id: 'u1', email: 'u1@example.com', timezone: 'Asia/Dubai' },
      { user_id: 'u2', email: 'u2@example.com', timezone: 'Asia/Dubai' },
      { user_id: 'u3', email: 'u3@example.com', timezone: 'Asia/Dubai' }
    ];

    // Dates relative to frozen time in Asia/Dubai: yesterday = 2026-02-02, prev2 = 2026-02-01
    const ds = {
      // u1: missing both days (no daily_summary rows)
      'u1': [],
      // u2: has overall both days but created after cutoff (late)
      'u2': [
        { date: '2026-02-01', created_at: '2026-02-01T15:30:00+04:00' },
        { date: '2026-02-02', created_at: '2026-02-02T15:30:00+04:00' }
      ],
      // u3: has daily_summary rows but both incomplete and missing items
      'u3': [
        { date: '2026-02-01', has_overall: false, has_meal: false, has_water: true, has_journal: false, has_checkin: true, is_complete: false },
        { date: '2026-02-02', has_overall: true, has_meal: false, has_water: false, has_journal: false, has_checkin: false, is_complete: false }
      ]
    };

    const doMap = {
      'u1': [],
      'u2': [
        { date: '2026-02-01', created_at: '2026-02-01T15:30:00+04:00' },
        { date: '2026-02-02', created_at: '2026-02-02T15:30:00+04:00' }
      ],
      'u3': []
    };

    // Create a mock supabase client
    const mockSupabase = {
      from: (table) => {
        return {
          select: (sel) => {
            if (table === 'profiles') {
              return {
                not: () => Promise.resolve({ data: profiles })
              };
            }
            if (table === 'daily_summary') {
              return {
                eq: (field, userId) => ({
                  in: (fld, dates) => {
                    const arr = (ds[userId] || []).filter(r => dates.includes(r.date)).map(r => ({ ...r }));
                    return Promise.resolve({ data: arr, error: null });
                  }
                })
              };
            }
            if (table === 'daily_overall') {
              return {
                eq: (field, userId) => ({
                  in: (fld, dates) => {
                    const arr = (doMap[userId] || []).filter(r => dates.includes(r.date)).map(r => ({ ...r }));
                    return Promise.resolve({ data: arr, error: null });
                  }
                })
              };
            }
            return { select: () => Promise.resolve({ data: [] }) };
          }
        };
      }
    };

    // Import generateReport from module and run with mock supabase
    const reporter = require('../daily_streak_report');
    const { generateReport, buildHtml } = reporter;

    const result = await generateReport(mockSupabase, { REPORT_TIMEZONE: 'Asia/Dubai', CUTOFF_HOUR: 14, CUTOFF_MIN: 30 });

    // checks
    expect(result.missedTwoDays.some(u => u.user_id === 'u1')).toBe(true);
    expect(result.lateTwoDays.some(u => u.user_id === 'u2')).toBe(true);
    expect(result.failedStreaks.some(u => u.user_id === 'u3')).toBe(true);

    // html contains headings and tables
    expect(result.html).toContain('Daily streak report');
    expect(result.html).toContain('Users missing daily_overall');
    expect(result.html).toContain('Users who failed streak');

  });

  test('main sends email using transporter (mocked)', async () => {
    // Use isolateModules so we can mock modules before requiring
    const profiles = [ { user_id: 'u1', email: 'u1@example.com', timezone: 'Asia/Dubai' } ];
    const ds = { 'u1': [] };
    const doMap = { 'u1': [] };

    const mockSupabase = {
      from: (table) => ({
        select: () => ({ not: () => Promise.resolve({ data: profiles }) })
      })
    };

    const sendMailMock = jest.fn().mockResolvedValue({ messageId: 'abc' });

    jest.isolateModules(async () => {
      // mock createClient to return our mockSupabase
      jest.doMock('@supabase/supabase-js', () => ({ createClient: () => mockSupabase }));
      // mock nodemailer
      jest.doMock('nodemailer', () => ({ createTransport: () => ({ sendMail: sendMailMock }) }));

      const modPath = path.join(__dirname, '..', 'daily_streak_report.js');
      const mod = require(modPath);

      // set env for REPORT_TO_EMAIL and SMTP vars expected by main
      process.env.REPORT_TO_EMAIL = 'ops@example.com';
      process.env.SMTP_HOST = 'smtp.example.com';
      process.env.SMTP_PORT = '587';
      process.env.SMTP_USER = 'user';
      process.env.SMTP_PASS = 'pass';
      process.env.SMTP_SECURE = 'false';

      // call main
      await mod.main();

      // ensure sendMail called
      expect(sendMailMock).toHaveBeenCalled();

      // cleanup mocks
      jest.dontMock('@supabase/supabase-js');
      jest.dontMock('nodemailer');
    });

  });

});
