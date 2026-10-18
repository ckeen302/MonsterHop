import type { Metadata, Viewport } from 'next'
import { fredoka } from '../src/lib/fonts'
import './globals.css'

export const metadata: Metadata = {
  title: 'Monster Hop',
  description: 'A physics-based monster hopping game — bounce your way to the stars!',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#120d2e',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={fredoka.variable}>
      <body className={fredoka.className}>{children}</body>
    </html>
  )
}
