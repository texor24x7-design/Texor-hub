import '@/styles/globals.css';

export const metadata = {
  title: 'Texor Account',
  description: 'One account for every Texor product.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
