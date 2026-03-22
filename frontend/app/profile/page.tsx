"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { AppFrame } from "@/components/AppFrame";
import {
  buildSharedSidebarItems,
  DEFAULT_TRAINING_HREF,
} from "@/lib/appShell";
import {
  clearAuthUser,
  listManageableDemoAccounts,
  refreshAuthUser,
  resetManagedDemoAccountQuota,
  updateAuthUserProfile,
} from "@/lib/storage";
import type { AuthUser } from "@/lib/types";
import { useWorkspaceUser } from "@/lib/useWorkspaceUser";

export default function ProfilePage() {
  const router = useRouter();
  const { hydrated, sessions, sync, user } = useWorkspaceUser();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [managedAccounts, setManagedAccounts] = useState<AuthUser[]>([]);
  const [quotaError, setQuotaError] = useState<string | null>(null);
  const [activeResetId, setActiveResetId] = useState<string | null>(null);

  useEffect(() => {
    if (hydrated && !user) {
      router.replace("/login?role=student&next=%2Fprofile");
    }
  }, [hydrated, router, user]);

  useEffect(() => {
    if (!user) {
      return;
    }

    setName(user.name);
    setUsername(user.username);
  }, [user]);

  useEffect(() => {
    if (!hydrated || !user) {
      return;
    }

    let cancelled = false;

    void refreshAuthUser()
      .then((nextUser) => {
        if (!cancelled && nextUser) {
          sync();
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [hydrated, sync, user]);

  useEffect(() => {
    if (!hydrated || !user || (!user.isDeveloper && user.role !== "admin")) {
      setManagedAccounts([]);
      setQuotaError(null);
      return;
    }

    let cancelled = false;

    async function loadManagedAccounts() {
      try {
        const accounts = await listManageableDemoAccounts();
        if (!cancelled) {
          setManagedAccounts(accounts);
        }
      } catch (loadError) {
        if (!cancelled) {
          setQuotaError(
            loadError instanceof Error
              ? loadError.message
              : "The live-session quota list could not be loaded.",
          );
        }
      }
    }

    void loadManagedAccounts();

    return () => {
      cancelled = true;
    };
  }, [hydrated, user]);

  const latestReviewHref = useMemo(() => {
    const latestSession = sessions[0];
    return latestSession ? `/review/${latestSession.id}` : DEFAULT_TRAINING_HREF;
  }, [sessions]);
  const hasSavedSession = sessions.length > 0;

  const accessStatus = useMemo(() => {
    if (!user || user.isDeveloper) {
      return null;
    }

    if (user.role === "admin") {
      return {
        eyebrow: "Access Approved",
        title: "Admin review access is active.",
        copy:
          "This account can open the admin review queue and resolve escalated cases.",
      };
    }

    if (user.requestedRole === "admin" && user.adminApprovalStatus === "pending") {
      return {
        eyebrow: "Approval Pending",
        title: "Waiting for developer approval.",
        copy:
          "Your admin access request is with developer@gmail.com. You can keep using the student workspace until approval comes through.",
      };
    }

    if (user.requestedRole === "admin" && user.adminApprovalStatus === "rejected") {
      return {
        eyebrow: "Request Declined",
        title: "Admin access was not approved.",
        copy:
          "This account stays in the student workspace. Ask the developer team if that needs to change.",
      };
    }

    return null;
  }, [user]);

  function handleLogout() {
    clearAuthUser();
    router.push("/login");
  }

  async function handleSaveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccessMessage(null);

    if (newPassword && newPassword !== confirmPassword) {
      setError("New password and confirm password must match.");
      return;
    }

    setIsSaving(true);

    try {
      await updateAuthUserProfile({
        name,
        username,
        currentPassword,
        newPassword: newPassword.trim() || undefined,
      });

      sync();
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSuccessMessage("Profile updated.");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Profile update failed. Try again.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleResetQuota(accountId: string) {
    if (!user?.sessionToken) {
      setQuotaError("Sign in again before resetting demo limits.");
      return;
    }

    setActiveResetId(accountId);
    setQuotaError(null);

    try {
      const updated = await resetManagedDemoAccountQuota(accountId, {
        actorAccountId: user.accountId,
        actorSessionToken: user.sessionToken,
      });

      setManagedAccounts((current) =>
        current.map((account) =>
          account.accountId === accountId ? updated : account,
        ),
      );
      sync();
    } catch (resetError) {
      setQuotaError(
        resetError instanceof Error
          ? resetError.message
          : "The live-session limit could not be reset.",
      );
    } finally {
      setActiveResetId(null);
    }
  }

  if (!hydrated || !user) {
    return (
      <AppFrame
        brandSubtitle="Workspace profile"
        pageTitle="Profile"
        sidebarItems={buildSharedSidebarItems({ userRole: null })}
      >
        <section className="dashboard-card dashboard-frame-panel">
          <span className="dashboard-card-eyebrow">Preparing Profile</span>
          <h2>Loading your workspace profile.</h2>
          <p>Checking the signed-in account and saved sessions.</p>
        </section>
      </AppFrame>
    );
  }

  const reviewCount = sessions.filter((session) => session.debrief).length;
  const voiceSessions = sessions.filter((session) => session.equityMode.audioCoaching).length;
  const liveSessionLabel =
    user.liveSessionLimit === null
      ? user.isDeveloper
        ? "Unlimited"
        : "Admin access"
      : `${user.liveSessionRemaining ?? 0} / ${user.liveSessionLimit}`;

  return (
    <AppFrame
      brandSubtitle="Workspace profile"
      footerPrimaryAction={{
        href: user.isDeveloper ? "/developer/approvals" : DEFAULT_TRAINING_HREF,
        icon: user.isDeveloper ? "review" : "play",
        label: user.isDeveloper ? "Open Approvals" : "Start Session",
        strong: true,
      }}
      footerSecondaryActions={[
        ...(user.isDeveloper
          ? [{ href: "/admin/reviews", icon: "analytics" as const, label: "Admin Queue" as const }]
          : [{ href: "/dashboard", icon: "dashboard" as const, label: "Dashboard" as const }]),
        { icon: "logout", label: "Logout", onClick: handleLogout },
      ]}
      pageTitle="Profile"
      sidebarItems={buildSharedSidebarItems({
        isDeveloper: user.isDeveloper,
        reviewHref: latestReviewHref,
        userRole: user.role,
      })}
      topActions={[
        ...(user.isDeveloper
          ? [{ href: "/admin/reviews", label: "Admin Queue" }]
          : [{ href: latestReviewHref, label: hasSavedSession ? "Latest Review" : "Open Trainer" }]),
        {
          href: user.isDeveloper ? "/developer/approvals" : DEFAULT_TRAINING_HREF,
          label: user.isDeveloper ? "Approvals" : "Live Session",
          strong: true,
        },
      ]}
      userName={user.name}
    >
      <section className="dashboard-hero">
        <div>
          <span className="dashboard-kicker">Profile</span>
          <h1>{user.name}</h1>
          <p>
            Keep this page simple: your account, your recent activity, and quick ways
            back into practice.
          </p>
        </div>
        <div className="dashboard-hero-meta">
          <span>{user.isDeveloper ? "developer" : user.role}</span>
          <span>{user.username}</span>
        </div>
      </section>

      <section className="dashboard-kpi-grid">
        <article className="dashboard-card dashboard-kpi-card">
          <span>Sessions</span>
          <strong>{sessions.length}</strong>
          <p>Saved practice runs.</p>
        </article>
        <article className="dashboard-card dashboard-kpi-card">
          <span>Reviews</span>
          <strong>{reviewCount}</strong>
          <p>Saved debriefs.</p>
        </article>
        <article className="dashboard-card dashboard-kpi-card">
          <span>Live Sessions Left</span>
          <strong>{liveSessionLabel}</strong>
          <p>
            {user.liveSessionLimit === null
              ? "Managed access account."
              : `${voiceSessions} voice-guided runs saved.`}
          </p>
        </article>
      </section>

      <div className="dashboard-grid">
        <div className="dashboard-left-column">
          <article className="dashboard-card dashboard-session-card">
            <div className="dashboard-card-header">
              <div>
                <span className="dashboard-card-eyebrow">Edit Profile</span>
                <h2>Workspace details</h2>
              </div>
            </div>
            {user.isDeveloper || user.isSeeded ? (
              <div className="feedback-block">
                <div className="feedback-header">
                  <strong>{user.isDeveloper ? "Fixed developer account" : "Managed demo account"}</strong>
                  <span className="pill">read only</span>
                </div>
                <p className="feedback-copy" style={{ marginTop: 12 }}>
                  {user.isDeveloper
                    ? "This account stays fixed so the developer approval workflow always uses the same shared login."
                    : "This seeded demo account stays fixed so the public login list and live-session quota rules remain stable during judging."}
                </p>
              </div>
            ) : (
            <form onSubmit={(event) => void handleSaveProfile(event)}>
              <div className="inline-form-row">
                <label className="field-label">
                  Display name
                  <input
                    onChange={(event) => setName(event.target.value)}
                    type="text"
                    value={name}
                  />
                </label>
                <label className="field-label">
                  Username
                  <input
                    onChange={(event) => setUsername(event.target.value)}
                    type="text"
                    value={username}
                  />
                </label>
              </div>

              <div className="inline-form-row" style={{ marginTop: 16 }}>
                <label className="field-label">
                  Current password
                  <input
                    onChange={(event) => setCurrentPassword(event.target.value)}
                    required
                    type="password"
                    value={currentPassword}
                  />
                </label>
                <label className="field-label">
                  New password
                  <input
                    onChange={(event) => setNewPassword(event.target.value)}
                    placeholder="Leave blank to keep current password"
                    type="password"
                    value={newPassword}
                  />
                </label>
              </div>

              <div className="inline-form-row" style={{ marginTop: 16 }}>
                <label className="field-label">
                  Confirm new password
                  <input
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    placeholder="Repeat new password"
                    type="password"
                    value={confirmPassword}
                  />
                </label>
                <article className="metric-card compact-metric-card">
                  <p className="metric-label">Role</p>
                  <p className="metric-value">{user.role}</p>
                  <p className="panel-copy" style={{ marginTop: 10 }}>
                    Roles stay fixed for this workspace account.
                  </p>
                </article>
              </div>

              {error ? (
                <div className="feedback-block" style={{ marginTop: 16 }}>
                  <div className="feedback-header">
                    <strong>Update failed</strong>
                  </div>
                  <p className="feedback-copy" style={{ marginTop: 10 }}>
                    {error}
                  </p>
                </div>
              ) : null}

              {successMessage ? (
                <div className="feedback-block" style={{ marginTop: 16 }}>
                  <div className="feedback-header">
                    <strong>Saved</strong>
                  </div>
                  <p className="feedback-copy" style={{ marginTop: 10 }}>
                    {successMessage}
                  </p>
                </div>
              ) : null}

              <div className="button-row" style={{ marginTop: 16 }}>
                <button className="button-primary" disabled={isSaving} type="submit">
                  {isSaving ? "Saving..." : "Save Profile"}
                </button>
              </div>
            </form>
            )}
          </article>
        </div>

        <div className="dashboard-right-column">
          {(user.isDeveloper || user.role === "admin") ? (
            <article className="dashboard-card dashboard-session-card">
              <div className="dashboard-card-header">
                <div>
                  <span className="dashboard-card-eyebrow">Live Session Limits</span>
                  <h2>Reset demo account quotas</h2>
                </div>
              </div>
              <p className="panel-copy">
                Admin and developer accounts can reset the 10-session demo cap when a
                judge or teammate needs another guided run.
              </p>
              {quotaError ? (
                <div className="feedback-block" style={{ marginTop: 16 }}>
                  <div className="feedback-header">
                    <strong>Quota management issue</strong>
                  </div>
                  <p className="feedback-copy" style={{ marginTop: 10 }}>
                    {quotaError}
                  </p>
                </div>
              ) : null}
              <div className="dashboard-progress-list" style={{ marginTop: 16 }}>
                {managedAccounts.map((account) => (
                  <article className="dashboard-progress-item" key={account.accountId}>
                    <div className="dashboard-progress-copy">
                      <strong>{account.name}</strong>
                      <span>{account.username}</span>
                      <p>
                        {typeof account.liveSessionRemaining === "number" &&
                        typeof account.liveSessionLimit === "number"
                          ? `${account.liveSessionRemaining} of ${account.liveSessionLimit} live runs left`
                          : "Uncapped account"}
                      </p>
                    </div>
                    <button
                      className="button-secondary"
                      disabled={activeResetId === account.accountId}
                      onClick={() => void handleResetQuota(account.accountId)}
                      type="button"
                    >
                      {activeResetId === account.accountId ? "Resetting..." : "Reset"}
                    </button>
                  </article>
                ))}
              </div>
            </article>
          ) : null}

          {accessStatus ? (
            <article className="dashboard-card dashboard-session-card">
              <div className="dashboard-card-header">
                <div>
                  <span className="dashboard-card-eyebrow">{accessStatus.eyebrow}</span>
                  <h2>{accessStatus.title}</h2>
                </div>
              </div>
              <p className="panel-copy">{accessStatus.copy}</p>
            </article>
          ) : null}

          <article className="dashboard-card dashboard-session-card">
            <div className="dashboard-card-header">
              <div>
                <span className="dashboard-card-eyebrow">Quick Actions</span>
                <h2>Jump back in</h2>
              </div>
            </div>
            <div className="dashboard-frame-actions">
              <Link
                className="dashboard-primary-button"
                href={user.isDeveloper ? "/developer/approvals" : DEFAULT_TRAINING_HREF}
              >
                {user.isDeveloper ? "Open approvals" : "Start live session"}
              </Link>
              <Link
                className="dashboard-action-pill"
                href={user.isDeveloper ? "/admin/reviews" : latestReviewHref}
              >
                {user.isDeveloper
                  ? "Open admin queue"
                  : hasSavedSession
                    ? "Open latest review"
                    : "Open trainer"}
              </Link>
            </div>
          </article>
        </div>
      </div>
    </AppFrame>
  );
}
