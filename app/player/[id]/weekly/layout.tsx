import type { Viewport } from 'next';

export const viewport: Viewport = {
  width: 560,
  initialScale: 1,
};

export default function WeeklyLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
