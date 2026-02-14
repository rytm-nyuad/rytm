import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "rytm — Master your flow",
  description: "Track how you feel, what you do, and what shapes your performance. Combining daily check-ins, nutrition, hydration, and journaling into one simple rhythm.",
  icons: {
  icon: [
    { url: "/favicon.ico" },
    { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
    { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
  ],
},
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
