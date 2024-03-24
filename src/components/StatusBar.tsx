'use client'
import { useState } from "react";

export function StatusBar() {
  const [isOffline, setIsOffline] = useState(false);

  window.addEventListener('offline', () => setIsOffline(true));
  window.addEventListener('online', () => setIsOffline(false));
  
  return (
    <div className="items-end justify-center bg-gradient-to-t from-white via-white dark:from-black dark:via-black lg:static lg:h-auto lg:w-auto lg:bg-none">
      <div className="pointer-events-none flex place-items-center gap-2 p-8 lg:pointer-events-auto lg:p-0">
        {isOffline ? (
          <p className="text-red-500">You are offline</p>
        ) : (
          <p className="text-green-500">You are online</p>
        )}
      </div>
    </div>
  )
}