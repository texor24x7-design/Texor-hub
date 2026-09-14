import '@/styles/globals.css';

export const metadata = {
  title: 'Texor Talk',
  description: 'Meetings and messaging for the Texor ecosystem.',
};

export const viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
