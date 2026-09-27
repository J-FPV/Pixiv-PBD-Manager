import { createContext, useContext } from "react";
import type { useRecovery } from "./useRecovery";

export const RecoveryContext = createContext<ReturnType<typeof useRecovery> | null>(null);
export function useRecoveryContext() {
  return useContext(RecoveryContext);
}
