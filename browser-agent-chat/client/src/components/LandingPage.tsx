import { useState } from 'react';
import './LandingPage.css';

interface LandingPageProps {
  onLaunchApp: () => void;
}

export function LandingPage({ onLaunchApp }: LandingPageProps) {
  const [email, setEmail] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Handle waitlist signup
    console.log('Waitlist signup:', email);
    setEmail('');
  };

  return (
    <div className="landing">
      {/* Navigation */}
      <nav className="landing-nav">
        <div className="nav-brand">
          <div className="brand-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="3" y="3" width="18" height="18" rx="4" stroke="currentColor" strokeWidth="2"/>
              <circle cx="8" cy="8" r="2" fill="currentColor"/>
              <circle cx="16" cy="8" r="2" fill="currentColor"/>
              <path d="M8 14C8 14 10 17 12 17C14 17 16 14 16 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </div>
          <span className="brand-name">Browser Agent</span>
        </div>
        <div className="nav-links">
          <a href="#features">Features</a>
          <a href="#how-it-works">How it Works</a>
          <a href="#pricing">Pricing</a>
          <button className="nav-cta" onClick={onLaunchApp}>Launch App</button>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="hero">
        <div className="hero-badge">
          <span className="badge-dot"></span>
          Now in Public Beta
        </div>
        <h1 className="hero-title">
          Automate your browser
          <br />
          <span className="gradient-text">with natural language</span>
        </h1>
        <p className="hero-subtitle">
          The AI-powered browser automation platform that understands what you want.
          <br />
          No code. No complex scripts. Just describe your task.
        </p>
        <div className="hero-actions">
          <button className="btn-primary" onClick={onLaunchApp}>
            Start Automating
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 8H13M13 8L8 3M13 8L8 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <button className="btn-secondary">
            Watch Demo
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <polygon points="6,4 12,8 6,12" fill="currentColor"/>
            </svg>
          </button>
        </div>
        <div className="hero-visual">
          <div className="browser-mockup">
            <div className="mockup-header">
              <div className="mockup-dots">
                <span></span><span></span><span></span>
              </div>
              <div className="mockup-url">browser-agent.ai</div>
            </div>
            <div className="mockup-content">
              <div className="mockup-chat">
                <div className="chat-message user">
                  <span>Fill out the contact form with my details</span>
                </div>
                <div className="chat-message agent">
                  <span className="typing-indicator">
                    <span></span><span></span><span></span>
                  </span>
                  <span>Filling out the form...</span>
                </div>
              </div>
              <div className="mockup-browser">
                <div className="form-skeleton">
                  <div className="skeleton-input active"></div>
                  <div className="skeleton-input"></div>
                  <div className="skeleton-input"></div>
                  <div className="skeleton-btn"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Logos Section */}
      <section className="logos">
        <p className="logos-title">Trusted by teams at</p>
        <div className="logos-grid">
          <div className="logo-item">Acme Corp</div>
          <div className="logo-item">TechStart</div>
          <div className="logo-item">DataFlow</div>
          <div className="logo-item">CloudNine</div>
          <div className="logo-item">Nexus</div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="features">
        <div className="section-header">
          <span className="section-tag">Features</span>
          <h2 className="section-title">Everything you need to automate</h2>
          <p className="section-subtitle">
            Powerful features that make browser automation accessible to everyone
          </p>
        </div>
        <div className="features-grid">
          <div className="feature-card">
            <div className="feature-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M21 15C21 15.5304 20.7893 16.0391 20.4142 16.4142C20.0391 16.7893 19.5304 17 19 17H7L3 21V5C3 4.46957 3.21071 3.96086 3.58579 3.58579C3.96086 3.21071 4.46957 3 5 3H19C19.5304 3 20.0391 3.21071 20.4142 3.58579C20.7893 3.96086 21 4.46957 21 5V15Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h3 className="feature-title">Natural Language Commands</h3>
            <p className="feature-desc">
              Just describe what you want in plain English. No coding or scripting required.
            </p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
                <path d="M12 6V12L16 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </div>
            <h3 className="feature-title">Real-time Execution</h3>
            <p className="feature-desc">
              Watch as the AI navigates and interacts with websites in real-time.
            </p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <rect x="3" y="11" width="18" height="10" rx="2" stroke="currentColor" strokeWidth="2"/>
                <circle cx="12" cy="16" r="2" stroke="currentColor" strokeWidth="2"/>
                <path d="M7 11V7C7 5.67392 7.52678 4.40215 8.46447 3.46447C9.40215 2.52678 10.6739 2 12 2C13.3261 2 14.5979 2.52678 15.5355 3.46447C16.4732 4.40215 17 5.67392 17 7V11" stroke="currentColor" strokeWidth="2"/>
              </svg>
            </div>
            <h3 className="feature-title">Enterprise Security</h3>
            <p className="feature-desc">
              Bank-grade encryption and SOC 2 compliance keep your data safe.
            </p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M4 4H10V10H4V4Z" stroke="currentColor" strokeWidth="2"/>
                <path d="M14 4H20V10H14V4Z" stroke="currentColor" strokeWidth="2"/>
                <path d="M4 14H10V20H4V14Z" stroke="currentColor" strokeWidth="2"/>
                <path d="M14 14H20V20H14V14Z" stroke="currentColor" strokeWidth="2"/>
              </svg>
            </div>
            <h3 className="feature-title">Workflow Templates</h3>
            <p className="feature-desc">
              Start fast with pre-built templates for common automation tasks.
            </p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M2 17L12 22L22 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M2 12L12 17L22 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h3 className="feature-title">API Integration</h3>
            <p className="feature-desc">
              Connect with your existing tools through our powerful REST API.
            </p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M17 21V19C17 17.9391 16.5786 16.9217 15.8284 16.1716C15.0783 15.4214 14.0609 15 13 15H5C3.93913 15 2.92172 15.4214 2.17157 16.1716C1.42143 16.9217 1 17.9391 1 19V21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="2"/>
                <path d="M23 21V19C22.9993 18.1137 22.7044 17.2528 22.1614 16.5523C21.6184 15.8519 20.8581 15.3516 20 15.13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M16 3.13C16.8604 3.35031 17.623 3.85071 18.1676 4.55232C18.7122 5.25392 19.0078 6.11683 19.0078 7.005C19.0078 7.89318 18.7122 8.75608 18.1676 9.45769C17.623 10.1593 16.8604 10.6597 16 10.88" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h3 className="feature-title">Team Collaboration</h3>
            <p className="feature-desc">
              Share automations across your team with role-based access control.
            </p>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section id="how-it-works" className="how-it-works">
        <div className="section-header">
          <span className="section-tag">How It Works</span>
          <h2 className="section-title">Three steps to automation</h2>
          <p className="section-subtitle">
            Get started in minutes, not hours
          </p>
        </div>
        <div className="steps">
          <div className="step">
            <div className="step-number">01</div>
            <div className="step-content">
              <h3>Enter a URL</h3>
              <p>Paste any website URL where you want the agent to work</p>
            </div>
          </div>
          <div className="step-connector"></div>
          <div className="step">
            <div className="step-number">02</div>
            <div className="step-content">
              <h3>Describe your task</h3>
              <p>Tell the agent what you want to accomplish in plain language</p>
            </div>
          </div>
          <div className="step-connector"></div>
          <div className="step">
            <div className="step-number">03</div>
            <div className="step-content">
              <h3>Watch it work</h3>
              <p>The AI executes your task while you watch in real-time</p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="pricing">
        <div className="section-header">
          <span className="section-tag">Pricing</span>
          <h2 className="section-title">Simple, transparent pricing</h2>
          <p className="section-subtitle">
            Start free, scale as you grow
          </p>
        </div>
        <div className="pricing-grid">
          <div className="pricing-card">
            <div className="pricing-header">
              <h3>Starter</h3>
              <div className="price">
                <span className="amount">$0</span>
                <span className="period">/month</span>
              </div>
            </div>
            <ul className="pricing-features">
              <li><span className="check">✓</span> 100 tasks/month</li>
              <li><span className="check">✓</span> Basic templates</li>
              <li><span className="check">✓</span> Community support</li>
            </ul>
            <button className="btn-secondary full-width">Get Started</button>
          </div>
          <div className="pricing-card featured">
            <div className="featured-badge">Most Popular</div>
            <div className="pricing-header">
              <h3>Pro</h3>
              <div className="price">
                <span className="amount">$49</span>
                <span className="period">/month</span>
              </div>
            </div>
            <ul className="pricing-features">
              <li><span className="check">✓</span> Unlimited tasks</li>
              <li><span className="check">✓</span> All templates</li>
              <li><span className="check">✓</span> Priority support</li>
              <li><span className="check">✓</span> API access</li>
              <li><span className="check">✓</span> Team sharing</li>
            </ul>
            <button className="btn-primary full-width">Start Free Trial</button>
          </div>
          <div className="pricing-card">
            <div className="pricing-header">
              <h3>Enterprise</h3>
              <div className="price">
                <span className="amount">Custom</span>
              </div>
            </div>
            <ul className="pricing-features">
              <li><span className="check">✓</span> Everything in Pro</li>
              <li><span className="check">✓</span> SSO & SAML</li>
              <li><span className="check">✓</span> Dedicated support</li>
              <li><span className="check">✓</span> Custom integrations</li>
              <li><span className="check">✓</span> SLA guarantee</li>
            </ul>
            <button className="btn-secondary full-width">Contact Sales</button>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="cta">
        <div className="cta-content">
          <h2>Ready to automate?</h2>
          <p>Join thousands of teams using Browser Agent to save hours every week.</p>
          <form className="cta-form" onSubmit={handleSubmit}>
            <input
              type="email"
              placeholder="Enter your email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <button type="submit" className="btn-primary">
              Get Early Access
            </button>
          </form>
        </div>
      </section>

      {/* Footer */}
      <footer className="footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="brand-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="3" y="3" width="18" height="18" rx="4" stroke="currentColor" strokeWidth="2"/>
                <circle cx="8" cy="8" r="2" fill="currentColor"/>
                <circle cx="16" cy="8" r="2" fill="currentColor"/>
                <path d="M8 14C8 14 10 17 12 17C14 17 16 14 16 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </div>
            <span>Browser Agent</span>
          </div>
          <div className="footer-links">
            <a href="#">Privacy</a>
            <a href="#">Terms</a>
            <a href="#">Documentation</a>
            <a href="https://github.com">GitHub</a>
          </div>
          <p className="footer-copy">© 2026 Browser Agent. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
