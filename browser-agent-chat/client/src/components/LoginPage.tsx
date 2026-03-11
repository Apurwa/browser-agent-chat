import { useAuth } from '../hooks/useAuth';

export default function LoginPage() {
  const { signInWithGoogle, signInWithGitHub } = useAuth();

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <span className="login-logo-accent">QA</span> Agent
        </div>
        <p className="login-tagline">AI-powered QA testing for your SaaS</p>

        <div className="login-buttons">
          <button className="login-btn login-btn-google" onClick={signInWithGoogle}>
            Continue with Google
          </button>
          <button className="login-btn login-btn-github" onClick={signInWithGitHub}>
            Continue with GitHub
          </button>
        </div>

        <p className="login-terms">By signing in, you agree to our Terms of Service</p>
      </div>
    </div>
  );
}
