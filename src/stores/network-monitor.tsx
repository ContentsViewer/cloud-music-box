'use client'

import { createContext, useContext, useEffect, useState } from "react";

interface NetworkMonitorProps {
  isOnline: boolean;
}

export const NetworkMonitor = createContext<NetworkMonitorProps>({
  isOnline: false,
});

export const useNetworkMonitor = () => {
  return useContext(NetworkMonitor);
}

export const NetworkMonitorProvider = ({ children }: { children: React.ReactNode }) => {
  const [isOnline, setIsOnline] = useState(false);

  useEffect(() => {
    setIsOnline(navigator.onLine);

    const onOffline = () => setIsOnline(false);
    const onOnline = () => setIsOnline(true);

    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);

    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    }
  }, [])

  return (
    <NetworkMonitor.Provider value={{ isOnline: isOnline }}>
      {children}
    </NetworkMonitor.Provider>
  )
}
