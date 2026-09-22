import type { JSONContent } from "@tiptap/react";

export type Category = {
  id: string;
  parentId: string | null;
  name: string;
  order: number;
  favorite: boolean;
  deletedAt: string | null;
};
export type Note = {
  id: string;
  ownerId: string;
  categoryId: string | null;
  title: string;
  document: JSONContent;
  plainText: string;
  sortOrder: number;
  favorite: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};
/** What the note list needs; the document body is fetched only when a note is opened. */
export type NoteSummary = Omit<Note, "document">;
/** A grant of edit access to a note, for a user who has previously signed in. */
export type NoteShare = {
  id: string;
  noteId: string;
  ownerId: string;
  ownerEmail: string;
  sharedWithUserId: string;
  sharedWithEmail: string;
  createdAt: string;
};
export type Asset = {
  id: string;
  blob: Blob;
  mimeType: string;
  byteSize: number;
  createdAt: string;
};
export type ProviderType = "openai" | "anthropic" | "deepseek" | "local";
export type Connection = {
  name: string;
  providerType?: ProviderType;
  baseUrl: string;
  model: string;
};
export const PROVIDERS: { id: ProviderType; label: string; baseUrl: string }[] =
  [
    {
      id: "openai",
      label: "ChatGPT (OpenAI)",
      baseUrl: "https://api.openai.com/v1",
    },
    {
      id: "anthropic",
      label: "Claude (Anthropic)",
      baseUrl: "https://api.anthropic.com",
    },
    { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com" },
    { id: "local", label: "Local", baseUrl: "http://localhost:11434/v1" },
  ];
export type Preferences = {
  fontSize: number;
  reducedMotion: boolean;
  theme: "eva" | "quiet";
  connection: Connection;
  lastBackup?: string;
  noteSort: "recent" | "custom";
};
export const defaults: Preferences = {
  fontSize: 17,
  reducedMotion: false,
  theme: "eva",
  connection: {
    name: "My AI",
    providerType: "openai",
    baseUrl: PROVIDERS[0].baseUrl,
    model: "",
  },
  noteSort: "recent",
};
export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export function textOf(doc: JSONContent): string {
  if (doc.type === "text") return doc.text || "";
  if (doc.type === "image") return doc.attrs?.caption || "";
  return (doc.content || [])
    .map(textOf)
    .join(
      ["doc", "bulletList", "orderedList", "taskList", "summary"].includes(
        doc.type || "",
      )
        ? "\n"
        : "",
    );
}
export function descendants(categories: Category[], id: string): Set<string> {
  const ids = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of categories)
      if (c.parentId && ids.has(c.parentId) && !ids.has(c.id)) {
        ids.add(c.id);
        changed = true;
      }
  }
  return ids;
}
export function categoryPath(
  categories: Category[],
  id: string | null,
): string {
  const parts: string[] = [],
    seen = new Set<string>();
  while (id && !seen.has(id)) {
    seen.add(id);
    const c = categories.find((c) => c.id === id);
    if (!c) break;
    parts.unshift(c.name);
    id = c.parentId;
  }
  return parts.join(" / ") || "Inbox";
}
export function assetIds(doc: JSONContent): string[] {
  return [
    ...(doc.type === "image" && doc.attrs?.assetId
      ? [doc.attrs.assetId as string]
      : []),
    ...(doc.content || []).flatMap(assetIds),
  ];
}
export function safeUrl(value: string): boolean {
  try {
    return ["https:", "http:", "mailto:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
export function hashText(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}
