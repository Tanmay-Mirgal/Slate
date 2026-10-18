import * as React from "react";
import { BubbleMenu } from "@tiptap/react/menus";
import type { Editor } from "@tiptap/react";
import { Copy, Trash2 } from "lucide-react";

interface ImageBubbleMenuProps {
  editor: Editor | null;
}

export function ImageBubbleMenu({ editor }: ImageBubbleMenuProps) {
  const copyImage = React.useCallback(() => {
    if (!editor) return;
    const { state } = editor;
    const { selection } = state;
    if (selection.empty) return;
    
    const node = state.doc.nodeAt(selection.from);
    if (node && node.type.name === 'image') {
      const src = node.attrs.src;
      // Copy image source to clipboard
      navigator.clipboard.writeText(src);
    }
  }, [editor]);

  const deleteImage = React.useCallback(() => {
    if (!editor) return;
    editor.chain().focus().deleteSelection().run();
  }, [editor]);

  if (!editor) return null;

  return (
    <BubbleMenu
      editor={editor}
      shouldShow={({ editor }) => editor.isActive('image')}
      className="flex items-center gap-1 p-1 bg-[#1A1A1A] border border-[#2B2B2B] rounded-xl shadow-xl overflow-hidden"
    >
      <button
        type="button"
        onClick={copyImage}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium text-white/70 hover:bg-white/10 hover:text-white transition-colors"
        title="Copy Image URL"
      >
        <Copy className="w-4 h-4" />
        Copy
      </button>
      
      <div className="w-[1px] h-4 bg-white/10 mx-1" />
      
      <button
        type="button"
        onClick={deleteImage}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium text-red-400/70 hover:bg-red-400/10 hover:text-red-400 transition-colors"
        title="Delete Image"
      >
        <Trash2 className="w-4 h-4" />
        Delete
      </button>
    </BubbleMenu>
  );
}
