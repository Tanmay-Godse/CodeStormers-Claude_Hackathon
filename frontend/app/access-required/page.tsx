import Link from "next/link";

type AccessRequiredPageProps = {
  searchParams: Promise<{
    username?: string;
  }>;
};

export default async function AccessRequiredPage({
  searchParams,
}: AccessRequiredPageProps) {
  const resolvedSearchParams = await searchParams;
  const requestedUsername = resolvedSearchParams.username;

  return (
    <main className="page-shell auth-shell">
      <div className="page-inner auth-compact-page">
        <section className="auth-compact-shell">
          <article className="panel auth-login-card">
            <div className="auth-login-brand">
              <div className="brand">
                <span className="brand-mark">AC</span>
                <span>Clinical Curator</span>
              </div>
              <span className="pill">Legacy link</span>
            </div>

            <div className="auth-stage-copy">
              <span className="eyebrow">Legacy route</span>
              <h1 className="auth-login-title">This link is no longer required.</h1>
              <p className="auth-login-copy">
                Account creation now happens directly on the login page. Older links can
                still land here, but the current flow starts from `/login`.
              </p>
            </div>

            <div className="feedback-block">
              <div className="feedback-header">
                <strong>Requested username</strong>
                <span className="pill">legacy redirect</span>
              </div>
              <p className="feedback-copy" style={{ marginTop: 12 }}>
                {requestedUsername?.trim()
                  ? requestedUsername
                  : "No username was provided in the request."}
              </p>
            </div>

            <div className="feedback-block">
              <div className="feedback-header">
                <strong>Next step</strong>
                <span className="pill">self-service enabled</span>
              </div>
              <p className="feedback-copy" style={{ marginTop: 12 }}>
                Go back to `/login` and sign in with an existing account, or create a new one.
              </p>
            </div>

            <div className="button-row" style={{ marginTop: 16 }}>
              <Link className="button-primary" href="/login">
                Back to Login
              </Link>
            </div>
          </article>
        </section>
      </div>
    </main>
  );
}
