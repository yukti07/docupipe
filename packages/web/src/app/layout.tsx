import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WorkspaceProvider } from "@/state/workspace";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Quarry",
  description:
    "A pile of documents, turned into a table you can query — with the evidence behind every cell.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-canvas">
        <WorkspaceProvider>
          <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
        </WorkspaceProvider>
        {/* Confirmations only. An error never goes in a toast — it has to persist. */}
        <Toaster position="bottom-right" />
      </body>
    </html>
  );
}
