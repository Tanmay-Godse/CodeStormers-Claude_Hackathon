"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { FormEvent } from "react";
import { Suspense, useEffect, useState } from "react";

import {
  clearAuthUser,
  createAuthAccount,
  getAuthUser,
  refreshAuthUser,
  signInAuthUser,
} from "@/lib/storage";
import type { AuthMode, AuthUser, UserRole } from "@/lib/types";

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
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [role, setRole] = useState<UserRole>(requestedRole ?? "student");
  const [signInUsername, setSignInUsername] = useState("");
  const [signInPassword, setSignInPassword] = useState("");
  const [createName, setCreateName] = useState("");
  const [createUsername, setCreateUsername] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const activeRole = requestedRole ?? role;

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

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const user = await signInAuthUser({
        username: signInUsername,
        password: signInPassword,
        role: activeRole,
      });
      setCurrentUser(user);
      router.push(resolveDestination(user));
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Sign-in failed. Check your username and password.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCreateAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (createPassword !== confirmPassword) {
      setError("Passwords do not match. Re-enter them and try again.");
      return;
    }

    setIsSubmitting(true);

    try {
      const user = await createAuthAccount({
        name: createName,
        username: createUsername,
        password: createPassword,
        role: activeRole,
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
    setError(null);
    setMode("sign-in");
    setSignInPassword("");
  }

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
              <span className="pill">Workspace auth</span>
            </div>

            <div className="auth-stage-copy">
              <span className="eyebrow">Secure entry</span>
              <h1 className="auth-login-title">Sign in or create your account</h1>
              <p className="auth-login-copy">
                Sign in with your username and password, or create a new account and
                start practicing right away.
              </p>
            </div>

            <div className="auth-flow-meta">
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
                  <>
                    <p className="feedback-copy" style={{ marginTop: 12 }}>
                      Live sessions remaining:{" "}
                      <strong>
                        {currentUser.liveSessionRemaining}
                        {typeof currentUser.liveSessionLimit === "number"
                          ? ` / ${currentUser.liveSessionLimit}`
                          : ""}
                      </strong>
                      .
                    </p>
                    <p className="feedback-copy" style={{ marginTop: 12 }}>
                      Used so far: <strong>{currentUser.liveSessionUsed}</strong>.
                    </p>
                  </>
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
                {currentUser.requestedRole === "admin" &&
                currentUser.adminApprovalStatus === "pending" ? (
                  <p className="feedback-copy" style={{ marginTop: 12 }}>
                    Admin reviewer access is still pending developer approval. You can
                    keep using the student workspace until that request is approved.
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
            ) : (
              <>
                <div className="auth-mode-switch">
                  <button
                    className={`auth-mode-button ${mode === "sign-in" ? "is-active" : ""}`}
                    onClick={() => setMode("sign-in")}
                    type="button"
                  >
                    Sign In
                  </button>
                  <button
                    className={`auth-mode-button ${mode === "create-account" ? "is-active" : ""}`}
                    onClick={() => setMode("create-account")}
                    type="button"
                  >
                    Create Account
                  </button>
                </div>

                <div className="role-switch">
                  <button
                    className={`role-card ${role === "student" ? "is-active" : ""}`}
                    disabled={Boolean(requestedRole)}
                    onClick={() => setRole("student")}
                    type="button"
                  >
                    <span className="feature-index">Student</span>
                    <strong>Practice and review</strong>
                    <p className="panel-copy">
                      Use the trainer, review your sessions, and work through the
                      Knowledge Lab.
                    </p>
                  </button>
                  <button
                    className={`role-card ${role === "admin" ? "is-active" : ""}`}
                    disabled={Boolean(requestedRole)}
                    onClick={() => setRole("admin")}
                    type="button"
                  >
                    <span className="feature-index">Admin</span>
                    <strong>Review flagged cases</strong>
                    <p className="panel-copy">
                      Request access to the admin review queue for human validation
                      workflows.
                    </p>
                  </button>
                </div>

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

                {mode === "sign-in" ? (
                  <form className="auth-form" onSubmit={(event) => void handleSignIn(event)}>
                    <label className="field-label">
                      Username
                      <input
                        autoComplete="username"
                        className="text-input"
                        onChange={(event) => setSignInUsername(event.target.value)}
                        placeholder="student01 or faculty.reviewer"
                        required
                        value={signInUsername}
                      />
                    </label>

                    <label className="field-label">
                      Password
                      <input
                        autoComplete="current-password"
                        className="text-input"
                        minLength={8}
                        onChange={(event) => setSignInPassword(event.target.value)}
                        placeholder="Enter your password"
                        required
                        type="password"
                        value={signInPassword}
                      />
                    </label>

                    <p className="auth-helper-copy">
                      You are signing in for the <strong>{activeRole}</strong> workspace.
                    </p>

                    <button className="button-primary" disabled={isSubmitting} type="submit">
                      {isSubmitting ? "Signing In..." : "Sign In"}
                    </button>
                  </form>
                ) : (
                  <form
                    className="auth-form"
                    onSubmit={(event) => void handleCreateAccount(event)}
                  >
                    <label className="field-label">
                      Display name
                      <input
                        autoComplete="name"
                        className="text-input"
                        onChange={(event) => setCreateName(event.target.value)}
                        placeholder={activeRole === "admin" ? "Faculty Reviewer" : "Student Name"}
                        required
                        value={createName}
                      />
                    </label>

                    <div className="inline-form-row">
                      <label className="field-label">
                        Username
                        <input
                          autoComplete="username"
                          className="text-input"
                          onChange={(event) => setCreateUsername(event.target.value)}
                          placeholder="Choose a username"
                          required
                          value={createUsername}
                        />
                      </label>

                      <label className="field-label">
                        Role
                        <select
                          disabled={Boolean(requestedRole)}
                          onChange={(event) => setRole(event.target.value as UserRole)}
                          value={activeRole}
                        >
                          <option value="student">Student</option>
                          <option value="admin">Admin reviewer</option>
                        </select>
                      </label>
                    </div>

                    <div className="inline-form-row">
                      <label className="field-label">
                        Password
                        <input
                          autoComplete="new-password"
                          className="text-input"
                          minLength={8}
                          onChange={(event) => setCreatePassword(event.target.value)}
                          placeholder="At least 8 characters"
                          required
                          type="password"
                          value={createPassword}
                        />
                      </label>

                      <label className="field-label">
                        Confirm password
                        <input
                          autoComplete="new-password"
                          className="text-input"
                          minLength={8}
                          onChange={(event) => setConfirmPassword(event.target.value)}
                          placeholder="Re-enter password"
                          required
                          type="password"
                          value={confirmPassword}
                        />
                      </label>
                    </div>

                    <p className="auth-helper-copy">
                      {activeRole === "admin"
                        ? "Admin reviewer requests are created first, then wait for developer approval while the account can still use the student workspace."
                        : "This creates a normal workspace account and signs you in immediately."}
                    </p>

                    <button className="button-primary" disabled={isSubmitting} type="submit">
                      {isSubmitting ? "Creating Account..." : "Create Account"}
                    </button>
                  </form>
                )}

                <div className="auth-compact-footer">
                  <p className="fine-print">
                    Normal self-service accounts are enabled. Existing seeded demo accounts
                    and developer-managed review flows still continue to work.
                  </p>
                </div>
              </>
            )}
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
