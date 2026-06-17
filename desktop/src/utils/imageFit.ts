export interface Size {
  width: number;
  height: number;
}

export function containSize(box: Size, image: Size): Size | undefined {
  if (box.width <= 0 || box.height <= 0 || image.width <= 0 || image.height <= 0) {
    return undefined;
  }
  const scale = Math.min(box.width / image.width, box.height / image.height);
  return {
    width: Math.max(1, Math.floor(image.width * scale)),
    height: Math.max(1, Math.floor(image.height * scale))
  };
}
