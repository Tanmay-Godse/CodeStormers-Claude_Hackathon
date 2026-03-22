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
              <span className="pill">Demo access only</span>
            </div>

            <div className="auth-stage-copy">
              <span className="eyebrow">Access required</span>
              <h1 className="auth-login-title">Please contact the developers.</h1>
              <p className="auth-login-copy">
                This project is still in demo stage, so new emails are created only
                by the developer team. We locked account creation to reduce API abuse
                while the repo is public.
              </p>
            </div>

            <div className="feedback-block">
              <div className="feedback-header">
                <strong>Requested username</strong>
                <span className="pill">developer managed</span>
              </div>
              <p className="feedback-copy" style={{ marginTop: 12 }}>
                {requestedUsername?.trim()
                  ? requestedUsername
                  : "No username was provided in the request."}
              </p>
            </div>

            <div className="feedback-block">
              <div className="feedback-header">
                <strong>Contact path</strong>
                <span className="pill">demo support</span>
              </div>
              <p className="feedback-copy" style={{ marginTop: 12 }}>
                Ask the developer team to create a fixed demo email for testing.
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
