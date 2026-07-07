"use client";

import * as React from "react";

export function useDebouncedCallback<TArgs extends unknown[]>(
  callback: (...args: TArgs) => unknown,
  delay: number
) {
  const callbackRef = React.useRef(callback);
  const timeoutRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  React.useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return React.useCallback((...args: TArgs) => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = window.setTimeout(() => {
      callbackRef.current(...args);
    }, delay);
  }, [delay]);
}
