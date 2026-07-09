import { NodeViewWrapper, ReactNodeViewRenderer, NodeViewProps } from "@tiptap/react";
import Image from "@tiptap/extension-image";
import * as React from "react";

const ImageNodeView = (props: NodeViewProps) => {
  const { src, alt } = props.node.attrs;

  return (
    <NodeViewWrapper as="span" className="relative inline-block group">
      <img
        src={src}
        alt={alt || "Image"}
        className="doc-image rounded-xl"
      />
      {alt && (
        <span className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-black/80 text-white/90 text-xs px-3 py-1.5 rounded-md whitespace-nowrap max-w-[90%] overflow-hidden text-ellipsis pointer-events-none backdrop-blur-sm border border-white/10 shadow-xl">
          {alt}
        </span>
      )}
    </NodeViewWrapper>
  );
};

export const ImageWithCaption = Image.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ImageNodeView);
  },
});
