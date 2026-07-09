import * as React from "react";
import { BubbleMenu } from "@tiptap/react/menus";
import type { Editor } from "@tiptap/react";
import { 
  Bold, Italic, Underline, Strikethrough, Link, Highlighter, Code2, MessageSquare
} from "lucide-react";
import { cn } from "@/lib/utils";

interface DocumentBubbleMenuProps {
  editor: Editor | null;
  onOpenLinkDialog: () => void;
}

export function DocumentBubbleMenu({ editor, onOpenLinkDialog }: DocumentBubbleMenuProps) {
  if (!editor) return null;

  return (
    <BubbleMenu
      editor={editor}
      className="flex items-center gap-1 p-1 bg-[#1A1A1A] border border-[#2B2B2B] rounded-xl shadow-xl overflow-hidden"
    >
      <button
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={cn(
          "p-1.5 rounded-lg text-white/70 hover:bg-white/10 hover:text-white transition-colors",
          editor.isActive("bold") && "bg-white/10 text-white"
        )}
      >
        <Bold className="w-4 h-4" />
      </button>
      <button
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={cn(
          "p-1.5 rounded-lg text-white/70 hover:bg-white/10 hover:text-white transition-colors",
          editor.isActive("italic") && "bg-white/10 text-white"
        )}
      >
        <Italic className="w-4 h-4" />
      </button>
      <button
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        className={cn(
          "p-1.5 rounded-lg text-white/70 hover:bg-white/10 hover:text-white transition-colors",
          editor.isActive("underline") && "bg-white/10 text-white"
        )}
      >
        <Underline className="w-4 h-4" />
      </button>
      <button
        onClick={() => editor.chain().focus().toggleStrike().run()}
        className={cn(
          "p-1.5 rounded-lg text-white/70 hover:bg-white/10 hover:text-white transition-colors",
          editor.isActive("strike") && "bg-white/10 text-white"
        )}
      >
        <Strikethrough className="w-4 h-4" />
      </button>
      <button
        onClick={() => editor.chain().focus().toggleCode().run()}
        className={cn(
          "p-1.5 rounded-lg text-white/70 hover:bg-white/10 hover:text-white transition-colors",
          editor.isActive("code") && "bg-white/10 text-white"
        )}
      >
        <Code2 className="w-4 h-4" />
      </button>
      <div className="w-[1px] h-4 bg-white/10 mx-1" />
      <button
        onClick={onOpenLinkDialog}
        className={cn(
          "p-1.5 rounded-lg text-white/70 hover:bg-white/10 hover:text-white transition-colors",
          editor.isActive("link") && "bg-white/10 text-white"
        )}
      >
        <Link className="w-4 h-4" />
      </button>
      <button
        onClick={() => editor.chain().focus().toggleHighlight().run()}
        className={cn(
          "p-1.5 rounded-lg text-white/70 hover:bg-white/10 hover:text-white transition-colors",
          editor.isActive("highlight") && "bg-white/10 text-white"
        )}
      >
        <Highlighter className="w-4 h-4" />
      </button>
      <button
        onClick={() => {}}
        className="p-1.5 rounded-lg text-white/70 hover:bg-white/10 hover:text-white transition-colors"
      >
        <MessageSquare className="w-4 h-4" />
      </button>
    </BubbleMenu>
  );
}
