import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Highlight from "@tiptap/extension-highlight";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { BlockIds, LocalImage, Summary } from "./extensions";
import { safeUrl } from "../model";
export function documentExtensions() {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: {
        openOnClick: false,
        autolink: true,
        isAllowedUri: (url) => safeUrl(url),
      },
    }),
    Highlight.configure({ multicolor: true }),
    TaskList,
    TaskItem.configure({ nested: true }),
    BlockIds,
    LocalImage,
    Summary,
  ];
}
export function checkDocument(document: unknown) {
  getSchema(documentExtensions()).nodeFromJSON(document).check();
}
