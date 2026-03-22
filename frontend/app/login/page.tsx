"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { FormEvent } from "react";
import { Suspense, useEffect, useState } from "react";

import {
  clearAuthUser,
  getAuthUser,
  previewAuthAccount,
  refreshAuthUser,
  signInAuthUser,
} from "@/lib/storage";
import type { AuthUser, UserRole } from "@/lib/types";

type AuthStep = "identify" | "sign-in";

type PreviewedAccount = {
  adminApprovalStatus: AuthUser["adminApprovalStatus"];
  isDeveloper: boolean;
  isSeeded: boolean;
  liveSessionLimit?: number | null;
  liveSessionRemaining?: number | null;
  liveSessionUsed: number;
  name: string;
  role: UserRole;
  requestedRole?: "admin" | null;
  username: string;
};

const JUDGE_DEMO_ACCOUNTS = [
  "Student_1@gmail.com",
  "Student_2@gmail.com",
  "Student_3@gmail.com",
  "Student_4@gmail.com",
] as const;

function getDefaultDestination(account: Pick<AuthUser, "isDeveloper" | "role">) {
  if (account.isDeveloper) {
    return "/developer/approvals";
  }

  return account.role === "admin" ? "/admin/reviews" : "/dashboard";
}

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedRoleParam = searchParams.get("role");
  const requestedRole: UserRole | null =
    requestedRoleParam === "admin" || requestedRoleParam === "student"
      ? requestedRoleParam
      : null;
  const nextPath = searchParams.get("next");

  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [step, setStep] = useState<AuthStep>("identify");
  const [identifier, setIdentifier] = useState("");
  const [previewedAccount, setPreviewedAccount] = useState<PreviewedAccount | null>(
    null,
  );
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function resolveDestination(targetAccount: Pick<AuthUser, "isDeveloper" | "role">) {
    if (requestedRole && targetAccount.role === requestedRole) {
      return nextPath ?? getDefaultDestination(targetAccount);
    }

    if (!requestedRole && nextPath) {
      return nextPath;
    }

    return getDefaultDestination(targetAccount);
  }

  useEffect(() => {
    let cancelled = false;
    const initialUser = getAuthUser();
    setCurrentUser(initialUser);

    if (!initialUser) {
      return () => {
        cancelled = true;
      };
    }

    void refreshAuthUser()
      .then((nextUser) => {
        if (!cancelled) {
          setCurrentUser(nextUser);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCurrentUser(initialUser);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const requestedRoleMismatch =
    currentUser && requestedRole ? currentUser.role !== requestedRole : false;

  async function handleIdentify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const matchedAccount = await previewAuthAccount(identifier);

      if (matchedAccount) {
        setPreviewedAccount(matchedAccount);
        setPassword("");
        setStep("sign-in");
      } else {
        router.push(
          `/access-required?username=${encodeURIComponent(identifier.trim())}`,
        );
      }
    } catch (lookupError) {
      setError(
        lookupError instanceof Error
          ? lookupError.message
          : "We could not look up that workspace account.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const user = await signInAuthUser({
        username: previewedAccount?.username ?? identifier,
        password,
      });
      setCurrentUser(user);
      router.push(resolveDestination(user));
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Sign-in failed. Check your account details and try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleContinue() {
    if (!currentUser) {
      return;
    }

    router.push(resolveDestination(currentUser));
  }

  function handleSignOut() {
    clearAuthUser();
    setCurrentUser(null);
    setPreviewedAccount(null);
    setError(null);
    setStep("identify");
    setIdentifier("");
    setPassword("");
  }

  function handleBack() {
    setError(null);
    setPassword("");
    setStep("identify");
  }

  const cardTitle =
    step === "identify"
      ? "Welcome back"
      : "Enter your password";

  const cardCopy =
    step === "identify"
      ? "Enter one of the fixed demo usernames below. Self-service signup is disabled while the project is deployed publicly, so unknown usernames are routed back to the developer team."
      : "This workspace uses fixed demo accounts with live-session limits. Enter the password for the matched username to continue.";

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
              <span className="pill">Workspace sign-in</span>
            </div>

            <div className="auth-stage-copy">
              <span className="eyebrow">Secure entry</span>
              <h1 className="auth-login-title">{cardTitle}</h1>
              <p className="auth-login-copy">{cardCopy}</p>
            </div>

            <div className="auth-flow-meta">
              <span className="pill">
                {requestedRole ? `${requestedRole} route` : "adaptive route"}
              </span>
              <span className="pill">
                {requestedRole
                  ? resolveDestination({ isDeveloper: false, role: requestedRole })
                  : "match workspace after sign-in"}
              </span>
            </div>

            {currentUser ? (
              <div className="feedback-block">
                <div className="feedback-header">
                  <strong>Current local session</strong>
                  <span className="pill">
                    {currentUser.name} · {currentUser.isDeveloper ? "developer" : currentUser.role}
                  </span>
                </div>
                <p className="feedback-copy" style={{ marginTop: 12 }}>
                  Signed in as <strong>{currentUser.username}</strong>.
                </p>
                {typeof currentUser.liveSessionRemaining === "number" ? (
                  <p className="feedback-copy" style={{ marginTop: 12 }}>
                    Live sessions remaining:{" "}
                    <strong>
                      {currentUser.liveSessionRemaining}
                      {currentUser.liveSessionLimit
                        ? ` / ${currentUser.liveSessionLimit}`
                        : ""}
                    </strong>
                    .
                  </p>
                ) : null}
                <p className="feedback-copy" style={{ marginTop: 12 }}>
                  You can continue with this account, or sign in with another user
                  below on the same device.
                </p>
                {currentUser.requestedRole === "admin" &&
                currentUser.adminApprovalStatus === "pending" ? (
                  <p className="feedback-copy" style={{ marginTop: 12 }}>
                    Admin access is pending developer approval. This account can keep using
                    the student workspace until the request is approved.
                  </p>
                ) : null}
                {requestedRoleMismatch ? (
                  <p className="feedback-copy" style={{ marginTop: 12 }}>
                    This link was opened for a {requestedRole} route, but your saved account
                    is {currentUser.role}. Continue to the matching workspace or sign out.
                  </p>
                ) : null}
                <div className="button-row" style={{ marginTop: 16 }}>
                  <button className="button-primary" onClick={handleContinue} type="button">
                    Continue to Workspace
                  </button>
                  <button className="button-secondary" onClick={handleSignOut} type="button">
                    Use Another Account
                  </button>
                </div>
              </div>
            ) : null}

            {error ? (
              <div className="feedback-block">
                <div className="feedback-header">
                  <strong>Authentication issue</strong>
                  <span className="status-badge status-unsafe">attention</span>
                </div>
                <p className="feedback-copy" style={{ marginTop: 12 }}>
                  {error}
                </p>
              </div>
            ) : null}

            {step === "identify" ? (
              <>
                <div className="feedback-block">
                  <div className="feedback-header">
                    <strong>Judge demo accounts</strong>
                    <span className="pill">Password: CODESTORMERS</span>
                  </div>
                  <div className="dashboard-progress-list" style={{ marginTop: 16 }}>
                    {JUDGE_DEMO_ACCOUNTS.map((account) => (
                      <div className="dashboard-progress-item" key={account}>
                        <div className="dashboard-progress-copy">
                          <strong>{account}</strong>
                          <p>Fixed student demo account with 10 live sessions.</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <form className="auth-form" onSubmit={(event) => void handleIdentify(event)}>
                <label className="field-label">
                  Username only
                  <input
                    autoComplete="username"
                    className="text-input"
                    onChange={(event) => setIdentifier(event.target.value)}
                    placeholder="Student_1@gmail.com"
                    required
                    value={identifier}
                  />
                </label>

                <p className="auth-helper-copy">
                  Use the fixed username for this account. New emails are managed by
                  the developer team while the demo is public.
                </p>

                <button className="button-primary" disabled={isSubmitting} type="submit">
                  {isSubmitting ? "Checking Account..." : "Continue"}
                </button>
                </form>
              </>
            ) : null}

            {step === "sign-in" && previewedAccount ? (
              <>
                <div className="auth-account-preview">
                  <div className="auth-account-header">
                    <div>
                      <span className="metric-label">Account found</span>
                      <strong>{previewedAccount.name}</strong>
                    </div>
                    <span className="pill">
                      {previewedAccount.isDeveloper
                        ? "developer"
                        : previewedAccount.role}
                    </span>
                  </div>
                  <p className="panel-copy">
                    Username: <strong>{previewedAccount.username}</strong>
                  </p>
                  {typeof previewedAccount.liveSessionRemaining === "number" ? (
                    <p className="panel-copy" style={{ marginTop: 12 }}>
                      Live sessions remaining:{" "}
                      <strong>
                        {previewedAccount.liveSessionRemaining}
                        {previewedAccount.liveSessionLimit
                          ? ` / ${previewedAccount.liveSessionLimit}`
                          : ""}
                      </strong>
                    </p>
                  ) : null}
                </div>

                <form className="auth-form" onSubmit={(event) => void handleSignIn(event)}>
                  <label className="field-label">
                    Password
                    <input
                      autoComplete="current-password"
                      className="text-input"
                      minLength={8}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="Enter your password"
                      required
                      type="password"
                      value={password}
                    />
                  </label>

                  <div className="button-row">
                    <button className="button-ghost" onClick={handleBack} type="button">
                      Back
                    </button>
                    <button
                      className="button-primary"
                      disabled={isSubmitting}
                      type="submit"
                    >
                      {isSubmitting ? "Signing In..." : "Continue"}
                    </button>
                  </div>
                </form>
              </>
            ) : null}

            <div className="auth-compact-footer">
              <p className="fine-print">
                This public demo uses fixed backend-managed accounts and live-session
                quotas to reduce API abuse while the project is still in demo stage.
              </p>
            </div>
          </article>
        </section>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="page-shell auth-shell">
          <div className="page-inner auth-compact-page">
            <div className="empty-state">
              <h1 className="review-title">Loading login</h1>
              <p className="review-subtle">
                Preparing your workspace sign-in.
              </p>
            </div>
          </div>
        </main>
      }
    >
      <LoginPageContent />
    </Suspense>
  );
}
