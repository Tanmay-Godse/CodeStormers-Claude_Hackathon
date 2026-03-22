"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { DashboardIcon, type DashboardIconName } from "@/components/DashboardIcon";

export type AppFrameNavItem = {
  active?: boolean;
  href: string;
  icon: DashboardIconName;
  label: string;
};

export type AppFrameLinkAction = {
  href: string;
  label: string;
  strong?: boolean;
};

export type AppFrameFooterAction = {
  href?: string;
  icon: DashboardIconName;
  label: string;
  onClick?: () => void;
  strong?: boolean;
};

type AppFrameProps = {
  brandSubtitle: string;
  children: ReactNode;
  footerPrimaryAction?: AppFrameFooterAction;
  footerSecondaryActions?: AppFrameFooterAction[];
  mobileItems?: Array<Pick<AppFrameNavItem, "href" | "label">>;
  pageTitle: string;
  sidebarItems: AppFrameNavItem[];
  statusPill?: {
    icon: DashboardIconName;
    label: string;
  };
  subtitle?: string;
  topActions?: AppFrameLinkAction[];
  topItems?: Array<Pick<AppFrameNavItem, "href" | "label">>;
  userName?: string | null;
};

function initialsFromName(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function FooterActionButton({ action }: { action: AppFrameFooterAction }) {
  if (action.href) {
    return (
      <Link
        className={action.strong ? "dashboard-primary-button" : "dashboard-subtle-link"}
        href={action.href}
      >
        <DashboardIcon
          className={action.strong ? "dashboard-button-icon" : "dashboard-subtle-icon"}
          name={action.icon}
        />
        <span>{action.label}</span>
      </Link>
    );
  }

  return (
    <button
      className={action.strong ? "dashboard-primary-button" : "dashboard-subtle-link"}
      onClick={action.onClick}
      type="button"
    >
      <DashboardIcon
        className={action.strong ? "dashboard-button-icon" : "dashboard-subtle-icon"}
        name={action.icon}
      />
      <span>{action.label}</span>
    </button>
  );
}

export function AppFrame({
  brandSubtitle,
  children,
  footerPrimaryAction,
  footerSecondaryActions = [],
  mobileItems,
  pageTitle,
  sidebarItems,
  statusPill,
  subtitle = "Clinical Curator",
  topActions = [],
  userName,
}: AppFrameProps) {
  const userLabel = userName?.trim() || "Student Clinician";
  const compactNavItems =
    mobileItems && mobileItems.length > 0
      ? mobileItems
      : sidebarItems.map((item) => ({
          href: item.href,
          label: item.label,
        }));

  return (
    <main className="page-shell dashboard-shell">
      <div className="dashboard-layout">
        <aside className="dashboard-sidebar">
          <div className="dashboard-brand-panel">
            <span className="dashboard-brand-mark">CC</span>
            <div>
              <strong>Clinical Curator AI</strong>
              <span>{brandSubtitle}</span>
            </div>
          </div>

          <nav className="dashboard-nav">
            {sidebarItems.map((item) => (
              <Link
                className={`dashboard-nav-link ${item.active ? "is-active" : ""}`}
                href={item.href}
                key={`${item.href}:${item.label}`}
              >
                <DashboardIcon className="dashboard-nav-icon" name={item.icon} />
                <span>{item.label}</span>
              </Link>
            ))}
          </nav>

          {footerPrimaryAction || footerSecondaryActions.length > 0 ? (
            <div className="dashboard-sidebar-footer">
              {footerPrimaryAction ? <FooterActionButton action={footerPrimaryAction} /> : null}
              {footerSecondaryActions.map((action, index) => (
                <FooterActionButton
                  action={action}
                  key={`${action.href ?? action.label}:${action.label}:${index}`}
                />
              ))}
            </div>
          ) : null}
        </aside>

        <section className="dashboard-main">
          <header className="dashboard-topbar">
            <div className="dashboard-topbar-left">
              <div>
                <span className="dashboard-topbar-label">{subtitle}</span>
                <strong className="dashboard-topbar-title">{pageTitle}</strong>
              </div>
            </div>

            <div className="dashboard-topbar-actions">
              {statusPill ? (
                <span className="dashboard-status-pill">
                  <DashboardIcon className="dashboard-status-icon" name={statusPill.icon} />
                  {statusPill.label}
                </span>
              ) : null}
              {topActions.map((action, index) => (
                <Link
                  className={`dashboard-action-pill ${action.strong ? "is-strong" : ""}`}
                  href={action.href}
                  key={`${action.href}:${action.label}:${index}`}
                >
                  {action.label}
                </Link>
              ))}
              <Link
                aria-label={`Open profile for ${userLabel}`}
                className="dashboard-user-chip"
                href="/profile"
                title="Open profile"
              >
                <span>{initialsFromName(userLabel)}</span>
              </Link>
            </div>
          </header>

          <div className="dashboard-content">
            {compactNavItems.length > 0 ? (
              <nav aria-label="Workspace sections" className="dashboard-mobile-links">
                {compactNavItems.map((item) => {
                  const activeSidebarItem = sidebarItems.find(
                    (sidebarItem) => sidebarItem.href === item.href,
                  );

                  return (
                    <Link
                      className={activeSidebarItem?.active ? "is-active" : ""}
                      href={item.href}
                      key={`${item.href}:${item.label}`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
            ) : null}
            <div className="app-frame-stack">{children}</div>
          </div>
        </section>
      </div>
    </main>
  );
}
