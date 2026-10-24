import { createContext, type ReactNode, useCallback, useContext, useState } from 'react';

const Announce = createContext<(message: string) => void>(() => undefined);

/**
 * A polite live region: what changed on the screen (an item added to the order, a scan) is read
 * out by screen readers without moving focus.
 */
export function Announcer({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState('');
  const announce = useCallback((text: string) => {
    // A repeated message must still be read: clear first, then set.
    setMessage('');
    requestAnimationFrame(() => {
      setMessage(text);
    });
  }, []);
  return (
    <Announce.Provider value={announce}>
      {children}
      <div aria-live="polite" role="status" className="sr-only" data-testid="announcer">
        {message}
      </div>
    </Announce.Provider>
  );
}

export function useAnnounce(): (message: string) => void {
  return useContext(Announce);
}
