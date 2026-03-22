"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AppFrame } from "@/components/AppFrame";
import {
  approveAdminRequest,
  listPendingAdminRequests,
  rejectAdminRequest,
  type PersistedAuthAccount,
} from "@/lib/api";
import { buildSharedSidebarItems, DEFAULT_TRAINING_HREF } from "@/lib/appShell";
import { clearAuthUser } from "@/lib/storage";
import { useWorkspaceUser } from "@/lib/useWorkspaceUser";

export default function DeveloperApprovalsPage() {
  const router = useRouter();
  const { hydrated, sync, user } = useWorkspaceUser();
  const [requests, setRequests] = useState<PersistedAuthAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    if (!user?.isDeveloper) {
      router.replace("/login?next=/developer/approvals");
      return;
    }

    const developerAccountId = user.accountId;
    const developerSessionToken = user.sessionToken;

    let cancelled = false;

    async function loadRequests() {
      setLoading(true);
      setPageError(null);

      try {
        if (!developerSessionToken) {
          throw new Error("Sign in again before loading developer approvals.");
        }

        const response = await listPendingAdminRequests(
          developerAccountId,
          developerSessionToken,
        );
        if (!cancelled) {
          setRequests(response);
        }
      } catch (error) {
        if (!cancelled) {
          setPageError(
            error instanceof Error
              ? error.message
              : "The pending admin request list could not be loaded.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadRequests();

    return () => {
      cancelled = true;
    };
  }, [hydrated, router, user]);

  async function handleResolve(accountId: string, decision: "approve" | "reject") {
    if (!user) {
      return;
    }

    setActiveRequestId(accountId);
    setPageError(null);

    try {
      if (!user.sessionToken) {
        throw new Error("Sign in again before resolving access requests.");
      }

      if (decision === "approve") {
        await approveAdminRequest(accountId, {
          developerAccountId: user.accountId,
          developerSessionToken: user.sessionToken,
        });
      } else {
        await rejectAdminRequest(accountId, {
          developerAccountId: user.accountId,
          developerSessionToken: user.sessionToken,
        });
      }

      setRequests((current) => current.filter((entry) => entry.id !== accountId));
      sync();
    } catch (error) {
      setPageError(
        error instanceof Error
          ? error.message
          : "That admin request could not be updated.",
      );
    } finally {
      setActiveRequestId(null);
    }
  }

  function handleLogout() {
    clearAuthUser();
    sync();
    router.push("/login");
  }

  if (!hydrated || !user?.isDeveloper) {
    return (
      <AppFrame
        brandSubtitle="Developer approvals"
        pageTitle="Approvals"
        sidebarItems={buildSharedSidebarItems({
          active: "developer",
          isDeveloper: true,
          reviewHref: DEFAULT_TRAINING_HREF,
          userRole: "admin",
        })}
        statusPill={{ icon: "review", label: "checking developer access" }}
      >
        <section className="dashboard-card dashboard-frame-panel">
          <span className="dashboard-card-eyebrow">Preparing approvals</span>
          <h2>Checking the fixed developer account.</h2>
          <p>
            Once the shared login confirms the developer session, pending admin
            access requests will appear here.
          </p>
        </section>
      </AppFrame>
    );
  }

  return (
    <AppFrame
      brandSubtitle="Developer approvals"
      footerPrimaryAction={{
        href: "/admin/reviews",
        icon: "analytics",
        label: "Open Admin Queue",
        strong: true,
      }}
      footerSecondaryActions={[
        { href: "/profile", icon: "dashboard", label: "Profile" },
        { icon: "logout", label: "Logout", onClick: handleLogout },
      ]}
      pageTitle="Approvals"
      sidebarItems={buildSharedSidebarItems({
        active: "developer",
        isDeveloper: true,
        reviewHref: DEFAULT_TRAINING_HREF,
        userRole: user.role,
      })}
      statusPill={{ icon: "review", label: `${requests.length} pending requests` }}
      userName={user.name}
    >
      <section className="dashboard-card dashboard-frame-panel">
        <span className="dashboard-card-eyebrow">Developer Queue</span>
        <h2>Approve new admin reviewer requests.</h2>
        <p>
          The shared login lets anyone request admin access, but only the fixed
          developer account can promote them. Approve when the learner should move
          into the admin review workspace.
        </p>
      </section>

      {pageError ? (
        <section className="dashboard-card dashboard-frame-panel">
          <span className="dashboard-card-eyebrow">Action Needed</span>
          <h2>Approval queue issue</h2>
          <p>{pageError}</p>
        </section>
      ) : null}

      <section className="dashboard-card dashboard-frame-panel">
        <div className="dashboard-section-heading">
          <div>
            <span className="dashboard-card-eyebrow">Pending Requests</span>
            <h2>Admin access requests</h2>
          </div>
          <span className="pill">{requests.length} waiting</span>
        </div>

        {loading ? (
          <p className="panel-copy">Loading pending admin requests.</p>
        ) : requests.length === 0 ? (
          <p className="panel-copy">
            No admin requests are waiting right now. New reviewer requests will
            appear here automatically.
          </p>
        ) : (
          <div className="dashboard-progress-list">
            {requests.map((request) => (
              <article className="dashboard-progress-item" key={request.id}>
                <div className="dashboard-progress-copy">
                  <strong>{request.name}</strong>
                  <span>@{request.username}</span>
                  <p>
                    Requested admin reviewer access through the shared login page and
                    is currently waiting for developer approval.
                  </p>
                </div>

                <div className="button-row">
                  <button
                    className="button-secondary"
                    disabled={activeRequestId === request.id}
                    onClick={() => void handleResolve(request.id, "reject")}
                    type="button"
                  >
                    Reject
                  </button>
                  <button
                    className="button-primary"
                    disabled={activeRequestId === request.id}
                    onClick={() => void handleResolve(request.id, "approve")}
                    type="button"
                  >
                    {activeRequestId === request.id ? "Saving..." : "Approve"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </AppFrame>
  );
}
