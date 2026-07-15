import frustratedVideo from './frustrated.mp4';
import satisfiedVideo from './satisfied.mp4';
import { Logo, Wordmark } from '../../app/AppShell';

// ── Video section ─────────────────────────────────────────────────────────────

interface VideoSectionProps {
  src: string;
  heading: string;
  subheading: string;
  bullets: { icon: string; text: string }[];
  accent: string;
}

function VideoSection({ src, heading, subheading, bullets, accent }: VideoSectionProps) {
  return (
    <section className="relative h-dvh w-full overflow-hidden">
      <video
        src={src}
        className="absolute inset-0 w-full h-full object-cover object-center"
        autoPlay
        loop
        muted
        playsInline
        disablePictureInPicture
        style={{ WebkitTransform: 'translateZ(0)' }}
      />

      <div className="absolute inset-0 bg-black/60 sm:bg-transparent" />
      <div className="absolute inset-0 hidden sm:block bg-gradient-to-r from-black/85 via-black/50 to-transparent" />

      <div className="absolute inset-0 flex items-center">
        <div className="w-full sm:w-[55%] px-5 sm:px-14 md:px-20 pt-20 pb-10 sm:py-16">
          <h2 className="font-display text-2xl sm:text-4xl md:text-5xl font-semibold text-white leading-tight mb-3 drop-shadow-md tracking-tight whitespace-pre-line">
            {heading}
          </h2>
          <p className="text-sm sm:text-lg text-gray-300 mb-5 sm:mb-8 leading-relaxed max-w-md drop-shadow">
            {subheading}
          </p>
          <ul className="space-y-2 sm:space-y-3">
            {bullets.map((b, i) => (
              <li key={i} className="flex items-start gap-2 sm:gap-3">
                <span className={`text-sm sm:text-base font-bold ${accent} drop-shadow mt-0.5 shrink-0 w-4`}>{b.icon}</span>
                <span className="text-xs sm:text-base text-gray-200 leading-snug">{b.text}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 text-white/40 text-xs pointer-events-none">
        <span>scroll</span>
        <svg className="w-4 h-4 animate-bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </div>
    </section>
  );
}

// ── Main landing page ─────────────────────────────────────────────────────────

export function LandingPage({ onGetStarted }: { onGetStarted: () => void }) {
  return (
    <div className="bg-black">
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-5 sm:px-10 py-4 bg-gradient-to-b from-black/70 to-transparent">
        <div className="flex items-center gap-2.5">
          <Logo className="w-8 h-8" />
          <Wordmark light />
        </div>
        <button
          onClick={onGetStarted}
          className="bg-ink-50 text-ink-900 text-sm font-semibold px-5 py-2 rounded-full hover:bg-white active:scale-95 transition-all shadow-lg"
        >
          Get Started
        </button>
      </nav>

      <VideoSection
        src={frustratedVideo}
        accent="text-red-400"
        heading={`Manual grading is\ncosting you more than time.`}
        subheading="Every evening. Stack after stack. By the time you're done, fatigue has already compromised your accuracy — and your students deserve better."
        bullets={[
          { icon: '—', text: 'Hours spent on repetitive tasks that add no instructional value' },
          { icon: '—', text: 'Fatigue-driven inconsistency undermines fair assessment' },
          { icon: '—', text: 'No structured data to track individual student progress over time' },
          { icon: '—', text: 'A growing backlog that delays feedback when it matters most' },
        ]}
      />

      <VideoSection
        src={satisfiedVideo}
        accent="text-emerald-400"
        heading="Intelligent grading. Instant results."
        subheading="Photograph the answer sheet. Our AI reads the handwriting, evaluates every response, and generates a detailed report — in seconds, not hours."
        bullets={[
          { icon: '→', text: 'Grade an entire class in the time it once took to mark a single paper' },
          { icon: '→', text: 'AI-powered handwriting recognition that is accurate, consistent, and tireless' },
          { icon: '→', text: "Longitudinal tracking of each student's performance across exams and terms" },
          { icon: '→', text: 'Print-ready or shareable reports generated with a single click' },
        ]}
      />

      {/* ── Final CTA — a sheet of graded paper ─────────────────────────────── */}
      <section className="bg-ink-50 bg-desk py-24 sm:py-32 px-6">
        <div className="relative max-w-2xl mx-auto bg-white border border-ink-200 rounded-xl shadow-lift bg-ruled px-8 sm:px-16 py-16 sm:py-20 text-center">
          {/* Red-pen grade stamp */}
          <div
            className="absolute -top-6 -right-4 sm:-right-8 w-20 h-20 rounded-full border-[3px] border-red-600/80 flex items-center justify-center rotate-[-6deg] bg-white/70 backdrop-blur-[1px]"
            aria-hidden="true"
          >
            <span className="font-hand text-4xl font-bold text-red-600/90 leading-none">A+</span>
          </div>

          <p className="font-hand text-2xl text-accent-700 mb-2">Dear teacher,</p>
          <h2 className="font-display text-3xl sm:text-5xl font-semibold text-ink-900 mb-5 leading-tight tracking-tight">
            Give your time back to teaching.
          </h2>
          <p className="text-ink-500 text-base sm:text-lg mb-10 max-w-md mx-auto leading-relaxed">
            ExamChecker handles the grading so you can focus on what matters — guiding your students.
          </p>
          <button
            onClick={onGetStarted}
            className="bg-accent-700 text-accent-50 font-semibold text-sm px-10 py-4 rounded-lg border border-accent-900/60 shadow-lift hover:bg-accent-800 active:shadow-none active:translate-x-[2px] active:translate-y-[2px] transition-all mb-4 tracking-wide uppercase"
          >
            Get Started — It's Free
          </button>
          <p className="text-ink-400 text-sm">No credit card required · Works on any device</p>
        </div>

        <p className="text-ink-400 text-xs text-center mt-12">© {new Date().getFullYear()} Vishal Singh. All rights reserved.</p>
      </section>
    </div>
  );
}
