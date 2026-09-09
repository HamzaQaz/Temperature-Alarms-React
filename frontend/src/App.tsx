import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import { AnimatePresence, motion, MotionConfig } from 'framer-motion';
import { EASE_OUT_QUINT } from '@/lib/motion';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';
import { Skeleton } from '@/components/ui/skeleton';

// History carries the charting library, which is a third of the bundle and unused elsewhere, so it loads on first visit.
const History = lazy(() => import('./pages/History'));

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


// A page settles in with a short rise and leaves with a quicker fade, so a route change reads
// as one motion rather than two. Reduced motion (MotionConfig below) drops the rise and keeps the fade.
const pageVariants = {
  initial: { opacity: 0, y: 8 },
  in: { opacity: 1, y: 0 },
  out: { opacity: 0, transition: { duration: 0.12, ease: EASE_OUT_QUINT } },
};

const pageTransition = { duration: 0.22, ease: EASE_OUT_QUINT };

function AnimatedRoutes() {
  const location = useLocation();
  
  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route path="/" element={
          <motion.div
            initial="initial"
            animate="in"
            exit="out"
            variants={pageVariants}
            transition={pageTransition}
          >
            <Dashboard />
          </motion.div>
        } />
        <Route path="/settings" element={
          <motion.div
            initial="initial"
            animate="in"
            exit="out"
            variants={pageVariants}
            transition={pageTransition}
          >
            <Settings />
          </motion.div>
        } />
        <Route path="/history/:deviceId?" element={
          <motion.div
            initial="initial"
            animate="in"
            exit="out"
            variants={pageVariants}
            transition={pageTransition}
          >
            <Suspense fallback={<PageLoading />}>
              <History />
            </Suspense>
          </motion.div>
        } />
      </Routes>
    </AnimatePresence>
  );
}

function App() {
  return (
    <MotionConfig reducedMotion="user">
      <Router>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
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

