"use client";

import { Extension } from "@tiptap/core";

export interface DocumentShortcutCallbacks {
  onOpenSlashMenu: () => void;
  onOpenLinkDialog: () => void;
}

export const DocumentShortcuts = Extension.create<DocumentShortcutCallbacks>({
  name: "documentShortcuts",

  addOptions() {
    return {
      onOpenSlashMenu: () => {},
      onOpenLinkDialog: () => {},
    };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-k": () => {
        this.options.onOpenLinkDialog();
        return true;
      },
      "Mod-/": () => {
        this.options.onOpenSlashMenu();
        return true;
      },
      "Mod-Shift-7": () => this.editor.chain().focus().toggleOrderedList().run(),
      "Mod-Shift-8": () => this.editor.chain().focus().toggleBulletList().run(),
      "Mod-u": () => this.editor.chain().focus().toggleUnderline().run(),
    };
  },
});
