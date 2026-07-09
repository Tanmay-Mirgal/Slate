import * as React from "react";
import { BubbleMenu } from "@tiptap/react/menus";
import type { Editor } from "@tiptap/react";
import { 
  ArrowLeft, ArrowRight, ArrowUp, ArrowDown, Trash2, SplitSquareHorizontal, Merge
} from "lucide-react";

interface TableBubbleMenuProps {
  editor: Editor | null;
}

export function TableBubbleMenu({ editor }: TableBubbleMenuProps) {
  if (!editor) return null;

  return (
    <BubbleMenu
      editor={editor}
      shouldShow={({ editor }) => editor.isActive('table')}
      className="flex items-center gap-1 p-1 bg-[#1A1A1A] border border-[#2B2B2B] rounded-xl shadow-xl overflow-hidden"
    >
      <button
        onClick={() => editor.chain().focus().addColumnBefore().run()}
        className="p-1.5 rounded-lg text-white/70 hover:bg-white/10 hover:text-white transition-colors"
        title="Add column before"
      >
        <ArrowLeft className="w-4 h-4" />
      </button>
      <button
        onClick={() => editor.chain().focus().addColumnAfter().run()}
        className="p-1.5 rounded-lg text-white/70 hover:bg-white/10 hover:text-white transition-colors"
        title="Add column after"
      >
        <ArrowRight className="w-4 h-4" />
      </button>
      <button
        onClick={() => editor.chain().focus().addRowBefore().run()}
        className="p-1.5 rounded-lg text-white/70 hover:bg-white/10 hover:text-white transition-colors"
        title="Add row before"
      >
        <ArrowUp className="w-4 h-4" />
      </button>
      <button
        onClick={() => editor.chain().focus().addRowAfter().run()}
        className="p-1.5 rounded-lg text-white/70 hover:bg-white/10 hover:text-white transition-colors"
        title="Add row after"
      >
        <ArrowDown className="w-4 h-4" />
      </button>
      <div className="w-[1px] h-4 bg-white/10 mx-1" />
      <button
        onClick={() => editor.chain().focus().mergeCells().run()}
        className="p-1.5 rounded-lg text-white/70 hover:bg-white/10 hover:text-white transition-colors"
        title="Merge cells"
      >
        <Merge className="w-4 h-4" />
      </button>
      <button
        onClick={() => editor.chain().focus().splitCell().run()}
        className="p-1.5 rounded-lg text-white/70 hover:bg-white/10 hover:text-white transition-colors"
        title="Split cell"
      >
        <SplitSquareHorizontal className="w-4 h-4" />
      </button>
      <div className="w-[1px] h-4 bg-white/10 mx-1" />
      <button
        onClick={() => editor.chain().focus().deleteColumn().run()}
        className="p-1.5 rounded-lg text-red-400 hover:bg-red-500/20 hover:text-red-500 transition-colors"
        title="Delete column"
      >
        <Trash2 className="w-4 h-4" />
      </button>
      <button
        onClick={() => editor.chain().focus().deleteRow().run()}
        className="p-1.5 rounded-lg text-red-400 hover:bg-red-500/20 hover:text-red-500 transition-colors"
        title="Delete row"
      >
        <Trash2 className="w-4 h-4" />
      </button>
      <button
        onClick={() => editor.chain().focus().deleteTable().run()}
        className="px-2 py-1.5 rounded-lg text-xs font-medium text-red-400 hover:bg-red-500/20 hover:text-red-500 transition-colors"
        title="Delete table"
      >
        Delete Table
      </button>
    </BubbleMenu>
  );
}
