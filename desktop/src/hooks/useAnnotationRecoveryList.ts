import { useEffect, useState } from "react";
import { runGuiApi } from "../api";
import { useDebouncedValue } from "./useDebouncedValue";
import type { UnlinkedAnnotations } from "../types";

export function useAnnotationRecoveryList() {
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query, 200);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<UnlinkedAnnotations | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let current = true;
    setLoading(true);
    void runGuiApi<UnlinkedAnnotations>("library.annotations.unlinked", { query: debounced, page })
      .then((result) => { if (current) { setData(result); setPage(result.page); setError(""); } })
      .catch((reason: unknown) => { if (current) setError(String(reason)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [debounced, page, refresh]);
  return { query, setQuery, page, setPage, data, loading, error, setError,
    refresh: () => setRefresh((value) => value + 1) };
}
