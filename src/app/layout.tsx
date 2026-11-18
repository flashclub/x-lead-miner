export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Pass-through: the <html>/<body> live in src/app/[locale]/layout.tsx so
  // `lang` matches the active locale (next-intl App Router pattern).
  return children;
}
