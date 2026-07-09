import { mergeAttributes, Node } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent, NodeViewProps } from '@tiptap/react';
import * as React from 'react';

export const ColumnBlock = Node.create({
  name: 'columnBlock',
  group: 'block',
  content: 'column{2,}', // require at least two columns
  
  parseHTML() {
    return [
      {
        tag: 'div[data-type="columnBlock"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'columnBlock', class: 'flex gap-4 my-4 w-full' }), 0];
  },
  
  addNodeView() {
    return ReactNodeViewRenderer(ColumnBlockComponent);
  }
});

function ColumnBlockComponent(props: NodeViewProps) {
  return (
    <NodeViewWrapper className="flex gap-4 my-4 w-full">
      <NodeViewContent className="flex flex-1 gap-4 w-full" />
    </NodeViewWrapper>
  );
}

export const Column = Node.create({
  name: 'column',
  content: 'block+',
  
  parseHTML() {
    return [
      {
        tag: 'div[data-type="column"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'column', class: 'flex-1 min-w-0' }), 0];
  },
  
  addNodeView() {
    return ReactNodeViewRenderer(ColumnComponent);
  }
});

function ColumnComponent() {
  return (
    <NodeViewWrapper className="flex-1 min-w-0 border border-transparent hover:border-white/10 rounded-md p-1 transition-colors">
      <NodeViewContent className="column-content" />
    </NodeViewWrapper>
  );
}
