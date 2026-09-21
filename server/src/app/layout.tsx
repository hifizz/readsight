import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Relata',
  description: "Connect what you discover to what you're working on.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
