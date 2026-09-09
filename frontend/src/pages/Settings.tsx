import { useCallback, useState } from 'react';
import { usePageTitle } from '@/hooks/use-page-title';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AdminTokenPanel } from '@/components/AdminTokenPanel';
import { CampusesSection } from '@/components/settings/CampusesSection';
import { DevicesSection } from '@/components/settings/DevicesSection';
import { useAdminToken } from '@/hooks/use-admin-token';
import { clearAdminToken, setAdminToken } from '@/lib/adminToken';

const TABS = ['campuses', 'devices'] as const;
type Tab = (typeof TABS)[number];

function isTab(value: string | null): value is Tab {
  return TABS.includes(value as Tab);
}

/**
 * Settings: Campuses, Devices, and the Admin token that authorises changes to them.
 * Anyone can read the lists; the token is asked for once and kept in this browser.
 */
export default function Settings() {
  usePageTitle('Settings');
  const token = useAdminToken();
  const [rejected, setRejected] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('tab');
  const tab: Tab = isTab(requested) ? requested : 'campuses';

  const onUnauthorised = useCallback(() => {
    clearAdminToken();
    setRejected(true);
  }, []);

  const saveToken = (value: string) => {
    setAdminToken(value);
    setRejected(false);
  };

  const forgetToken = () => {
    clearAdminToken();
    setRejected(false);
  };

  return (
    <div className="mx-auto w-full max-w-4xl flex-1 space-y-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Campuses and Devices the dashboard shows, and the token that lets you change them.</p>
      </header>

      <AdminTokenPanel hasToken={token !== null} rejected={rejected} onSave={saveToken} onForget={forgetToken} onDismissRejection={() => setRejected(false)} />

      <Tabs value={tab} onValueChange={(next) => setSearchParams(next === 'campuses' ? {} : { tab: next }, { replace: true })}>
        <TabsList aria-label="Settings sections">
          <TabsTrigger value="campuses">Campuses</TabsTrigger>
          <TabsTrigger value="devices">Devices</TabsTrigger>
        </TabsList>
        <TabsContent value="campuses" tabIndex={-1} className="pt-4">
          <CampusesSection canEdit={token !== null} onUnauthorised={onUnauthorised} />
        </TabsContent>
        <TabsContent value="devices" tabIndex={-1} className="pt-4">
          <DevicesSection canEdit={token !== null} onUnauthorised={onUnauthorised} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
