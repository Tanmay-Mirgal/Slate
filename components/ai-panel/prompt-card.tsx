import * as React from "react";
import { motion } from "framer-motion";
import { LucideIcon } from "lucide-react";

interface PromptCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
  onClick: () => void;
  delay?: number;
}

export function PromptCard({ icon: Icon, title, onClick, delay = 0 }: Omit<PromptCardProps, 'description'>) {
  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay }}
      whileHover={{ scale: 1.02, y: -1 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className="group relative flex w-full items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-3 text-left shadow-sm backdrop-blur-md transition-colors hover:bg-white/[0.05] hover:border-white/10"
    >
      <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-white/5 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/5 text-white/70 group-hover:bg-white/10 group-hover:text-white transition-colors">
        <Icon className="h-4 w-4" />
      </div>
      <h4 className="relative text-[13px] font-medium text-white/80 group-hover:text-white transition-colors">{title}</h4>
    </motion.button>
  );
}
