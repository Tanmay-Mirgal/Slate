import { mergeAttributes, Node } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent } from '@tiptap/react';
import { Info } from 'lucide-react';
import * as React from 'react';

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  
  addAttributes() {
    return {
      type: {
        default: 'info',
      }
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="callout"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'callout' }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutComponent);
  },
});

function CalloutComponent(props: any) {
  return (
    <NodeViewWrapper className="callout-block flex gap-3 p-4 my-4 rounded-xl border border-white/10 bg-blue-500/10 text-white">
      <div className="flex-shrink-0 mt-0.5 text-blue-400" contentEditable={false}>
        <Info className="w-5 h-5" />
      </div>
      <NodeViewContent className="callout-content flex-1 min-w-0" />
    </NodeViewWrapper>
  );
}
