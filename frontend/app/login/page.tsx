"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { FormEvent } from "react";
import { Suspense, useEffect, useState } from "react";

import {
  clearAuthUser,
  createAuthAccount,
  getAuthUser,
  previewAuthAccount,
  signInAuthUser,
} from "@/lib/storage";
import type { AuthUser, UserRole } from "@/lib/types";

type AuthStep = "identify" | "sign-in" | "create-account";

type PreviewedAccount = {
  name: string;
  role: UserRole;
  username: string;
};

function getDefaultDestination(role: UserRole) {
  return role === "admin"
    ? "/admin/reviews"
    : "/train/simple-interrupted-suture";
}

function suggestUsername(identifier: string) {
  const normalized = identifier
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ".")
    .replace(/[^a-z0-9._@-]/g, "")
    .slice(0, 24);

  return normalized || "student01";
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
  const [role, setRole] = useState<UserRole>(requestedRole ?? "student");
  const [identifier, setIdentifier] = useState("");
  const [previewedAccount, setPreviewedAccount] = useState<PreviewedAccount | null>(
    null,
  );
  const [password, setPassword] = useState("");
  const [createName, setCreateName] = useState("");
  const [createUsername, setCreateUsername] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function resolveDestination(targetRole: UserRole) {
    if (requestedRole && targetRole === requestedRole) {
      return nextPath ?? getDefaultDestination(targetRole);
    }

    if (!requestedRole && nextPath) {
      return nextPath;
    }

    return getDefaultDestination(targetRole);
  }

  useEffect(() => {
    setCurrentUser(getAuthUser());
  }, []);

  const requestedRoleMismatch =
    currentUser && requestedRole ? currentUser.role !== requestedRole : false;

  function resetCreateFields(nextIdentifier: string) {
    const trimmedIdentifier = nextIdentifier.trim();
    setCreateName(trimmedIdentifier);
    setCreateUsername(suggestUsername(trimmedIdentifier));
    setCreatePassword("");
    setConfirmPassword("");
  }

  async function handleIdentify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const matchedAccount = await previewAuthAccount(identifier);

      if (matchedAccount) {
        setPreviewedAccount(matchedAccount);
        setRole(matchedAccount.role);
        setPassword("");
        setStep("sign-in");
      } else {
        setPreviewedAccount(null);
        resetCreateFields(identifier);
        setStep("create-account");
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
      router.push(resolveDestination(user.role));
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
        role,
      });
      setCurrentUser(user);
      router.push(resolveDestination(user.role));
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Account creation failed. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleContinue() {
    if (!currentUser) {
      return;
    }

    router.push(resolveDestination(currentUser.role));
  }

  function handleSignOut() {
    clearAuthUser();
    setCurrentUser(null);
    setError(null);
    setStep("identify");
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
      : step === "sign-in"
        ? "Enter your password"
        : "Create your workspace account";

  const cardCopy =
    step === "identify"
      ? "Enter the username or display name for this workspace account. If we find a saved match, we will ask for the password. If not, we will help you create the account next."
      : step === "sign-in"
        ? "This sign-in is backed by the local backend, with account records stored for the workspace. Password comes second so the first screen stays focused."
        : "No saved workspace account matched that identifier, so the next step is to create one and route it to the right workspace.";

  return (
    <main className="page-shell auth-shell">
      <div className="page-inner auth-compact-page">
        <section className="auth-compact-shell">
          <article className="panel auth-login-card">
            <div className="auth-login-brand">
              <div className="brand">
                <span className="brand-mark">AC</span>
                <span>AI Clinical Skills Coach</span>
              </div>
              <span className="pill">SQLite-backed auth</span>
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
                  ? resolveDestination(requestedRole)
                  : "match workspace after sign-in"}
              </span>
            </div>

            {currentUser ? (
              <div className="feedback-block">
                <div className="feedback-header">
                  <strong>Current local session</strong>
                  <span className="pill">
                    {currentUser.name} · {currentUser.role}
                  </span>
                </div>
                <p className="feedback-copy" style={{ marginTop: 12 }}>
                  Signed in as <strong>{currentUser.username}</strong>.
                </p>
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
            ) : (
              <>
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
                  <form className="auth-form" onSubmit={(event) => void handleIdentify(event)}>
                    <label className="field-label">
                      Username or display name
                      <input
                        autoComplete="username"
                        className="text-input"
                        onChange={(event) => setIdentifier(event.target.value)}
                        placeholder="student01, faculty.reviewer, or Student Name"
                        required
                        value={identifier}
                      />
                    </label>

                    <p className="auth-helper-copy">
                      We will first look for an existing workspace account. If none is found,
                      the next screen becomes account creation automatically.
                    </p>

                    <button className="button-primary" disabled={isSubmitting} type="submit">
                      {isSubmitting ? "Checking Account..." : "Continue"}
                    </button>
                  </form>
                ) : null}

                {step === "sign-in" && previewedAccount ? (
                  <>
                    <div className="auth-account-preview">
                      <div className="auth-account-header">
                        <div>
                          <span className="metric-label">Account found</span>
                          <strong>{previewedAccount.name}</strong>
                        </div>
                        <span className="pill">{previewedAccount.role}</span>
                      </div>
                      <p className="panel-copy">
                        Username: <strong>{previewedAccount.username}</strong>
                      </p>
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

                {step === "create-account" ? (
                  <form className="auth-form" onSubmit={(event) => void handleCreateAccount(event)}>
                    <div className="auth-account-preview">
                      <div className="auth-account-header">
                        <div>
                          <span className="metric-label">Account setup</span>
                          <strong>New workspace account</strong>
                        </div>
                        <span className="pill">{role}</span>
                      </div>
                      <p className="panel-copy">
                        This identifier was not found, so the next step is to create a
                        persisted account for this workspace.
                      </p>
                    </div>

                    <label className="field-label">
                      Role
                      <select
                        onChange={(event) => setRole(event.target.value as UserRole)}
                        value={role}
                      >
                        <option value="student">Student</option>
                        <option value="admin">Admin reviewer</option>
                      </select>
                    </label>

                    <label className="field-label">
                      Display name
                      <input
                        autoComplete="name"
                        className="text-input"
                        onChange={(event) => setCreateName(event.target.value)}
                        placeholder={role === "admin" ? "Faculty Reviewer" : "Student Name"}
                        required
                        value={createName}
                      />
                    </label>

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

                    <div className="button-row">
                      <button className="button-ghost" onClick={handleBack} type="button">
                        Back
                      </button>
                      <button className="button-primary" disabled={isSubmitting} type="submit">
                        {isSubmitting ? "Creating Account..." : "Create Account"}
                      </button>
                    </div>
                  </form>
                ) : null}
              </>
            )}

            <div className="auth-compact-footer">
              <p className="fine-print">
                Accounts are stored in the local backend SQLite database for this
                workspace. This is still a lightweight local auth experience, not a
                cloud identity provider.
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
                Preparing the step-by-step workspace account flow.
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
