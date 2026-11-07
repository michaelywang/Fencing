"use client";

import { useState, type Dispatch, type SetStateAction } from "react";

/**
 * Local state that re-syncs when the incoming prop changes — React's documented
 * "adjusting state when a prop changes" pattern (no effect, no extra commit).
 */
export function useSyncedState<T>(prop: T): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState(prop);
  const [prev, setPrev] = useState(prop);
  if (!Object.is(prop, prev)) {
    setPrev(prop);
    setState(prop);
  }
  return [state, setState];
}
