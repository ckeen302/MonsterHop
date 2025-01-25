import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"

const inter = Inter({ subsets: ["latin"] })

export const metadata = {
  title: "Monster Hop",
  description: "A physics-based monster hopping game",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="overflow-hidden">
      <body className={`${inter.className} overflow-hidden`}>{children}</body>
    </html>
  )
}

