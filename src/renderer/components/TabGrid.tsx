import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../state/store';
import { TabCard } from './TabCard';
import type { TabState } from '../../shared/types';

export function TabGrid() {
  const tabs = useStore(useShallow((s) => Object.values(s.tabs))) as TabState[];

  return (
    <div className="grid grid-cols-5 gap-3 p-4">
      {tabs.length === 0 && (
        <p className="text-neutral-500 text-sm col-span-full text-center py-8">
          No tabs yet. Click "Spawn Tabs" to get started.
        </p>
      )}
      {tabs.map((tab) => (
        <TabCard key={tab.id} tab={tab} />
      ))}
    </div>
  );
}