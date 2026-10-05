import { lazy, Suspense, useLayoutEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import { motion, MotionConfig } from 'framer-motion';
import { isMorphing } from '@/lib/card-morph';
import { EASE_OUT_QUINT } from '@/lib/motion';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';
import Incidents from './pages/Incidents';
import { historyModule } from './pages/history-loader';
import { Skeleton } from '@/components/ui/skeleton';

// History carries the charting library, which is a third of the bundle and unused elsewhere, so it loads on first visit
// (or while the dashboard idles; see history-loader).
const History = lazy(historyModule);

/** The shape of a page while its code arrives: a heading and a block, so nothing jumps when it lands. */
function PageLoading() {
  return (
    <div className="flex-1 space-y-6" aria-busy aria-label="Loading the page">
      <div className="space-y-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-64" />
      </div>
      <Skeleton className="h-96 rounded-xl" />
    </div>
  );
}
import { AppSidebar } from "@/components/app-sidebar"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"


// A page settles in with a short rise and a fade. There is no exit: the old page goes at once,
// so a click is answered on the next frame instead of after a fade-out. Reduced motion
// (MotionConfig below) drops the rise and keeps the fade. During the card-to-History move the
// rise is skipped too, since the header the move lands on must already be in its place.
const pageTransition = { duration: 0.22, ease: EASE_OUT_QUINT };

function Page({ children }: { children: React.ReactNode }) {
  const [rise] = useState(() => (isMorphing() ? 0 : 8));
  return (
    <motion.div initial={{ opacity: 0, y: rise }} animate={{ opacity: 1, y: 0 }} transition={pageTransition}>
      {children}
    </motion.div>
  );
}

function AnimatedRoutes() {
  const location = useLocation();
  // A new page starts at its top; a day or filter change (same path) keeps the scroll.
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <Routes location={location}>
      <Route path="/" element={<Page><Dashboard /></Page>} />
      <Route path="/incidents" element={<Page><Incidents /></Page>} />
      <Route path="/settings" element={<Page><Settings /></Page>} />
      <Route
        path="/history/:deviceId?"
        element={
          <Page>
            <Suspense fallback={<PageLoading />}>
              <History />
            </Suspense>
          </Page>
        }
      />
    </Routes>
  );
}

function App() {
  return (
    <MotionConfig reducedMotion="user">
      <Router>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <header className="flex h-16 shrink-0 items-center gap-2">
            <div className="flex items-center gap-2 px-4">
              <SidebarTrigger className="-ml-1" />
              <Separator orientation="vertical" className="mr-2 h-4" />
            </div>
          </header>
          <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
            <AnimatedRoutes />
          </div>
        </SidebarInset>
      </SidebarProvider>
    </Router>
    </MotionConfig>
  );
}

export default App;

