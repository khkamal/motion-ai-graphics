import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Motion AI Studio — Make stills move differently",
  description: "A creative motion graphics studio for image-to-motion direction, generative style exploration, and 4K export.",
  applicationName: "Motion AI Studio",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
