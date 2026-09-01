import type { Metadata } from 'next';
import { Inter, Instrument_Serif } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const serif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-instrument',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Lifecycle Hub — Water Main Failure Intelligence | Clustral AI',
  description:
    'A Clustral AI product. Lifecycle Hub reconstructs what a water distribution system was signalling before a main failed, connecting telemetry, environment, spatial context, inspection documents and live external signals into one explainable evidence trail.',
  icons: { icon: '/brand/clustral-mark.png' },
};

/**
 * Applied before first paint so the chosen theme never flashes. Reads the
 * stored preference, falling back to the operating system setting.
 */
const THEME_INIT = `(function(){try{
  var t = localStorage.getItem('lifecycle-hub-theme');
  if (!t) t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = t;
}catch(e){document.documentElement.dataset.theme='light';}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light" className={`${inter.variable} ${serif.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="bg-ground text-ink antialiased">{children}</body>
    </html>
  );
}
