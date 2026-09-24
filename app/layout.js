import "./globals.css";

export const metadata = {
  title: "Connecteam Operations Manager",
  description:
    "Safe bulk management for Connecteam jobs, doors, users and sub-jobs.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
