import { describe, expect, it } from "vitest";
import { imageFilesFromClipboard, imageIntakeError } from "../src/client/image-drafts.js";

const limits = {
  maxImageBytes: 10,
  maxImagesPerMessage: 2,
  maxMessageImageBytes: 15,
  maxImagePixels: 1_000,
  maxImageDimension: 100,
  mediaTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
} as const;

function file(name: string, type: string, size: number): File {
  return { name, type, size } as File;
}

describe("Companion image drafts", () => {
  it("refuses a complete incoming batch before creating drafts", () => {
    expect(imageIntakeError([], [file("one.png", "image/png", 8), file("two.png", "image/png", 8)], limits)).toBe("图片总大小超出限制。");
    expect(imageIntakeError([], [file("one.heic", "image/heic", 1)], limits)).toBe("只支持 PNG、JPEG、WebP 或 GIF。");
    expect(imageIntakeError([{ file: file("old.png", "image/png", 1) } as never], [file("one.png", "image/png", 1), file("two.png", "image/png", 1)], limits)).toBe("一次最多 2 张图片。");
  });

  it("keeps clipboard image order and ignores non-image clipboard files", () => {
    const first = file("first.png", "image/png", 1);
    const second = file("second.jpeg", "image/jpeg", 1);
    const nonImage = file("notes.txt", "text/plain", 1);
    const clipboard = {
      items: [
        { kind: "file", type: "image/png", getAsFile: () => first },
        { kind: "string", type: "text/plain", getAsFile: () => null },
        { kind: "file", type: "image/jpeg", getAsFile: () => second },
      ],
      files: [first, nonImage, second],
    } as unknown as DataTransfer;
    expect(imageFilesFromClipboard(clipboard)).toEqual([first, second]);
  });
});
