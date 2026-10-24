import { createContext, useContext, useState, type ReactNode } from 'react';
import type { DisplaySettings } from '@three/types';

type UIState = DisplaySettings & {
  setEnableGrid: (value: boolean) => void;
  setDisplayLegend: (value: boolean) => void;
  setDisplayFault: (value: boolean) => void;
};
const UIContext = createContext<UIState | null>(null);
export const UIProvider = ({ children, initial }: { children: ReactNode; initial?: DisplaySettings }) => {
  const [enableGrid, setEnableGrid] = useState(initial?.enableGrid ?? true);
  const [displayLegend, setDisplayLegend] = useState(initial?.displayLegend ?? true);
  const [displayFault, setDisplayFault] = useState(initial?.displayFault ?? true);
  return (
    <UIContext.Provider
      value={{ enableGrid, setEnableGrid, displayLegend, setDisplayLegend, displayFault, setDisplayFault }}
    >
      {children}
    </UIContext.Provider>
  );
};
export const useUIContext = () => {
  const context = useContext(UIContext);
  if (!context) throw new Error('UIProvider is required');
  return context;
};
