"use client";

/**
 * RamadanDecorOverlay
 * -------------------
 * A premium, layered decorative overlay with hanging lanterns, stars, and subtle dust particles.
 * Designed to feel integrated, not flat — with depth, intentional lighting, and a center fade mask.
 *
 * Enable via env:  NEXT_PUBLIC_RAMADAN_DECOR = "1"
 *
 * The overlay is `absolute inset-0` and `pointer-events-none`, contained within the first
 * dashboard screen section only. All animations respect prefers-reduced-motion.
 */

import { useMemo } from "react";

/* ------------------------------------------------------------------ */
/*  SVG Components                                                     */
/* ------------------------------------------------------------------ */

function Lantern({ className, style, id }: { className?: string; style?: React.CSSProperties; id: string }) {
  const gradId = `lanternGrad-${id}`;
  
  return (
    <svg
      viewBox="0 0 60 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={style}
      aria-hidden="true"
    >
      {/* Chain - more visible */}
      <line x1="30" y1="0" x2="30" y2="28" stroke="#d4af37" strokeWidth="1.5" opacity="0.8" />
      <line x1="30" y1="0" x2="30" y2="28" stroke="#fbbf24" strokeWidth="0.5" opacity="0.4" />
      
      {/* Top cap */}
      <ellipse cx="30" cy="28" rx="8" ry="3" fill="#c8a24e" opacity="0.8" />
      
      {/* Lantern body with premium gradient */}
      <path
        d="M18 32 C18 32, 12 50, 12 65 C12 80, 22 90, 30 90 C38 90, 48 80, 48 65 C48 50, 42 32, 42 32 Z"
        fill={`url(#${gradId})`}
        stroke="#d4af37"
        strokeWidth="1"
        opacity="0.95"
      />
      
      {/* Inner glow layers - brighter */}
      <ellipse cx="30" cy="60" rx="8" ry="14" fill="#fbbf24" opacity="0.5" />
      <ellipse cx="30" cy="62" rx="6" ry="10" fill="#fde68a" opacity="0.6" />
      <ellipse cx="30" cy="64" rx="4" ry="7" fill="#fff7ed" opacity="0.5" />
      
      {/* Bottom finial */}
      <ellipse cx="30" cy="92" rx="4" ry="2" fill="#c8a24e" opacity="0.7" />
      <circle cx="30" cy="96" r="2.5" fill="#b8942e" opacity="0.6" />
      
      {/* Gradient definition */}
      <defs>
        <linearGradient id={gradId} x1="30" y1="32" x2="30" y2="90" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#fde68a" stopOpacity="0.9" />
          <stop offset="40%" stopColor="#f59e0b" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#b45309" stopOpacity="0.75" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function Star4Point({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <path
        d="M10 0 L11 9 L20 10 L11 11 L10 20 L9 11 L0 10 L9 9 Z"
        fill="#fbbf24"
        opacity="0.6"
      />
    </svg>
  );
}

function CrescentMoon({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg
      viewBox="0 0 80 80"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={style}
      aria-hidden="true"
    >
      {/* Outer glow */}
      <circle cx="40" cy="40" r="38" fill="#fde68a" opacity="0.08" />
      
      {/* Crescent shape - more opaque and defined */}
      <circle cx="40" cy="40" r="28" fill="#d4af37" opacity="0.85" />
      <circle cx="50" cy="34" r="24" fill="var(--ramadan-bg, #0a0a0a)" opacity="1" />
      
      {/* Add subtle inner highlight on crescent edge */}
      <circle cx="40" cy="40" r="28" fill="#fde68a" opacity="0.15" />
      <circle cx="50" cy="34" r="24" fill="var(--ramadan-bg, #0a0a0a)" opacity="1" />
      
      {/* Star accent */}
      <polygon
        points="62,22 63.5,26 68,26.5 64.5,29 65.5,33 62,30.5 58.5,33 59.5,29 56,26.5 60.5,26"
        fill="#fbbf24"
        opacity="0.85"
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Data structures & generators                                       */
/* ------------------------------------------------------------------ */

interface DecorativeElement {
  id: number;
  left: string;
  top: string;
  size: number;
  opacity: number;
  delay: string;
  duration: string;
}

function useStars(count: number): DecorativeElement[] {
  return useMemo(() => {
    const stars: DecorativeElement[] = [];
    const positions = [
      { left: "8%", top: "15%" },
      { left: "18%", top: "8%" },
      { left: "72%", top: "12%" },
      { left: "85%", top: "18%" },
      { left: "25%", top: "25%" },
      { left: "62%", top: "22%" },
      { left: "45%", top: "10%" },
      { left: "92%", top: "28%" },
    ];
    
    for (let i = 0; i < Math.min(count, positions.length); i++) {
      const seed = (i * 23 + 11) % 100;
      stars.push({
        id: i,
        left: positions[i].left,
        top: positions[i].top,
        size: 3 + (seed % 3),
        opacity: 0.1 + (seed % 5) * 0.02,
        delay: `${(i * 2.3) % 8}s`,
        duration: `${6 + (seed % 4)}s`,
      });
    }
    return stars;
  }, [count]);
}

function useDustParticles(count: number): DecorativeElement[] {
  return useMemo(() => {
    const particles: DecorativeElement[] = [];
    for (let i = 0; i < count; i++) {
      const seed = (i * 19 + 13) % 100;
      particles.push({
        id: i,
        left: `${(seed * 41) % 100}%`,
        top: `${(seed * 47 + 17) % 60}%`, // Keep in upper 60%
        size: 2 + (seed % 4),
        opacity: 0.06 + (seed % 6) * 0.01,
        delay: `${(i * 1.9) % 10}s`,
        duration: `${10 + (seed % 8)}s`,
      });
    }
    return particles;
  }, [count]);
}

/* ------------------------------------------------------------------ */
/*  Keyframes & styles                                                 */
/* ------------------------------------------------------------------ */

const KEYFRAMES = `
@keyframes ramadan-lantern-sway {
  0%, 100% { transform: rotate(-1.2deg); }
  50%      { transform: rotate(1.2deg); }
}

@keyframes ramadan-glow-flicker {
  0%, 100% { opacity: 0.85; }
  50%      { opacity: 1; }
}

@keyframes ramadan-light-sequence {
  0%, 90%, 100% { 
    filter: drop-shadow(0 0 20px rgba(251,191,36,0.4));
    opacity: 0.85;
  }
  10%, 80% { 
    filter: drop-shadow(0 0 45px rgba(251,191,36,0.9)) drop-shadow(0 0 60px rgba(251,191,36,0.6));
    opacity: 1;
  }
}

@keyframes ramadan-dust-float {
  0%, 100% { transform: translateY(0) translateX(0); opacity: var(--dust-o); }
  33%      { transform: translateY(-8px) translateX(3px); opacity: calc(var(--dust-o) + 0.03); }
  66%      { transform: translateY(-4px) translateX(-3px); opacity: calc(var(--dust-o) + 0.02); }
}

@keyframes ramadan-star-twinkle {
  0%, 100% { opacity: var(--star-o); }
  50%      { opacity: calc(var(--star-o) + 0.15); }
}

@keyframes ramadan-moon-drift {
  0%, 100% { transform: translateY(0) scale(1); }
  50%      { transform: translateY(-8px) scale(1.02); }
}

@keyframes ramadan-moon-glow {
  0%, 90%, 100% {
    opacity: 0.2;
    filter: blur(20px);
  }
  10%, 80% {
    opacity: 0.45;
    filter: blur(30px);
  }
}

/* Disable all animations for reduced-motion users */
@media (prefers-reduced-motion: reduce) {
  .ramadan-sway,
  .ramadan-glow,
  .ramadan-dust,
  .ramadan-star,
  .ramadan-moon,
  .ramadan-light {
    animation: none !important;
  }
}
`;

/* ------------------------------------------------------------------ */
/*  Lantern configuration with varied positioning                     */
/* ------------------------------------------------------------------ */

interface LanternConfig {
  id: string;
  top: string;
  left: string;
  size: string; // Tailwind classes
  opacity: number;
  swayDuration: string;
  flickerDuration: string;
  glowSize: number; // blur radius in px
  visible: "always" | "sm" | "md" | "lg";
}

const LANTERN_CONFIGS: LanternConfig[] = [
  {
    id: "l1",
    top: "5vh",
    left: "8%",
    size: "w-16 sm:w-20",
    opacity: 0.9,
    swayDuration: "7s",
    flickerDuration: "4.5s",
    glowSize: 50,
    visible: "always",
  },
  {
    id: "l2",
    top: "25vh",
    left: "15%",
    size: "w-12 sm:w-16",
    opacity: 0.85,
    swayDuration: "8.5s",
    flickerDuration: "5s",
    glowSize: 42,
    visible: "always",
  },
  {
    id: "l3",
    top: "8vh",
    left: "75%",
    size: "w-14 sm:w-18",
    opacity: 0.88,
    swayDuration: "6.5s",
    flickerDuration: "4.8s",
    glowSize: 48,
    visible: "always",
  },
  {
    id: "l4",
    top: "32vh",
    left: "82%",
    size: "w-10 sm:w-14",
    opacity: 0.82,
    swayDuration: "9s",
    flickerDuration: "5.3s",
    glowSize: 38,
    visible: "sm",
  },
  {
    id: "l5",
    top: "12vh",
    left: "42%",
    size: "w-11 sm:w-15",
    opacity: 0.8,
    swayDuration: "7.8s",
    flickerDuration: "4.2s",
    glowSize: 40,
    visible: "md",
  },
  {
    id: "l6",
    top: "28vh",
    left: "55%",
    size: "w-9 sm:w-12",
    opacity: 0.78,
    swayDuration: "8.2s",
    flickerDuration: "5.5s",
    glowSize: 35,
    visible: "lg",
  },
];

/* ------------------------------------------------------------------ */
/*  Main overlay component                                             */
/* ------------------------------------------------------------------ */

export function RamadanDecorOverlay() {
  const stars = useStars(8);
  const dust = useDustParticles(12);

  return (
    <>
      {/* Inject keyframes */}
      <style dangerouslySetInnerHTML={{ __html: KEYFRAMES }} />

      <div
        className="absolute inset-0 pointer-events-none z-[1] overflow-hidden"
        aria-hidden="true"
        style={{ ["--ramadan-bg" as string]: "var(--screen-bg, #0a0a0a)" }}
      >
        {/* ============================================================ */}
        {/* LAYER 1: Back — Stars & Dust (lowest z-index)                */}
        {/* ============================================================ */}
        <div className="absolute inset-0" style={{ zIndex: 1 }}>
          {/* Stars */}
          {stars.map((star) => (
            <div
              key={`star-${star.id}`}
              className="ramadan-star absolute"
              style={{
                left: star.left,
                top: star.top,
                ["--star-o" as string]: star.opacity,
                animation: `ramadan-star-twinkle ${star.duration} ease-in-out infinite`,
                animationDelay: star.delay,
              }}
            >
              <Star4Point
                className={`opacity-${Math.round(star.opacity * 100)}`}
                style={{
                  width: star.size,
                  height: star.size,
                  filter: star.size < 4 ? "blur(0.5px)" : undefined,
                }}
              />
            </div>
          ))}

          {/* Dust particles */}
          {dust.map((particle) => (
            <div
              key={`dust-${particle.id}`}
              className="ramadan-dust absolute rounded-full"
              style={{
                left: particle.left,
                top: particle.top,
                width: particle.size,
                height: particle.size,
                background: "radial-gradient(circle, rgba(251,191,36,0.6) 0%, transparent 70%)",
                opacity: particle.opacity,
                ["--dust-o" as string]: particle.opacity,
                animation: `ramadan-dust-float ${particle.duration} ease-in-out infinite`,
                animationDelay: particle.delay,
                filter: `blur(${1.5 + (particle.size > 3 ? 1 : 0)}px)`,
              }}
            />
          ))}
        </div>

        {/* ============================================================ */}
        {/* LAYER 2: Mid — Hanging Lanterns                              */}
        {/* ============================================================ */}
        <div className="absolute inset-0" style={{ zIndex: 2 }}>
          {LANTERN_CONFIGS.map((config, idx) => {
            const visibilityClass =
              config.visible === "always"
                ? ""
                : config.visible === "sm"
                ? "hidden sm:block"
                : config.visible === "md"
                ? "hidden md:block"
                : "hidden lg:block";

            const lightDelay = idx * 2.5; // Sequential lighting delay

            return (
              <div
                key={config.id}
                className={`absolute ${visibilityClass}`}
                style={{
                  top: config.top,
                  left: config.left,
                }}
              >
                {/* Hanging chain/line from top */}
                <div
                  className="absolute bottom-full left-1/2 -translate-x-1/2"
                  style={{
                    width: "2px",
                    height: config.top, // Extends to top of viewport
                    background: "linear-gradient(to bottom, rgba(212,175,55,0.3) 0%, rgba(212,175,55,0.7) 100%)",
                    boxShadow: "0 0 4px rgba(251,191,36,0.3)",
                  }}
                />

                {/* Enhanced glow bloom layer */}
                <div
                  className="ramadan-glow absolute -inset-6 rounded-full"
                  style={{
                    background: "radial-gradient(circle, rgba(251,191,36,0.4) 0%, rgba(251,191,36,0.15) 50%, transparent 70%)",
                    filter: `blur(${config.glowSize}px)`,
                    animation: `ramadan-glow-flicker ${config.flickerDuration} ease-in-out infinite`,
                    animationDelay: `${parseFloat(config.swayDuration) * 0.3}s`,
                  }}
                />

                {/* Lantern SVG with sway and sequential lighting */}
                <div
                  className="ramadan-sway ramadan-light relative"
                  style={{
                    transformOrigin: "top center",
                    animation: `ramadan-lantern-sway ${config.swayDuration} ease-in-out infinite, ramadan-light-sequence 15s ease-in-out infinite`,
                    animationDelay: `0s, ${lightDelay}s`,
                    opacity: config.opacity,
                  }}
                >
                  <Lantern id={config.id} className={config.size} style={{}} />

                  {/* Enhanced light cone downward */}
                  <div
                    className="absolute top-full left-1/2 -translate-x-1/2"
                    style={{
                      width: 0,
                      height: 0,
                      borderLeft: "24px solid transparent",
                      borderRight: "24px solid transparent",
                      borderTop: "50px solid rgba(251,191,36,0.12)",
                      filter: "blur(10px)",
                    }}
                  />
                </div>
              </div>
            );
          })}

          {/* Crescent moon */}
          <div className="absolute top-10 right-8 sm:top-16 sm:right-16">
            {/* Animated moon glow behind SVG */}
            <div
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
              style={{
                width: '140%',
                height: '140%',
                zIndex: 0,
                background: 'radial-gradient(circle, rgba(253,230,138,0.4) 0%, transparent 70%)',
                borderRadius: '50%',
                animation: 'ramadan-moon-glow 15s ease-in-out infinite',
                animationDelay: '12.5s', // offset to sync with lanterns
              }}
            />
            <CrescentMoon
              className="ramadan-moon w-20 sm:w-24"
              style={{
                animation: "ramadan-moon-drift 14s ease-in-out infinite",
                filter: "drop-shadow(0 0 16px rgba(212,175,55,0.5))",
                position: 'relative',
                zIndex: 1,
              }}
            />
          </div>
        </div>

        {/* ============================================================ */}
        {/* LAYER 3: Front — Vignette & Center Fade Mask                 */}
        {/* ============================================================ */}
        <div className="absolute inset-0" style={{ zIndex: 3 }}>
          {/* Vignette */}
          <div
            className="absolute inset-0"
            style={{
              background: "radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.15) 100%)",
            }}
          />

          {/* Center fade mask — reduces decoration intensity near center */}
          <div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(ellipse 600px 400px at 50% 45%, rgba(0,0,0,0.3) 0%, transparent 60%)",
              mixBlendMode: "multiply",
            }}
          />
        </div>
      </div>
    </>
  );
}
