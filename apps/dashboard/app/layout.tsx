import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Receipt — run history',
  description: 'Local-first dashboard for Receipt verification runs.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
