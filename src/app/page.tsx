"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { PageShell } from "@/components/PageShell";

// Background Signal Flow Component
function BackgroundSignalFlow() {
  return (
    <div className="fixed inset-0 w-full h-full pointer-events-none overflow-hidden" style={{ zIndex: 0 }}>
      {/* Signal flow layer 1 - top third */}
      <div 
        className="signal-flow absolute top-[20%] left-0 w-[200%] h-[120px]"
        style={{
          background: 'linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.12) 20%, rgba(0,0,0,0.2) 50%, rgba(0,0,0,0.12) 80%, transparent 100%)',
          filter: 'blur(40px)',
          animation: 'signalFlow 35s linear infinite'
        }}
      />
      
      {/* Signal flow layer 2 - middle */}
      <div 
        className="signal-flow absolute top-[45%] left-0 w-[180%] h-[100px]"
        style={{
          background: 'linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.1) 25%, rgba(0,0,0,0.18) 50%, rgba(0,0,0,0.1) 75%, transparent 100%)',
          filter: 'blur(50px)',
          animation: 'signalFlowSlow 42s linear infinite'
        }}
      />
      
      {/* Signal flow layer 3 - lower */}
      <div 
        className="signal-flow absolute top-[65%] left-0 w-[160%] h-[90px]"
        style={{
          background: 'linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.08) 30%, rgba(0,0,0,0.16) 50%, rgba(0,0,0,0.08) 70%, transparent 100%)',
          filter: 'blur(45px)',
          animation: 'signalFlowOffset 28s linear infinite'
        }}
      />
    </div>
  );
}

// Animated SVG Logo Component
function AnimatedLogo() {
  return (
    <div className="relative flex flex-col items-center">
      <div className="relative overflow-hidden">
        <svg 
          width="400" 
          height="400" 
          viewBox="380 360 260 300" 
          xmlns="http://www.w3.org/2000/svg"
          className="drop-shadow-xl"
          style={{ animation: 'logoSettle 0.3s ease-out 2.2s forwards' }}
        >
          {/* First path - R top */}
          <path 
            fill="none"
            stroke="#000000"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M591.790161,470.710052 C595.401245,435.890015 571.340820,410.132355 545.288147,404.857941 C540.715820,403.932251 536.115967,403.362701 531.422974,403.367126 C490.434326,403.405914 449.445618,403.388428 408.456940,403.377197 C401.589630,403.375336 401.589417,403.351990 401.606079,396.438965 C401.607697,395.772491 401.615356,395.106049 401.618378,394.439575 C401.670074,383.043549 401.669983,383.064362 413.347260,383.064789 C452.336456,383.066284 491.325684,383.064117 530.314880,383.038605 C558.050598,383.020447 580.708191,393.760345 596.907898,416.241974 C631.090088,463.679413 606.471802,532.942322 544.897095,543.030762 C531.875732,545.164246 518.616455,543.820862 505.466492,544.036804 C498.970551,544.143555 492.470032,543.939941 485.972656,543.998169 C472.225037,544.121399 465.371155,551.292542 465.392212,565.217896 C465.426727,588.033997 465.214569,610.852112 465.479309,633.665039 C465.540161,638.907471 463.661835,640.175232 458.850128,640.142334 C445.665436,640.052246 445.695068,640.212341 445.599426,626.885620 C445.455994,606.896790 445.149323,586.908447 445.129852,566.919617 C445.114410,551.083435 450.574097,537.891907 464.692047,529.386841 C470.941864,525.621704 477.786194,523.716309 485.136963,523.721680 C502.132233,523.734253 519.129700,523.876892 536.122314,523.657410 C564.206787,523.294861 589.612671,499.210602 591.790161,470.710052z"
            style={{
              strokeDasharray: 4000,
              strokeDashoffset: 4000,
              animation: 'drawStroke 1.5s ease-out forwards, fillIn 0.5s ease-out 1.5s forwards'
            }}
          />
          
          {/* Second path - R middle */}
          <path 
            fill="none"
            stroke="#000000"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M539.896484,517.289734 C521.478882,518.449158 503.466431,518.228760 485.491852,517.762268 C462.700287,517.170715 443.240112,533.649780 439.766754,555.712524 C439.406525,558.000671 439.318420,560.351135 439.314819,562.672974 C439.278015,586.337524 439.292603,610.002014 439.274445,633.666565 C439.269684,639.868958 439.053436,640.156128 432.782318,640.089722 C416.479431,639.916992 418.953979,641.981506 418.859741,626.463928 C418.734253,605.799927 418.811462,585.134521 418.839996,564.469727 C418.885651,531.395508 442.186127,503.645813 474.671417,497.993561 C476.462952,497.681824 478.319794,497.676544 480.147797,497.653778 C497.973938,497.431763 515.801880,497.319916 533.626404,497.009460 C550.597229,496.713898 563.885864,485.068573 565.653992,469.181488 C567.742554,450.415802 557.546997,434.759247 540.437256,430.859741 C536.908630,430.055511 533.164612,429.967529 529.517578,429.946594 C489.193481,429.715179 448.868988,429.561462 408.544586,429.388641 C401.653778,429.359131 401.653717,429.363251 401.635254,422.523865 C401.600739,409.721283 401.600800,409.724762 414.588806,409.721710 C453.585297,409.712555 492.581757,409.680389 531.578247,409.696106 C560.721619,409.707825 583.221863,430.117889 585.992249,460.250061 C588.388062,486.307678 571.251221,510.528564 543.745300,516.511475 C542.607971,516.758850 541.470825,517.007202 539.896484,517.289734z"
            style={{
              strokeDasharray: 4000,
              strokeDashoffset: 4000,
              animation: 'drawStroke 1.5s ease-out 0.2s forwards, fillIn 0.5s ease-out 1.7s forwards'
            }}
          />
          
          {/* Third path - R leg diagonal 1 */}
          <path 
            fill="none"
            stroke="#000000"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M571.481506,617.509583 C551.512207,595.701294 531.785828,574.147583 511.595520,552.086975 C516.568726,549.872803 520.754517,551.341064 524.717285,550.742615 C533.517090,549.413940 539.540100,552.579102 545.645325,559.476135 C568.259033,585.023010 591.755615,609.788330 614.899719,634.866394 C615.974121,636.030579 617.574707,636.936646 617.378967,639.481812 C609.202881,640.288879 600.975220,640.144043 592.747925,639.565063 C590.949280,639.438538 589.999207,637.793640 588.888733,636.581665 C583.153015,630.322266 577.443298,624.039062 571.481506,617.509583z"
            style={{
              strokeDasharray: 2000,
              strokeDashoffset: 2000,
              animation: 'drawStroke 1.5s ease-out 0.4s forwards, fillIn 0.5s ease-out 1.9s forwards'
            }}
          />
          
          {/* Fourth path - R leg diagonal 2 */}
          <path 
            fill="none"
            stroke="#000000"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M510.953918,590.039307 C499.384796,577.452332 488.050812,565.130432 476.103607,552.141968 C481.446594,550.060669 485.827484,551.417664 489.961426,550.754150 C498.560394,549.373840 504.305084,552.892822 510.031067,559.339600 C532.580750,584.727905 555.740845,609.573914 578.661560,634.632996 C579.757629,635.831299 580.731567,637.141418 581.872864,638.534363 C579.377014,641.031555 576.567505,639.684326 574.107727,640.101196 C561.955444,642.160706 553.315430,637.674744 545.531860,627.905334 C534.978394,614.659363 522.717529,602.773682 510.953918,590.039307z"
            style={{
              strokeDasharray: 2000,
              strokeDashoffset: 2000,
              animation: 'drawStroke 1.5s ease-out 0.6s forwards, fillIn 0.5s ease-out 2.1s forwards'
            }}
          />
        </svg>
        
        {/* Sheen sweep effect */}
        <div 
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.35) 50%, transparent 100%)',
            width: '30%',
            height: '100%',
            animation: 'sheen 0.7s ease-out 2.2s forwards'
          }}
        />
      </div>
      
      {/* Brand wordmark only */}
      <div className="text-center mt-4">
        <div className="text-6xl font-bold tracking-tight">rytm</div>
      </div>
    </div>
  );
}

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    // Check if user has a session
    const checkSession = async () => {
      try {
        const resp = await fetch('/api/auth/session');
        const json = await resp.json();
        if (json?.session?.user) {
          // User is logged in, redirect to dashboard
          router.replace('/dashboard');
        }
      } catch (err) {
        // Ignore errors, show home page
      }
    };
    checkSession();
  }, [router]);

  return (
    <PageShell navbarVariant="floating" contentOffsetClass="pt-20">
      <div className="relative flex flex-col overflow-hidden">
        {/* Subtle signal flow background */}
        <BackgroundSignalFlow />

        {/* Hero content - two column layout */}
        <div className="flex-1 flex items-center justify-center px-8 py-12">
          <div className="max-w-6xl w-full mx-auto grid md:grid-cols-2 gap-16 items-center">
          {/* Left column - Text content */}
          <div className="space-y-8">
            {/* Kicker + Headline + Description */}
            <div className="space-y-5">
              <div className="text-xs font-bold tracking-widest text-zinc-500 uppercase">
                Performance in Sync
              </div>
              <h1 className="text-7xl md:text-8xl font-bold tracking-tight leading-[0.95]">
                Master your flow.
              </h1>
              <p className="text-xl text-zinc-600 leading-relaxed max-w-lg">
                rytm brings together your physical signals, mental state, and daily context, all to help you capture the full rhythm behind your performance.
              </p>
            </div>

            {/* Pill chips */}
            <div className="flex flex-wrap gap-2">
              <span className="px-4 py-2 text-sm text-zinc-600 border border-zinc-300 rounded-full">
                Daily check-ins
              </span>
              <span className="px-4 py-2 text-sm text-zinc-600 border border-zinc-300 rounded-full">
                Nutrition tracking
              </span>
              <span className="px-4 py-2 text-sm text-zinc-600 border border-zinc-300 rounded-full">
                Journaling
              </span>
            </div>

            {/* CTA buttons */}
            <div className="flex items-center gap-4 pt-4">
              <Link href="/sign-up">
                <button className="group px-8 py-4 text-base font-semibold bg-black text-white rounded-full hover:bg-zinc-900 transition-all hover:shadow-lg hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-2 flex items-center gap-2">
                  Get started
                  <span className="group-hover:translate-x-0.5 transition-transform">→</span>
                </button>
              </Link>
              <Link href="/sign-in">
                <button className="px-8 py-4 text-base font-semibold text-black border border-zinc-300 rounded-full hover:bg-zinc-50 transition-all hover:shadow-md hover:-translate-y-0.5">
                  Log in
                </button>
              </Link>
            </div>
          </div>

          {/* Right column - Brand visual */}
          <div className="hidden md:flex items-center justify-center relative">
            {/* Animated SVG Logo with entrance animation */}
            <div className="relative z-10 animate-logo-entrance">
              <AnimatedLogo />
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="py-6 text-center border-t border-zinc-200">
        <p className="text-xs text-zinc-500">
          Master your flow • Privacy-first • Built for performance
        </p>
      </footer>
      </div>
    </PageShell>
  );
}
