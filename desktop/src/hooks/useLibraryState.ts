import { useEffect, useRef, useState } from "react";
import type { DoctorReport, LibraryImage, LibraryIndexStatus } from "../types";

// The library browser's slice of app state, kept separate so useAppState stays
// within its line budget. Spread into the main state bag.
export function useLibraryState() {
  const [libraryImages, setLibraryImages] = useState<LibraryImage[]>([]);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [libraryNeedsScan, setLibraryNeedsScan] = useState(false);
  const [libraryIndexStatus, setLibraryIndexStatus] = useState<LibraryIndexStatus | null>(null);
  const [librarySelectedPath, setLibrarySelectedPath] = useState<string | null>(null);
  const [libraryDoctor, setLibraryDoctor] = useState<DoctorReport | null>(null);
  const [libraryDoctorBusy, setLibraryDoctorBusy] = useState(false);
  const libraryLoadedRef = useRef(false);

  useEffect(() => {
    libraryLoadedRef.current = libraryLoaded;
  }, [libraryLoaded]);

  return {
    libraryImages,
    setLibraryImages,
    libraryLoaded,
    setLibraryLoaded,
    libraryNeedsScan,
    setLibraryNeedsScan,
    libraryIndexStatus,
    setLibraryIndexStatus,
    librarySelectedPath,
    setLibrarySelectedPath,
    libraryDoctor,
    setLibraryDoctor,
    libraryDoctorBusy,
    setLibraryDoctorBusy,
    libraryLoadedRef
  };
}
