import './LoginPage.css';

interface LoginPageProps {
  onSignIn: () => void;
  accessDenied?: boolean;
  onSignOut?: () => void;
}

export function LoginPage({ onSignIn, accessDenied, onSignOut }: LoginPageProps) {
  return (
    <div className="login-page">
      <div className="login-card">
        <h1>Browser Agent Chat</h1>
        <p>Sign in to get started</p>

        {accessDenied ? (
          <div className="access-denied">
            <p>Your GitHub account is not authorized to access this app.</p>
            {onSignOut && (
              <button onClick={onSignOut} className="login-btn secondary">
                Sign out and try another account
              </button>
            )}
          </div>
        ) : (
          <button onClick={onSignIn} className="login-btn">
            Sign in with GitHub
          </button>
        )}
      </div>
    </div>
  );
}
