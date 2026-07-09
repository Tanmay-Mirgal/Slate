import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Code2, Layers, Cpu, Compass, LayoutTemplate, Workflow } from "lucide-react";

interface AiMessageProps {
  role: "user" | "assistant";
  text: string;
  isStreaming?: boolean;
}

const LOADING_MESSAGES = [
  { text: "Analyzing your requirements...", icon: Compass },
  { text: "Finding the best architecture...", icon: Layers },
  { text: "Creating components...", icon: Cpu },
  { text: "Connecting services...", icon: Workflow },
  { text: "Optimizing layout...", icon: LayoutTemplate },
  { text: "Generating beautiful diagram...", icon: Code2 },
];

export function AiMessage({ role, text, isStreaming }: AiMessageProps) {
  const [displayedText, setDisplayedText] = React.useState("");
  const [loadingIndex, setLoadingIndex] = React.useState(0);

  // Simulated streaming effect for text
  React.useEffect(() => {
    if (role === "assistant" && !isStreaming) {
      if (text.startsWith("⚡")) {
        // It's the loading placeholder, handle cycle instead
        const interval = setInterval(() => {
          setLoadingIndex((prev) => (prev + 1) % LOADING_MESSAGES.length);
        }, 1500);
        return () => clearInterval(interval);
      } else {
        // Normal text streaming
        setDisplayedText("");
        const words = text.split(" ");
        let i = 0;
        const interval = setInterval(() => {
          if (i < words.length) {
            setDisplayedText((prev) => (prev ? prev + " " + words[i] : words[i]));
            i++;
          } else {
            clearInterval(interval);
          }
        }, 40); // 40ms per word
        return () => clearInterval(interval);
      }
    } else {
      setDisplayedText(text);
    }
  }, [role, text, isStreaming]);

  const isAssistantLoading = role === "assistant" && text.startsWith("⚡");
  const CurrentLoadingIcon = LOADING_MESSAGES[loadingIndex].icon;

  if (role === "user") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="flex w-full justify-end mb-6"
      >
        <div className="max-w-[85%] rounded-2xl bg-gradient-to-tr from-white/10 to-white/5 border border-white/10 px-4 py-3 text-[13px] text-white shadow-sm leading-relaxed">
          {text}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex w-full flex-col mb-6"
    >
      <div className="flex items-center gap-2 mb-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-black shadow-[0_0_12px_rgba(255,255,255,0.3)]">
          <Sparkles className="h-3.5 w-3.5" />
        </div>
        <span className="text-xs font-semibold text-white/90">Slate AI</span>
      </div>
      
      <div className="pl-8 text-[13px] text-white/80 leading-relaxed font-medium">
        {isAssistantLoading ? (
          <div className="flex items-center gap-3 text-white/60">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
              className="text-white/40"
            >
              <CurrentLoadingIcon className="h-4 w-4" />
            </motion.div>
            <AnimatePresence mode="wait">
              <motion.span
                key={loadingIndex}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                transition={{ duration: 0.3 }}
              >
                {LOADING_MESSAGES[loadingIndex].text}
              </motion.span>
            </AnimatePresence>
          </div>
        ) : (
          <span>
            {displayedText}
            {displayedText !== text && (
              <motion.span
                animate={{ opacity: [1, 0] }}
                transition={{ repeat: Infinity, duration: 0.7 }}
                className="inline-block w-1.5 h-3.5 bg-white ml-1 align-middle"
              />
            )}
          </span>
        )}
      </div>
    </motion.div>
  );
}
