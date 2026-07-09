import { mergeAttributes, Node } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent, NodeViewProps } from '@tiptap/react';
import { ChevronRight } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/lib/utils';

export const Toggle = Node.create({
  name: 'toggle',
  group: 'block',
  content: 'block+',
  defining: true,
  
  addAttributes() {
    return {
      open: {
        default: false,
      }
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="toggle"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'toggle' }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ToggleComponent);
  },
});

function ToggleComponent(props: NodeViewProps) {
  return (
    <NodeViewWrapper className="toggle-block my-2">
      <div className="flex items-start gap-1">
        <button
          className="mt-1 flex items-center justify-center rounded hover:bg-white/10 text-white/50 hover:text-white transition-colors"
          onClick={() => props.updateAttributes({ open: !props.node.attrs.open })}
          contentEditable={false}
        >
          <ChevronRight className={cn("w-4 h-4 transition-transform duration-200", props.node.attrs.open && "rotate-90")} />
        </button>
        <div className={cn("flex-1 min-w-0 transition-opacity", !props.node.attrs.open && "opacity-50")}>
          <NodeViewContent className="toggle-content" />
        </div>
      </div>
    </NodeViewWrapper>
  );
}
