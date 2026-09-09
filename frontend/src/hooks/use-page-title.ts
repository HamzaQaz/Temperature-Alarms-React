import { useEffect } from 'react';

const APP = 'Temperature Alarms';

/** Name the browser tab after the page, so history, bookmarks, and a screen reader can tell pages apart. */
export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} · ${APP}`;
    return () => {
      document.title = APP;
    };
  }, [title]);
}
