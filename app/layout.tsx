import type { ReactNode } from "react";

export const metadata = {
  title: "ScrapYard",
  description: "Two weapons walk into an arena. Only one gets a highlight reel.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#0b0d12", color: "#eef1f6" }}>{children}</body>
    </html>
  );
}
