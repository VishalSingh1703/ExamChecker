import frustratedVideo from '../visuals/frustrated.mp4';
import satisfiedVideo from '../visuals/satisfied.mp4';

// ── Video section ─────────────────────────────────────────────────────────────

interface VideoSectionProps {
  src: string;
  heading: string;
  subheading: string;
  bullets: { icon: string; text: string }[];
  gradientFrom: string; // Tailwind gradient-from colour
  accent: string; // Tailwind colour for icon/highlight
}

function VideoSection({ src, heading, subheading, bullets, gradientFrom, accent }: VideoSectionProps) {
  return (
    <section className="relative h-dvh w-full overflow-hidden">
      {/* Full-bleed video — object-position keeps the subject centred on portrait/mobile */}
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

      {/* Gradient: top-to-bottom on mobile (full overlay), left-to-right on desktop */}
      <div className={`absolute inset-0 bg-black/60 sm:bg-transparent`} />
      <div className={`absolute inset-0 hidden sm:block bg-gradient-to-r ${gradientFrom} via-black/50 to-transparent`} />

      {/* Text overlay — full width on mobile, left half on desktop */}
      <div className="absolute inset-0 flex items-center">
        <div className="w-full sm:w-[55%] px-5 sm:px-14 md:px-20 pt-20 pb-10 sm:py-16">
          <h2 className="text-2xl sm:text-4xl md:text-5xl font-bold text-white leading-tight mb-3 drop-shadow-md">
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

      {/* Subtle scroll hint */}
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
      {/* ── Fixed nav ──────────────────────────────────────────────────────── */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-5 sm:px-10 py-4 bg-gradient-to-b from-black/70 to-transparent">
        <span className="text-white font-bold text-lg tracking-tight">Exam Checker</span>
        <button
          onClick={onGetStarted}
          className="bg-white text-black text-sm font-semibold px-5 py-2 rounded-full hover:bg-gray-100 active:scale-95 transition-all shadow-lg"
        >
          Get Started
        </button>
      </nav>

      {/* ── Section 1: frustrated ───────────────────────────────────────────── */}
      <VideoSection
        src={frustratedVideo}
        gradientFrom="from-black/85"
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

      {/* ── Section 2: satisfied ───────────────────────────────────────────── */}
      <VideoSection
        src={satisfiedVideo}
        gradientFrom="from-black/85"
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

      {/* ── Final CTA ──────────────────────────────────────────────────────── */}
      <section className="bg-black py-24 sm:py-32 flex flex-col items-center text-center px-6">
        <div className="w-16 h-0.5 bg-white/20 mb-10" />
        <h2 className="text-3xl sm:text-5xl font-bold text-white mb-5 max-w-2xl leading-tight tracking-tight">
          Give your time back to teaching.
        </h2>
        <p className="text-gray-400 text-base sm:text-lg mb-10 max-w-md leading-relaxed">
          Exam Checker handles the grading so you can focus on what matters — guiding your students.
        </p>
        <button
          onClick={onGetStarted}
          className="bg-white text-black font-semibold text-sm px-10 py-4 rounded-full hover:bg-gray-100 active:scale-95 transition-all shadow-2xl mb-4 tracking-wide uppercase"
        >
          Get Started — It's Free
        </button>
        <p className="text-gray-600 text-sm">No credit card required · Works on any device</p>

        <div className="w-16 h-0.5 bg-white/20 mt-14 mb-6" />
        <p className="text-gray-700 text-xs">© {new Date().getFullYear()} Vishal Singh. All rights reserved.</p>
      </section>
    </div>
  );
}
