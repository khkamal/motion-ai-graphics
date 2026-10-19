import Link from "next/link";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Clapperboard,
  Disc3,
  Layers3,
  MoveUpRight,
  Play,
  Sparkles,
  Waves,
  Zap,
} from "lucide-react";

const featureItems = [
  { number: "01", title: "Image-aware motion", description: "Gemini reads the image, preserves what matters, and turns a short idea into an actionable motion brief.", icon: Sparkles },
  { number: "02", title: "A different visual signature", description: "Every generation gets a cryptographic seed, a new camera path, and freshly composed light and particle behavior.", icon: Disc3 },
  { number: "03", title: "Ready for the timeline", description: "Shape the preview, dial in speed and matte colors, then render a clean 4K UHD MP4 or QuickTime master.", icon: Layers3 },
];

export default function HomePage() {
  return (
    <main className="landing-page">
      <nav className="landing-nav" aria-label="Main navigation">
        <Link href="/" className="landing-brand">
          <span className="landing-brand-mark"><Clapperboard size={18} /></span>
          <span>MOTION <i>AI</i> STUDIO</span>
        </Link>
        <div className="landing-nav-right">
          <a href="#how-it-works">How it works</a>
          <a href="#features">Features</a>
          <Link className="landing-nav-cta" href="/dashboard">Open studio <ArrowUpRight size={14} /></Link>
        </div>
      </nav>

      <section className="landing-hero">
        <div className="hero-copy">
          <div className="hero-eyebrow"><span className="hero-eyebrow-dot" /> MOTION DESIGN, REIMAGINED <span>·</span> 01 / 03</div>
          <h1>Make stills<br />move <em>differently.</em></h1>
          <p className="hero-description">An image-to-motion playground for new camera paths, unexpected light, and expressive movement. Made for artists who don't want the same result twice.</p>
          <div className="hero-actions">
            <Link href="/dashboard" className="hero-primary-button">Start creating <ArrowRight size={16} /></Link>
            <a className="hero-secondary-button" href="#how-it-works"><span className="hero-play-icon"><Play size={12} fill="currentColor" /></span> Explore the studio</a>
          </div>
          <div className="hero-proof-row">
            <div className="hero-proof-avatars"><span>m</span><span>a</span><span>✳</span></div>
            <span>For curious makers &amp; motion artists</span>
            <span className="hero-proof-divider" />
            <span><span className="hero-status-dot" /> Browser-based studio</span>
          </div>
        </div>

        <div className="hero-art-area" aria-label="Abstract motion graphics preview">
          <div className="hero-art-grid" />
          <div className="hero-art-orbit orbit-one" />
          <div className="hero-art-orbit orbit-two" />
          <div className="hero-art-orbit orbit-three" />
          <div className="hero-art-glow glow-a" />
          <div className="hero-art-glow glow-b" />
          <div className="hero-art-orb"><div className="hero-art-orb-core" /><div className="orb-shine" /></div>
          <div className="hero-art-ribbon ribbon-one" />
          <div className="hero-art-ribbon ribbon-two" />
          <div className="hero-art-cursor"><MoveUpRight size={18} /></div>
          <div className="hero-art-caption"><span className="caption-pulse" /> GENERATED MOTION STUDY <span>·</span> 00:05</div>
          <div className="hero-art-note note-one"><Waves size={13} /><span>soft orbit</span><b>01</b></div>
          <div className="hero-art-note note-two"><Sparkles size={13} /><span>fresh variation</span><b>∞</b></div>
          <div className="hero-art-side-label">FIG. 01 &nbsp; / &nbsp; AURORA DRIFT</div>
        </div>
        <div className="hero-scroll-indicator"><span>SCROLL TO EXPLORE</span><ArrowDownRight size={14} /></div>
      </section>

      <section className="landing-manifesto" id="how-it-works">
        <div className="manifesto-label"><span className="section-index">01</span><span>THE CREATIVE LOOP</span></div>
        <div className="manifesto-copy"><p>Start with a still.<br /><em>Leave with a feeling.</em></p><span>Bring your image and an instinct. Motion AI Studio reads the visual language, then bends it into a fresh, editable direction you can actually build on.</span></div>
        <div className="manifesto-mark"><Zap size={24} /><span>IMAGE<br />IN / MOTION<br />OUT</span></div>
      </section>

      <section className="landing-features" id="features">
        <div className="features-header"><div><span className="eyebrow">THOUGHTFUL BY DESIGN</span><h2>More than a prompt box.</h2></div><p>A small, focused toolkit for exploring movement with intent — and getting the final file out the door.</p></div>
        <div className="feature-grid">
          {featureItems.map(({ number, title, description, icon: Icon }) => (
            <article className="feature-card" key={number}>
              <div className="feature-card-top"><span>{number} / 03</span><Icon size={17} /></div>
              <div className="feature-icon"><Icon size={19} /></div>
              <h3>{title}</h3>
              <p>{description}</p>
              <span className="feature-card-line" />
            </article>
          ))}
        </div>
      </section>

      <section className="landing-cta-section">
        <div className="landing-cta-orbit" />
        <span className="eyebrow">YOUR NEXT FRAME IS WAITING</span>
        <h2>Let the image<br /><em>take a breath.</em></h2>
        <Link href="/dashboard" className="hero-primary-button">Enter the studio <ArrowRight size={16} /></Link>
        <span className="landing-cta-aside"><Sparkles size={13} /> New variations, every time.</span>
      </section>

      <footer className="landing-footer">
        <Link href="/" className="landing-brand"><span className="landing-brand-mark"><Clapperboard size={16} /></span><span>MOTION <i>AI</i> STUDIO</span></Link>
        <span>Make something that moves.</span>
        <Link href="/dashboard">Open workspace <ArrowUpRight size={13} /></Link>
      </footer>
    </main>
  );
}
