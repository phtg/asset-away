import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Asset Away - batch character animations",
  description: "Local batch image-to-video workspace for presentation assets.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-slate-50 text-slate-900 antialiased">{children}</body>
    </html>
  );
}
