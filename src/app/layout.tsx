import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Novel Illustration Studio",
  description:
    "Agent-driven novel illustration workflow: parse a book, dissect its characters, scenes and relationships, and assemble Seedance 2.0 prompts.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
