'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Settings } from 'lucide-react';
import { JACLogo } from '@/components/shared/jac-logo';
import { cn } from '@/lib/utils';

const NAV_LINKS = [
  { href: '/', label: 'Accueil' },
  { href: '/propagate', label: 'Propagation' },
  { href: '/translate', label: 'Traduction' },
  { href: '/glossary', label: 'Glossaire' },
];

export function Navbar() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-white">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-3">
            <JACLogo />
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  'rounded px-3 py-2 text-sm font-medium transition-colors',
                  pathname === link.href
                    ? 'bg-jac-bg-alt text-jac-dark'
                    : 'text-jac-text-secondary hover:bg-jac-bg-alt hover:text-jac-dark'
                )}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-4">
          <span className="hidden text-lg font-bold tracking-tight text-jac-dark sm:block">
            DocPropag
          </span>
          <Link
            href="/admin"
            className={cn(
              'inline-flex items-center gap-2 rounded px-3 py-2 text-sm font-medium transition-colors',
              pathname === '/admin'
                ? 'bg-jac-dark text-white'
                : 'border border-border text-jac-text-secondary hover:bg-jac-bg-alt'
            )}
          >
            <Settings className="h-4 w-4" />
            <span className="hidden sm:inline">Admin</span>
          </Link>
        </div>
      </div>
    </header>
  );
}
