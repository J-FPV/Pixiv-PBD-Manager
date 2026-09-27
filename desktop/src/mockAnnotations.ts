import { MOCK_LIBRARY_IMAGES } from "./mockData";
import type { UnlinkedAnnotation } from "./types";

const entries: UnlinkedAnnotation[] = [
  { image_id: "unlinked-1", annotation_revision: 1, old_path: "C:\\OldLibrary\\reference-original.png",
    reason: "missing", error: "", verified: false, tags: ["reference", "composition"],
    favorite: true, rating: 5, markers: ["high_value"], candidate_ids: ["mock-101000001-1"] },
  { image_id: "unlinked-2", annotation_revision: 2, old_path: "C:\\OldLibrary\\sketch-original.png",
    reason: "changed", error: "", verified: true, tags: ["sketch"],
    favorite: false, rating: 3, markers: ["used"], candidate_ids: ["mock-101000002-0"] }
];

export function mockAnnotationStatus() {
  return { pending: 0, protected: MOCK_LIBRARY_IMAGES.filter((image) => image.annotation_revision > 0).length,
    unlinked: entries.length, errors: 0 };
}

export function mockAnnotationCommand(command: string, values: Record<string, unknown>) {
  if (command === "library.annotations.protect") return mockAnnotationStatus();
  if (command === "library.annotations.unlinked") {
    const page = Number(values.page) || 1;
    const query = String(values.query ?? "").toLowerCase();
    const filtered = entries.filter((entry) => (entry.old_path + entry.tags.join(" ")).toLowerCase().includes(query));
    return { entries: filtered.slice((page - 1) * 50, page * 50), page, page_size: 50,
      total: filtered.length, annotation_status: mockAnnotationStatus() };
  }
  const source = entries.find((entry) => entry.image_id === values.image_id);
  const target = MOCK_LIBRARY_IMAGES.find((image) => image.image_id === values.target_id);
  if (!source || !target || target.annotation_revision) throw new Error("Target has its own annotations");
  if ((!source.verified || !source.candidate_ids.includes(target.image_id)) && !values.confirm_unverified) {
    return { confirmation_required: true, reason: source.verified ? "content_mismatch" : "unverified" };
  }
  Object.assign(target, { image_id: source.image_id, annotation_revision: source.annotation_revision + 1,
    tags: source.tags, rating: source.rating, favorite: source.favorite, markers: source.markers });
  entries.splice(entries.indexOf(source), 1);
  return { confirmation_required: false, image: target, annotation_status: mockAnnotationStatus() };
}
