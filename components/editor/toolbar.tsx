"use client";

import * as React from "react";
import { motion } from "framer-motion";
import type { Editor } from "@tiptap/react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Highlighter,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Minus,
  Quote,
  Redo,
  Strikethrough,
  Table2,
  Underline,
  CheckSquare,
  Undo2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ToolbarProps {
  editor: Editor | null;
  onOpenLinkDialog: () => void;
  onExportMarkdown: () => void;
  onExportHtml: () => void;
  onExportJson: () => void;
  onPrintPdf: () => void;
}

const blockButtonClass =
  "h-9 w-9 rounded-xl border border-white/8 bg-white/5 text-white/70 transition-all hover:bg-white/10 hover:text-white";

function isActive(editor: Editor | null, mark: string, attrs?: Record<string, unknown>) {
  if (!editor) return false;
  return editor.isActive(mark, attrs);
}

export function DocumentToolbar({
  editor,
  onOpenLinkDialog,
  onExportMarkdown,
  onExportHtml,
  onExportJson,
  onPrintPdf,
}: ToolbarProps) {
  if (!editor) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="sticky top-0 z-30 border-b border-white/8 bg-[#0b0c0f]/90 px-4 py-3 backdrop-blur-2xl"
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-2xl border border-white/8 bg-white/5 p-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={blockButtonClass}
            onClick={() => editor.chain().focus().undo().run()}
            disabled={!editor.can().undo()}
            aria-label="Undo"
          >
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={blockButtonClass}
            onClick={() => editor.chain().focus().redo().run()}
            disabled={!editor.can().redo()}
            aria-label="Redo"
          >
            <Redo className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-1 rounded-2xl border border-white/8 bg-white/5 p-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(blockButtonClass, isActive(editor, "bold") && "bg-white text-black")}
            onClick={() => editor.chain().focus().toggleBold().run()}
            aria-label="Bold"
          >
            <Bold className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(blockButtonClass, isActive(editor, "italic") && "bg-white text-black")}
            onClick={() => editor.chain().focus().toggleItalic().run()}
            aria-label="Italic"
          >
            <Italic className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(blockButtonClass, isActive(editor, "underline") && "bg-white text-black")}
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            aria-label="Underline"
          >
            <Underline className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(blockButtonClass, isActive(editor, "strike") && "bg-white text-black")}
            onClick={() => editor.chain().focus().toggleStrike().run()}
            aria-label="Strikethrough"
          >
            <Strikethrough className="h-4 w-4" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn("inline-flex items-center justify-center", blockButtonClass, isActive(editor, "highlight") && "bg-white text-black")}
              aria-label="Highlight"
            >
              <Highlighter className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48 p-2 border-white/10 bg-[#101114] text-white">
              <DropdownMenuLabel className="text-xs text-white/45">Highlight Color</DropdownMenuLabel>
              <div className="grid grid-cols-4 gap-1 mb-2">
                {[
                  { name: 'Yellow', color: '#fef08a' },
                  { name: 'Green', color: '#bbf7d0' },
                  { name: 'Blue', color: '#bfdbfe' },
                  { name: 'Pink', color: '#fbcfe8' },
                  { name: 'Orange', color: '#fed7aa' },
                  { name: 'Purple', color: '#e9d5ff' },
                  { name: 'Red', color: '#fecaca' },
                  { name: 'Gray', color: '#e5e7eb' },
                ].map((c) => (
                  <button
                    key={c.color}
                    onClick={() => editor.chain().focus().toggleHighlight({ color: c.color }).run()}
                    className="w-8 h-8 rounded-full border border-white/10 flex items-center justify-center hover:scale-110 transition-transform"
                    style={{ backgroundColor: c.color }}
                    title={c.name}
                  />
                ))}
              </div>
              <DropdownMenuSeparator className="bg-white/8" />
              <DropdownMenuItem onClick={() => editor.chain().focus().unsetHighlight().run()}>
                Remove highlight
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(blockButtonClass, isActive(editor, "code") && "bg-white text-black")}
            onClick={() => editor.chain().focus().toggleCode().run()}
            aria-label="Inline code"
          >
            <Code2 className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-1 rounded-2xl border border-white/8 bg-white/5 p-1">
          <DropdownMenu>
            <DropdownMenuTrigger className="h-9 rounded-xl px-3 text-sm text-white/80 hover:bg-white/10">
              Paragraph
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44 border-white/10 bg-[#101114] text-white">
              <DropdownMenuLabel className="text-xs text-white/45">Text style</DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-white/8" />
              <DropdownMenuItem onClick={() => editor.chain().focus().setParagraph().run()}>Paragraph</DropdownMenuItem>
              <DropdownMenuItem onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>Heading 1</DropdownMenuItem>
              <DropdownMenuItem onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>Heading 2</DropdownMenuItem>
              <DropdownMenuItem onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>Heading 3</DropdownMenuItem>
              <DropdownMenuItem onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()}>Heading 4</DropdownMenuItem>
              <DropdownMenuItem onClick={() => editor.chain().focus().toggleHeading({ level: 5 }).run()}>Heading 5</DropdownMenuItem>
              <DropdownMenuItem onClick={() => editor.chain().focus().toggleHeading({ level: 6 }).run()}>Heading 6</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(blockButtonClass, isActive(editor, "heading", { level: 1 }) && "bg-white text-black")}
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            aria-label="Heading 1"
          >
            <Heading1 className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(blockButtonClass, isActive(editor, "heading", { level: 2 }) && "bg-white text-black")}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            aria-label="Heading 2"
          >
            <Heading2 className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(blockButtonClass, isActive(editor, "heading", { level: 3 }) && "bg-white text-black")}
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            aria-label="Heading 3"
          >
            <Heading3 className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(blockButtonClass, isActive(editor, "heading", { level: 4 }) && "bg-white text-black")}
            onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()}
            aria-label="Heading 4"
          >
            <Heading4 className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(blockButtonClass, isActive(editor, "heading", { level: 5 }) && "bg-white text-black")}
            onClick={() => editor.chain().focus().toggleHeading({ level: 5 }).run()}
            aria-label="Heading 5"
          >
            <Heading5 className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(blockButtonClass, isActive(editor, "heading", { level: 6 }) && "bg-white text-black")}
            onClick={() => editor.chain().focus().toggleHeading({ level: 6 }).run()}
            aria-label="Heading 6"
          >
            <Heading6 className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-1 rounded-2xl border border-white/8 bg-white/5 p-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(blockButtonClass, isActive(editor, "bulletList") && "bg-white text-black")}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            aria-label="Bullet list"
          >
            <List className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(blockButtonClass, isActive(editor, "orderedList") && "bg-white text-black")}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            aria-label="Numbered list"
          >
            <ListOrdered className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(blockButtonClass, isActive(editor, "taskList") && "bg-white text-black")}
            onClick={() => editor.chain().focus().toggleTaskList().run()}
            aria-label="Checklist"
          >
            <CheckSquare className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(blockButtonClass, isActive(editor, "blockquote") && "bg-white text-black")}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            aria-label="Quote"
          >
            <Quote className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={blockButtonClass}
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
            aria-label="Divider"
          >
            <Minus className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(blockButtonClass, isActive(editor, "codeBlock") && "bg-white text-black")}
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            aria-label="Code block"
          >
            <Code2 className="h-4 w-4" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn("inline-flex items-center justify-center", blockButtonClass, isActive(editor, "table") && "bg-white text-black")}
              aria-label="Table"
            >
              <Table2 className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44 border-white/10 bg-[#101114] text-white p-2">
              <DropdownMenuLabel className="text-xs text-white/45">Insert Table</DropdownMenuLabel>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <Button variant="outline" size="sm" onClick={() => editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run()}>2x2</Button>
                <Button variant="outline" size="sm" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>3x3</Button>
                <Button variant="outline" size="sm" onClick={() => editor.chain().focus().insertTable({ rows: 4, cols: 4, withHeaderRow: true }).run()}>4x4</Button>
                <Button variant="outline" size="sm" onClick={() => editor.chain().focus().insertTable({ rows: 5, cols: 5, withHeaderRow: true }).run()}>5x5</Button>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex items-center gap-1 rounded-2xl border border-white/8 bg-white/5 p-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(blockButtonClass, isActive(editor, { textAlign: "left" }) && "bg-white text-black")}
            onClick={() => editor.chain().focus().setTextAlign("left").run()}
            aria-label="Align Left"
          >
            <AlignLeft className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(blockButtonClass, isActive(editor, { textAlign: "center" }) && "bg-white text-black")}
            onClick={() => editor.chain().focus().setTextAlign("center").run()}
            aria-label="Align Center"
          >
            <AlignCenter className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(blockButtonClass, isActive(editor, { textAlign: "right" }) && "bg-white text-black")}
            onClick={() => editor.chain().focus().setTextAlign("right").run()}
            aria-label="Align Right"
          >
            <AlignRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-1 rounded-2xl border border-white/8 bg-white/5 p-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={blockButtonClass}
            onClick={onOpenLinkDialog}
            aria-label="Add link"
          >
            <LinkIcon className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={blockButtonClass}
            onClick={() => editor.chain().focus().setTextAlign("left").run()}
            aria-label="Align left"
          >
            <AlignLeft className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={blockButtonClass}
            onClick={() => editor.chain().focus().setTextAlign("center").run()}
            aria-label="Align center"
          >
            <AlignCenter className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={blockButtonClass}
            onClick={() => editor.chain().focus().setTextAlign("right").run()}
            aria-label="Align right"
          >
            <AlignRight className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={blockButtonClass}
            onClick={() => editor.chain().focus().setTextAlign("justify").run()}
            aria-label="Justify text"
          >
            <AlignJustify className="h-4 w-4" />
          </Button>
        </div>

        <div className="ml-auto flex items-center gap-1 rounded-2xl border border-white/8 bg-white/5 p-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={blockButtonClass}
            onClick={() => editor.chain().focus().undo().run()}
            aria-label="Undo"
          >
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={blockButtonClass}
            onClick={() => editor.chain().focus().redo().run()}
            aria-label="Redo"
          >
            <Redo className="h-4 w-4" />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger className="h-9 rounded-xl px-3 text-sm text-white/80 hover:bg-white/10">
              Export
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52 border-white/10 bg-[#101114] text-white">
              <DropdownMenuLabel className="text-xs text-white/45">Export document</DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-white/8" />
              <DropdownMenuItem onClick={onExportMarkdown}>Markdown</DropdownMenuItem>
              <DropdownMenuItem onClick={onExportHtml}>HTML</DropdownMenuItem>
              <DropdownMenuItem onClick={onExportJson}>JSON</DropdownMenuItem>
              <DropdownMenuSeparator className="bg-white/8" />
              <DropdownMenuItem onClick={onPrintPdf}>Print / PDF</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </motion.div>
  );
}
