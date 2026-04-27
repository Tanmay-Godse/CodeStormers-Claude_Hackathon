import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Clinical Skills Coach",
  description:
    "Simulation-only suturing practice coach with live stage-by-stage feedback.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
