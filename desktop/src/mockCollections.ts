import type { CollectionList, ImageCollection } from "./types.collections";
import { MOCK_LIBRARY_IMAGES } from "./mockData";

export function mockCollectionsCommand(command: string, values: Record<string, unknown>) {
  const key = "pbd-mock-collections";
  const data: CollectionList = JSON.parse(localStorage.getItem(key) || '{"store_id":"mock-store","collections":[]}');
  const collection = data.collections.find((item) => item.id === values.id);
  if (command === "collections.create") {
    const item = { ...values, id: crypto.randomUUID().replace(/-/g, ""), members: [], member_count: 0, revision: "1" } as unknown as ImageCollection;
    data.collections.push(item); localStorage.setItem(key, JSON.stringify(data)); return { id: item.id };
  }
  if (command === "collections.update" && collection) Object.assign(collection, values, { revision: String(Number(collection.revision) + 1) });
  if (command === "collections.delete") data.collections = data.collections.filter((item) => item.id !== values.id);
  if (command === "collections.members.add" && collection) {
    for (const id of values.image_ids as string[]) {
      const image = MOCK_LIBRARY_IMAGES.find((item) => item.image_id === id);
      if (image && !collection.members.some((member) => member.image_id === id)) collection.members.push({ store_id: data.store_id, image_id: id, path: image.path, status: "linked", available: true });
    }
  }
  if (command === "collections.members.remove" && collection) collection.members = collection.members.filter((member) => !(values.members as { image_id: string }[]).some((item) => member.image_id === item.image_id));
  for (const item of data.collections) item.member_count = item.members.length;
  localStorage.setItem(key, JSON.stringify(data));
  if (command === "collections.list" && collection?.kind === "smart" && Array.isArray(values.image_ids)) {
    const ids = new Set(values.image_ids);
    collection.members = MOCK_LIBRARY_IMAGES.filter((image) => ids.has(image.image_id)).map((image) => ({ store_id: data.store_id, image_id: image.image_id, path: image.path, available: true, status: "linked" }));
  }
  return data;
}
