import type { Metadata, Viewport } from "next";
import { Geist, Fraunces } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const geist = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const fraunces = Fraunces({ variable: "--font-fraunces", subsets: ["latin"], style: ["normal", "italic"], axes: ["opsz"] });

export const metadata: Metadata = {
  title: { default: "botmon — read the room", template: "%s · botmon" },
  description: "Upload your WhatsApp or Instagram chat and get an honest read on where things stand and what to do next.",
};

export const viewport: Viewport = { themeColor: "#0e0c12" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geist.variable} ${fraunces.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">
        {children}
        <Toaster theme="dark" position="bottom-center" toastOptions={{ style: { background: "#201b28", border: "1px solid #2c2535", color: "#f3ece4" } }} />
      </body>
    </html>
  );
}
