export default function ComingSoonPage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0f0f0f',
        fontFamily: 'Arial, Helvetica, sans-serif',
        padding: '24px',
      }}
    >
      <div style={{ textAlign: 'center', maxWidth: '480px' }}>
        {/* Logo / wordmark */}
        <div
          style={{
            fontSize: '28px',
            fontWeight: '800',
            letterSpacing: '0.12em',
            color: '#ffffff',
            marginBottom: '40px',
          }}
        >
          RYTM
        </div>

        {/* Phase indicators */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '40px' }}>
          {/* Phase 1 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '14px',
              background: '#14532d22',
              border: '1px solid #16a34a55',
              borderRadius: '12px',
              padding: '14px 18px',
            }}
          >
            <div
              style={{
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                background: '#22c55e',
                flexShrink: 0,
                boxShadow: '0 0 8px #22c55e99',
              }}
            />
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: '13px', fontWeight: '700', color: '#22c55e', letterSpacing: '0.05em' }}>
                PHASE 1 — COMPLETE
              </div>
              
            </div>
          </div>

          {/* Phase 2 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '14px',
              background: '#1e3a5f22',
              border: '1px solid #3b82f655',
              borderRadius: '12px',
              padding: '14px 18px',
            }}
          >
            <div
              style={{
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                background: '#3b82f6',
                flexShrink: 0,
                animation: 'pulse 1.8s ease-in-out infinite',
              }}
            />
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: '13px', fontWeight: '700', color: '#60a5fa', letterSpacing: '0.05em' }}>
                PHASE 2 — IN PROGRESS
              </div>
              
            </div>
          </div>
        </div>

        <p style={{ fontSize: '15px', color: '#9ca3af', lineHeight: '1.7', margin: '0 0 32px 0' }}>
          More updates coming soon.
        </p>
{/* 
        <a
          href="/auth"
          style={{
            display: 'inline-block',
            fontSize: '13px',
            color: '#6b7280',
            textDecoration: 'none',
            borderBottom: '1px solid #374151',
            paddingBottom: '2px',
          }}
        >
          Back to sign in
        </a> */}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; box-shadow: 0 0 6px #3b82f699; }
          50% { opacity: 0.4; box-shadow: none; }
        }
      `}</style>
    </div>
  );
}
