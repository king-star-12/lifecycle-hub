import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Clustral — Water Main Failure Intelligence',
  description:
    'Reconstructs what a water distribution system was signalling before a main failed, by connecting telemetry, environment, spatial context, inspection documents and live external signals into one explainable evidence trail.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-ground text-ink antialiased">{children}</body>
    </html>
  );
}
