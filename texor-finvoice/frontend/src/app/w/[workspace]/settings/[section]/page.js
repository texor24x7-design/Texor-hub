'use client';

import { Suspense, use } from 'react';
import { ActivitySettings, EditionSettings, IntegrationsSettings, MessagesSettings } from '@/components/settings/OtherSettings';
import { BrandingSettings } from '@/components/settings/BrandingSettings';
import { BusinessSettings } from '@/components/settings/BusinessSettings';
import { DesignsSettings } from '@/components/settings/DesignsSettings';
import { ModulesSettings } from '@/components/settings/ModulesSettings';
import { PreferencesSettings } from '@/components/settings/PreferencesSettings';
import { SettingsLayout } from '@/components/settings/SettingsLayout';
import { Alert } from '@/components/ui';
import { useWorkspace } from '@/lib/workspace';

const SCREENS = {
  business: BusinessSettings,
  branding: BrandingSettings,
  preferences: PreferencesSettings,
  modules: ModulesSettings,
  designs: DesignsSettings,
  messages: MessagesSettings,
  integrations: IntegrationsSettings,
  edition: EditionSettings,
  activity: ActivitySettings,
};

export default function SettingsSection({ params }) {
  const { section } = use(params);
  const { can } = useWorkspace();
  const Screen = SCREENS[section];
  if (!can('settings', 'view') && section !== 'integrations') {
    return <SettingsLayout section={section} title="Settings"><Alert kind="info">Your role does not include workspace settings.</Alert></SettingsLayout>;
  }
  if (!Screen) return <SettingsLayout section={section} title="Not found"><Alert>There is no such settings page.</Alert></SettingsLayout>;
  return <Suspense><Screen /></Suspense>;
}
