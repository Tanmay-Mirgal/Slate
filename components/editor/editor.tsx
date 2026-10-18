"use client";

import * as React from "react";
import type { JSONContent } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import HorizontalRule from "@tiptap/extension-horizontal-rule";
import { ImageWithCaption } from "@/components/editor/extensions/image-with-caption";
import Typography from "@tiptap/extension-typography";
import Gapcursor from "@tiptap/extension-gapcursor";
import Dropcursor from "@tiptap/extension-dropcursor";
import Color from "@tiptap/extension-color";
import { TextStyle } from "@tiptap/extension-text-style";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import { Callout } from "@/components/editor/extensions/callout";
import { Toggle } from "@/components/editor/extensions/toggle";
import { ColumnBlock, Column } from "@/components/editor/extensions/columns";
import { CheckSquare, FileText, Heading1, ImagePlus, Network, Search, Sparkles, Table2, Type, Info, Columns2, ListTree, UploadCloud } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { DocumentEditorProvider } from "@/components/editor/editor-provider";
import { DocumentToolbar } from "@/components/editor/toolbar";
import { DocumentBubbleMenu } from "@/components/editor/bubble-menu";
import { TableBubbleMenu } from "@/components/editor/table-menu";
import { ImageBubbleMenu } from "@/components/editor/image-menu";
import { SlashMenu, type SlashCommandItem } from "@/components/editor/slash-menu";
import {
  DEFAULT_DOCUMENT_CONTENT,
  looksLikeMarkdown,
  markdownToTiptapContent,
  tiptapContentToMarkdown,
} from "@/components/editor/markdown-parser";
import { useDebouncedCallback } from "@/components/editor/hooks/use-debounced-callback";
import type { DocBridge } from "@/components/editor/doc-bridge";
import type { Editor } from "@tiptap/react";

const lowlight = createLowlight(common);

interface DocumentEditorProps {
  initialMarkdown?: string | null;
  initialJson?: string | null;
  readOnly?: boolean;
  onPersist: (payload: {
    markdown: string;
    html: string;
    json: string;
  }) => Promise<void> | void;
  onSearchCommand?: () => void;
  /** Lets the canvas side reach the live editor (word count, snapshots, generated docs). */
  bridge?: DocBridge;
  /** Powers the /canvas-snapshot slash command. */
  onInsertCanvasSnapshot?: () => void;
}

type SlashState = {
  open: boolean;
  query: string;
  range: { from: number; to: number } | null;
  position: { left: number; top: number } | null;
  selectedIndex: number;
};

function buildPrintableDocument(title: string, html: string) {
  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>${title}</title>
      <style>
        @page { margin: 24mm; }
        body {
          margin: 0;
          font-family: Geist, Inter, ui-sans-serif, system-ui, sans-serif;
          background: #0a0a0a;
          color: #fff;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .page {
          max-width: 860px;
          margin: 0 auto;
          padding: 24px;
        }
        .doc {
          white-space: normal;
          line-height: 1.7;
        }
        .doc pre {
          background: #111318;
          color: #e5e7eb;
          border: 1px solid #27282f;
          border-radius: 16px;
          padding: 16px;
          overflow: hidden;
        }
        .doc code {
          font-family: "IBM Plex Mono", "Geist Mono", ui-monospace, monospace;
        }
        .doc table {
          width: 100%;
          border-collapse: collapse;
        }
        .doc td, .doc th {
          border: 1px solid #2a2d36;
          padding: 8px 10px;
        }
      </style>
    </head>
    <body>
      <div class="page">
        <div class="doc">${html}</div>
      </div>
      <script>window.addEventListener('load', () => window.print());</script>
    </body>
  </html>`;
}

function normalizeInitialContent(initialMarkdown?: string | null, initialJson?: string | null) {
  if (initialJson) {
    try {
      const parsed = JSON.parse(initialJson) as JSONContent;
      if (parsed?.type === "doc") return parsed;
    } catch {}
  }

  if (initialMarkdown && initialMarkdown.trim()) {
    return markdownToTiptapContent(initialMarkdown);
  }

  return DEFAULT_DOCUMENT_CONTENT;
}

function makeSlashItems(editor: Editor, callbacks: { onOpenImageDialog: () => void; onSearchCommand?: () => void; onInsertCanvasSnapshot?: () => void }): SlashCommandItem[] {
  return [
    {
      id: "heading",
      title: "Heading",
      description: "Insert a rich heading block",
      icon: Heading1,
      category: "blocks",
      keywords: ["heading", "title", "section"],
      action: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
      id: "h1",
      title: "H1",
      description: "Large page title",
      icon: Heading1,
      category: "blocks",
      keywords: ["h1", "heading 1"],
      action: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
      id: "h2",
      title: "H2",
      description: "Section heading",
      icon: Heading1,
      category: "blocks",
      keywords: ["h2", "heading 2"],
      action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      id: "h3",
      title: "H3",
      description: "Subsection heading",
      icon: Heading1,
      category: "blocks",
      keywords: ["h3", "heading 3"],
      action: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
      id: "bullet",
      title: "Bullet list",
      description: "Create a bulleted list",
      icon: Type,
      category: "blocks",
      keywords: ["bullet", "list"],
      action: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      id: "number",
      title: "Numbered list",
      description: "Create a numbered list",
      icon: Type,
      category: "blocks",
      keywords: ["number", "ordered", "list"],
      action: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      id: "checklist",
      title: "Checklist",
      description: "Insert task items",
      icon: CheckSquare,
      category: "blocks",
      keywords: ["task", "check", "todo", "checklist"],
      action: () => editor.chain().focus().toggleTaskList().run(),
    },
    {
      id: "code",
      title: "Code block",
      description: "Insert a formatted code block",
      icon: FileText,
      category: "blocks",
      keywords: ["code", "snippet", "fence"],
      action: () => editor.chain().focus().toggleCodeBlock().run(),
    },
    {
      id: "table",
      title: "Table",
      description: "Insert a 3x3 table",
      icon: Table2,
      category: "blocks",
      keywords: ["table", "grid"],
      action: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    },
    {
      id: "divider",
      title: "Divider",
      description: "Add a section divider",
      icon: Type,
      category: "blocks",
      keywords: ["divider", "hr", "rule"],
      action: () => editor.chain().focus().setHorizontalRule().run(),
    },
    {
      id: "quote",
      title: "Quote",
      description: "Create a block quote",
      icon: Sparkles,
      category: "blocks",
      keywords: ["quote", "blockquote"],
      action: () => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      id: "image",
      title: "Image",
      description: "Insert an image by URL",
      icon: ImagePlus,
      category: "media",
      keywords: ["image", "photo", "picture"],
      action: callbacks.onOpenImageDialog,
    },
    ...(callbacks.onInsertCanvasSnapshot
      ? [
          {
            id: "canvas-snapshot",
            title: "Canvas snapshot",
            description: "Insert a picture of the selected canvas elements",
            icon: Network,
            category: "media" as const,
            keywords: ["canvas", "snapshot", "diagram", "capture", "board"],
            action: callbacks.onInsertCanvasSnapshot,
          },
        ]
      : []),
    {
      id: "callout",
      title: "Callout",
      description: "Make text stand out",
      icon: Info,
      category: "blocks",
      keywords: ["callout", "info", "notice"],
      action: () => editor.chain().focus().insertContent('<div data-type="callout"><p></p></div>').run(),
    },
    {
      id: "toggle",
      title: "Toggle list",
      description: "Toggles can hide and show content",
      icon: ListTree,
      category: "blocks",
      keywords: ["toggle", "collapse", "expand"],
      action: () => editor.chain().focus().insertContent('<div data-type="toggle"><p></p></div>').run(),
    },
    {
      id: "columns",
      title: "2 Columns",
      description: "Create a two column layout",
      icon: Columns2,
      category: "blocks",
      keywords: ["columns", "layout", "grid"],
      action: () => editor.chain().focus().insertContent('<div data-type="columnBlock"><div data-type="column"><p></p></div><div data-type="column"><p></p></div></div>').run(),
    },
    {
      id: "search",
      title: "Search",
      description: "Open workspace search",
      icon: Search,
      category: "actions",
      keywords: ["search", "find"],
      action: callbacks.onSearchCommand || (() => {}),
    },
  ];
}

export function DocumentEditor({
  initialMarkdown,
  initialJson,
  readOnly = false,
  onPersist,
  onSearchCommand,
  bridge,
  onInsertCanvasSnapshot,
}: DocumentEditorProps) {
  const [isLinkDialogOpen, setIsLinkDialogOpen] = React.useState(false);
  const [linkUrl, setLinkUrl] = React.useState("");
  const [isImageDialogOpen, setIsImageDialogOpen] = React.useState(false);
  const [imageUrl, setImageUrl] = React.useState("");
  const [imageAlt, setImageAlt] = React.useState("");
  const [isDraggingImage, setIsDraggingImage] = React.useState(false);
  const [saveState, setSaveState] = React.useState<"idle" | "saving" | "saved" | "error">("idle");
  const [slashState, setSlashState] = React.useState<SlashState>({
    open: false,
    query: "",
    range: null,
    position: null,
    selectedIndex: 0,
  });
  const saveInFlightRef = React.useRef(0);
  const lastSourceRef = React.useRef<string>("");
  const editorRef = React.useRef<Editor | null>(null);

  const initialContent = React.useMemo(
    () => normalizeInitialContent(initialMarkdown, initialJson),
    [initialMarkdown, initialJson]
  );

  const persist = useDebouncedCallback(async (editor: Editor) => {
    if (readOnly || editor.isDestroyed) return;

    try {
      const json = editor.getJSON();
      const markdown = tiptapContentToMarkdown(json);
      const html = editor.getHTML();

      setSaveState("saving");
      const requestId = Date.now();
      saveInFlightRef.current = requestId;

      await onPersist({
        markdown,
        html,
        json: JSON.stringify(json),
      });
      if (saveInFlightRef.current === requestId) {
        setSaveState("saved");
      }
    } catch {
      // either extracting HTML/JSON failed (editor destroyed mid-flight) or onPersist failed
      setSaveState("error");
    }
  }, 550);

  const syncSlashMenu = React.useCallback(
    (editor: Editor) => {
      if (readOnly) return;

      const { state, view } = editor;
      const { empty, from } = state.selection;

      if (!empty) {
        setSlashState((current) => (current.open ? { ...current, open: false, range: null } : current));
        return;
      }

      const $from = state.selection.$from;
      const start = $from.start();
      const text = state.doc.textBetween(start, from, "\n", "\n");
      const match = text.match(/^\/([a-z0-9-]*)$/i);

      if (!match) {
        if (slashState.open) {
          setSlashState((current) => ({ ...current, open: false, query: "", range: null }));
        }
        return;
      }

      const coords = view.coordsAtPos(from);
      setSlashState({
        open: true,
        query: match[1] || "",
        range: { from: start, to: from },
        position: {
          left: Math.min(window.innerWidth - 360, coords.left),
          top: coords.bottom + 12,
        },
        selectedIndex: 0,
      });
    },
    [readOnly, slashState.open]
  );

  const openSlashMenu = React.useCallback(() => {
    const active = editorRef.current;
    if (!active) return;

    const coords = active.view.coordsAtPos(active.state.selection.from);
    setSlashState({
      open: true,
      query: "",
      range: null,
      position: {
        left: Math.min(window.innerWidth - 360, coords.left),
        top: coords.bottom + 12,
      },
      selectedIndex: 0,
    });
  }, []);

  const openLinkDialog = React.useCallback(() => setIsLinkDialogOpen(true), []);

  const editor = useEditor(
    {
      immediatelyRender: false,
      editable: !readOnly,
      content: initialContent,
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3, 4, 5, 6] },
          codeBlock: false,
          horizontalRule: false,
          dropcursor: false,
          gapcursor: false,
        }),
        Placeholder.configure({
          placeholder: "Press '/' for commands",
          showOnlyCurrent: false,
        }),
        Underline,
        Link.configure({
          autolink: true,
          openOnClick: false,
          linkOnPaste: true,
          HTMLAttributes: {
            class: "doc-link",
            rel: "noreferrer noopener nofollow",
            target: "_blank",
          },
        }),
        TaskList,
        TaskItem.configure({
          nested: true,
        }),
        Table.configure({
          resizable: true,
        }),
        TableRow,
        TableHeader,
        TableCell,
        Highlight.configure({ multicolor: true }),
        TextAlign.configure({
          types: ["heading", "paragraph"],
        }),
        HorizontalRule,
        ImageWithCaption.configure({
          inline: true,
          allowBase64: true,
          HTMLAttributes: {
            class: "doc-image",
          },
        }),
        Typography,
        Gapcursor,
        Dropcursor.configure({
          color: '#ffffff',
          width: 2,
        }),
        TextStyle,
        Color,
        Callout,
        Toggle,
        ColumnBlock,
        Column,
        CodeBlockLowlight.configure({
          lowlight,
        }),
      ],
      editorProps: {
        attributes: {
          class:
            "doc-editor min-h-full focus:outline-none",
        },
        handlePaste: (_view, event) => {
          if (readOnly) return false;
          const text = event.clipboardData?.getData("text/plain") || "";
          if (!text || !looksLikeMarkdown(text)) return false;

          const doc = markdownToTiptapContent(text);
          const active = editorRef.current;
          if (!active) return false;
          active.chain().focus().insertContent(doc.content || []).run();
          return true;
        },
        handleKeyDown: (_view, event) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
            event.preventDefault();
            openLinkDialog();
            return true;
          }

          if ((event.metaKey || event.ctrlKey) && event.key === "/") {
            event.preventDefault();
            openSlashMenu();
            return true;
          }

          if (!slashState.open) return false;

          if (event.key === "Escape") {
            event.preventDefault();
            setSlashState((current) => ({ ...current, open: false }));
            return true;
          }

          if (event.key === "ArrowDown") {
            event.preventDefault();
            setSlashState((current) => ({
              ...current,
              selectedIndex: (current.selectedIndex + 1) % Math.max(1, filteredSlashItems.length),
            }));
            return true;
          }

          if (event.key === "ArrowUp") {
            event.preventDefault();
            setSlashState((current) => ({
              ...current,
              selectedIndex:
                (current.selectedIndex - 1 + Math.max(1, filteredSlashItems.length)) %
                Math.max(1, filteredSlashItems.length),
            }));
            return true;
          }

          if (event.key === "Enter") {
            event.preventDefault();
            const selected = filteredSlashItems[slashState.selectedIndex];
            if (selected) executeSlashItem(selected);
            return true;
          }

          return false;
        },
      },
      onCreate: ({ editor }) => {
        editorRef.current = editor;
      },
      onUpdate: ({ editor }) => {
        editorRef.current = editor;
        persist(editor);
        syncSlashMenu(editor);
        setSaveState((current) => (current === "error" ? "saving" : current));
      },
      onSelectionUpdate: ({ editor }) => {
        editorRef.current = editor;
        syncSlashMenu(editor);
      },
    },
    [readOnly, initialContent]
  );

  React.useEffect(() => {
    if (!bridge) return;
    bridge.attach(editor);
    return () => bridge.attach(null);
  }, [bridge, editor]);

  const filteredSlashItems = editor
    ? makeSlashItems(editor, {
        onOpenImageDialog: () => setIsImageDialogOpen(true),
        onSearchCommand,
        onInsertCanvasSnapshot,
      }).filter((item) => {
        const query = slashState.query.toLowerCase();
        if (!query) return true;
        return (
          item.title.toLowerCase().includes(query) ||
          item.description.toLowerCase().includes(query) ||
          item.keywords.some((keyword) => keyword.toLowerCase().includes(query))
        );
      })
    : [];

  React.useEffect(() => {
    if (!editor || editor.isDestroyed) return;

    const source = JSON.stringify(initialContent);
    if (source === lastSourceRef.current) return;

    lastSourceRef.current = source;
    if (editor.commands) {
      editor.commands.setContent(initialContent, { emitUpdate: false });
    }
  }, [editor, initialContent]);

  const downloadFile = (content: string, filename: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportMarkdown = React.useCallback(() => {
    if (!editor) return;
    const markdown = tiptapContentToMarkdown(editor.getJSON());
    downloadFile(markdown, "document.md", "text/markdown");
  }, [editor]);

  const exportHtml = React.useCallback(() => {
    if (!editor) return;
    downloadFile(editor.getHTML(), "document.html", "text/html");
  }, [editor]);

  const exportJson = React.useCallback(() => {
    if (!editor) return;
    downloadFile(JSON.stringify(editor.getJSON(), null, 2), "document.json", "application/json");
  }, [editor]);

  const executeSlashItem = React.useCallback(
    (item: SlashCommandItem) => {
      const active = editorRef.current;
      if (!active) return;

      if (slashState.range) {
        active.chain().focus().deleteRange(slashState.range).run();
      } else {
        active.chain().focus().run();
      }

      item.action();
      setSlashState((current) => ({ ...current, open: false, query: "", range: null }));
    },
    [slashState.range]
  );

  const printPdf = React.useCallback(() => {
    if (!editor || typeof window === "undefined") return;
    const html = editor.getHTML();
    const printWindow = window.open("", "_blank", "noopener,noreferrer");
    if (!printWindow) return;
    printWindow.document.open();
    printWindow.document.write(buildPrintableDocument("Slate document", html));
    printWindow.document.close();
    printWindow.focus();
  }, [editor]);

  const applyLink = React.useCallback(() => {
    if (!editor || !linkUrl.trim()) return;
    editor.chain().focus().extendMarkRange("link").setLink({ href: linkUrl.trim() }).run();
    setLinkUrl("");
    setIsLinkDialogOpen(false);
  }, [editor, linkUrl]);

  const applyImage = React.useCallback(() => {
    if (!editor || !imageUrl.trim()) return;
    editor.chain().focus().setImage({
      src: imageUrl.trim(),
      alt: imageAlt.trim() || undefined,
    }).run();
    setImageUrl("");
    setImageAlt("");
    setIsImageDialogOpen(false);
  }, [editor, imageAlt, imageUrl]);

  const handleImageFile = React.useCallback((file: File) => {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      if (!result) return;
      setImageUrl(result);
      if (!imageAlt) setImageAlt(file.name.split(".")[0]);
    };
    reader.readAsDataURL(file);
  }, [imageAlt]);

  const handleImageDrop = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingImage(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleImageFile(file);
  }, [handleImageFile]);

  if (!editor) {
    return (
      <div className="flex h-full min-h-[500px] items-center justify-center rounded-3xl border border-white/10 bg-[#0b0c0f] text-white/45">
        Loading editor...
      </div>
    );
  }

  return (
    <DocumentEditorProvider editor={editor} readOnly={readOnly}>
      <div className="relative flex h-full min-h-[600px] flex-col overflow-hidden bg-transparent">
        <div className="flex items-center justify-end gap-4 px-4 py-3 bg-transparent">

          <div className="flex items-center gap-2">
            <span
              className={cn(
                "rounded-full border px-3 py-1 text-[11px] font-medium",
                saveState === "saving"
                  ? "border-amber-500/20 bg-amber-500/10 text-amber-200"
                  : saveState === "error"
                    ? "border-rose-500/20 bg-rose-500/10 text-rose-200"
                    : "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
              )}
            >
              {readOnly ? "Read only" : saveState === "saving" ? "Saving…" : saveState === "error" ? "Save failed" : "Synced"}
            </span>
            <Button
              type="button"
              variant="outline"
              className="h-9 rounded-xl border-white/10 bg-white/5 px-3 text-xs text-white hover:bg-white/10"
              onClick={openSlashMenu}
            >
              <Sparkles className="mr-2 h-3.5 w-3.5" />
              Commands
            </Button>
          </div>
        </div>

        <DocumentToolbar
          editor={editor}
          onOpenLinkDialog={openLinkDialog}
          onExportMarkdown={exportMarkdown}
          onExportHtml={exportHtml}
          onExportJson={exportJson}
          onPrintPdf={() => window.print()}
        />

        {!readOnly && (
          <>
            <DocumentBubbleMenu editor={editor} onOpenLinkDialog={openLinkDialog} />
            <TableBubbleMenu editor={editor} />
            <ImageBubbleMenu editor={editor} />
          </>
        )}

        <div className="relative flex-1 overflow-auto px-4 py-6">
          <div className="mx-auto w-full max-w-[1100px]">
            <div className="editor-shell pb-32 pt-8">
              <EditorContent editor={editor} />
            </div>
          </div>

          <SlashMenu
            open={slashState.open}
            query={slashState.query}
            items={filteredSlashItems}
          selectedIndex={slashState.selectedIndex}
          position={slashState.position}
          onSelectIndex={(index) => setSlashState((current) => ({ ...current, selectedIndex: index }))}
          onSelectItem={executeSlashItem}
          onClose={() => setSlashState((current) => ({ ...current, open: false, query: "", range: null }))}
        />
        </div>

        <Dialog open={isLinkDialogOpen} onOpenChange={setIsLinkDialogOpen}>
          <DialogContent className="border-white/10 bg-[#0f1116] text-white sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Insert link</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <Input
                value={linkUrl}
                onChange={(event) => setLinkUrl(event.target.value)}
                placeholder="https://example.com"
                className="border-white/10 bg-white/5 text-white placeholder:text-white/30"
              />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setIsLinkDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="button" onClick={applyLink}>
                  Apply
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={isImageDialogOpen} onOpenChange={setIsImageDialogOpen}>
          <DialogContent className="border-white/10 bg-[#0f1116] text-white sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Insert image</DialogTitle>
            </DialogHeader>
            <Tabs defaultValue="device" className="w-full">
              <TabsList className="w-full grid grid-cols-2 bg-white/5 border border-white/10 mb-4">
                <TabsTrigger value="device">Device</TabsTrigger>
                <TabsTrigger value="link">Link</TabsTrigger>
              </TabsList>
              
              <TabsContent value="device" className="space-y-4 outline-none">
                <div 
                  className={cn(
                    "border-2 border-dashed rounded-lg p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-colors",
                    isDraggingImage ? "border-white/50 bg-white/5" : "border-white/20 hover:bg-white/5 hover:border-white/30"
                  )}
                  onDragOver={(e) => { e.preventDefault(); setIsDraggingImage(true); }}
                  onDragLeave={() => setIsDraggingImage(false)}
                  onDrop={handleImageDrop}
                  onClick={() => document.getElementById('image-upload-input')?.click()}
                >
                  <UploadCloud className="h-8 w-8 text-white/50 mb-3" />
                  <p className="text-sm font-medium mb-1">Click to upload or drag and drop</p>
                  <p className="text-xs text-white/50">SVG, PNG, JPG or GIF</p>
                  <input 
                    id="image-upload-input" 
                    type="file" 
                    accept="image/*" 
                    className="hidden" 
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleImageFile(file);
                    }}
                  />
                </div>
                {imageUrl && imageUrl.startsWith('data:') && (
                  <div className="rounded border border-white/10 overflow-hidden bg-white/5 p-2 flex items-center gap-3">
                    <img src={imageUrl} alt="Preview" className="h-10 w-10 object-cover rounded" />
                    <span className="text-sm text-white/70 truncate flex-1">{imageAlt || 'Selected image'}</span>
                    <Button variant="ghost" size="sm" onClick={() => { setImageUrl(""); setImageAlt(""); }} className="h-8 px-2 text-white/50 hover:text-white">Clear</Button>
                  </div>
                )}
                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="ghost" onClick={() => setIsImageDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="button" onClick={applyImage} disabled={!imageUrl || !imageUrl.startsWith('data:')}>
                    Insert
                  </Button>
                </div>
              </TabsContent>
              
              <TabsContent value="link" className="space-y-4 outline-none">
                <div className="space-y-4">
                  <Input
                    value={imageUrl.startsWith('http') ? imageUrl : ''}
                    onChange={(event) => setImageUrl(event.target.value)}
                    placeholder="https://images.example.com/preview.png"
                    className="border-white/10 bg-white/5 text-white placeholder:text-white/30"
                  />
                  <Input
                    value={imageAlt}
                    onChange={(event) => setImageAlt(event.target.value)}
                    placeholder="Alt text"
                    className="border-white/10 bg-white/5 text-white placeholder:text-white/30"
                  />
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="ghost" onClick={() => setIsImageDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button type="button" onClick={applyImage} disabled={!imageUrl.startsWith('http')}>
                      Insert
                    </Button>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </DialogContent>
        </Dialog>
      </div>
    </DocumentEditorProvider>
  );
}

export default DocumentEditor;
