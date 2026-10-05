import { Link, useLocation } from 'react-router-dom';
import { Placeholder } from '@/components/Placeholder';
import { Button } from '@/components/ui/button';
import { usePageTitle } from '@/hooks/use-page-title';

/** Any address the site does not have: say so, with the address, and offer the way back. */
export default function NotFound() {
  usePageTitle('Page not found');
  const { pathname } = useLocation();
  return (
    <div className="flex-1 space-y-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight">Page not found</h1>
        <p className="text-muted-foreground">There is no page at this address.</p>
      </header>
      <Placeholder>
        <p className="font-medium break-all">
          Nothing at {pathname}
        </p>
        <p className="max-w-sm text-sm text-muted-foreground">The link may be old, or the address mistyped. The dashboard has every closet.</p>
        <Button asChild variant="outline" size="sm">
          <Link to="/">Go to the dashboard</Link>
        </Button>
      </Placeholder>
    </div>
  );
}
