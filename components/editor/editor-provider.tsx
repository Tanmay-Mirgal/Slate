"use client";

import * as React from "react";
import type { Editor } from "@tiptap/react";

type DocumentEditorContextValue = {
  editor: Editor | null;
  readOnly: boolean;
};

const DocumentEditorContext = React.createContext<DocumentEditorContextValue | null>(null);

export function DocumentEditorProvider({
  editor,
  readOnly,
  children,
}: React.PropsWithChildren<DocumentEditorContextValue>) {
  const value = React.useMemo(() => ({ editor, readOnly }), [editor, readOnly]);

  return <DocumentEditorContext.Provider value={value}>{children}</DocumentEditorContext.Provider>;
}

export function useDocumentEditor() {
  const context = React.useContext(DocumentEditorContext);
  if (!context) {
    throw new Error("useDocumentEditor must be used inside DocumentEditorProvider");
  }
  return context;
}
