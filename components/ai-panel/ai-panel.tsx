import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, X, Send, Square, Database, Cloud, Lock, CreditCard, ShoppingCart, Box, MessageSquare, Layout, Play, MapPin, Users, Bot } from "lucide-react";
import TextareaAutosize from "react-textarea-autosize";
import { AiMessage } from "./ai-message";
import { PromptCard } from "./prompt-card";

interface AiMessageData {
  role: "user" | "assistant";
  text: string;
}

interface AiPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerate: (prompt: string) => Promise<void>;
  aiMessages: AiMessageData[];
  setAiMessages: React.Dispatch<React.SetStateAction<AiMessageData[]>>;
  isGenerating: boolean;
  setIsGenerating: React.Dispatch<React.SetStateAction<boolean>>;
}

const ALL_PROMPTS = [
  { icon: Database, title: "Microservices Architecture", description: "Generate a scalable architecture with API Gateway, Auth Service, Redis and PostgreSQL.", prompt: "Generate a scalable architecture with API Gateway, Auth Service, Redis and PostgreSQL." },
  { icon: Cloud, title: "AWS Infrastructure", description: "Generate an AWS architecture with ALB, EC2, RDS, S3 and CloudFront.", prompt: "Generate an AWS architecture with ALB, EC2, RDS, S3 and CloudFront." },
  { icon: Lock, title: "Authentication System", description: "Generate OAuth + JWT + RBAC + Session Management architecture.", prompt: "Generate OAuth + JWT + RBAC + Session Management architecture." },
  { icon: CreditCard, title: "Payment Gateway", description: "Generate Stripe-like payment processing architecture.", prompt: "Generate Stripe-like payment processing architecture." },
  { icon: MessageSquare, title: "Real-Time Chat System", description: "Generate WebSocket-based real-time messaging architecture.", prompt: "Generate WebSocket-based real-time messaging architecture." },
  { icon: ShoppingCart, title: "E-Commerce Platform", description: "Generate scalable online shopping and inventory architecture.", prompt: "Generate scalable online shopping and inventory architecture." },
  { icon: Box, title: "Event-Driven Architecture", description: "Generate a message queue and pub/sub based architecture.", prompt: "Generate a message queue and pub/sub based architecture." },
  { icon: Layout, title: "Kubernetes Cluster", description: "Generate K8s deployment, services, and ingress architecture.", prompt: "Generate K8s deployment, services, and ingress architecture." },
  { icon: Play, title: "Video Streaming Platform", description: "Generate a high-bandwidth video streaming architecture like Netflix.", prompt: "Generate a high-bandwidth video streaming architecture like Netflix." },
  { icon: MapPin, title: "Ride-Sharing Backend", description: "Generate a real-time location and matchmaking architecture like Uber.", prompt: "Generate a real-time location and matchmaking architecture like Uber." },
  { icon: Users, title: "Social Media App", description: "Generate a scalable news feed and social graph architecture.", prompt: "Generate a scalable news feed and social graph architecture." },
  { icon: Bot, title: "AI SaaS Application", description: "Generate an LLM-powered application architecture.", prompt: "Generate an LLM-powered application architecture." },
];

export function AiPanel({ isOpen, onClose, onGenerate, aiMessages, setAiMessages, isGenerating, setIsGenerating }: AiPanelProps) {
  const [input, setInput] = React.useState("");
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  const [randomPrompts, setRandomPrompts] = React.useState<typeof ALL_PROMPTS>([]);

  React.useEffect(() => {
    if (isOpen) {
      const shuffled = [...ALL_PROMPTS].sort(() => 0.5 - Math.random());
      setTimeout(() => setRandomPrompts(shuffled.slice(0, 3)), 0);
    }
  }, [isOpen]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  React.useEffect(() => {
    scrollToBottom();
  }, [aiMessages]);

  const handleSubmit = async (e?: React.FormEvent, promptOverride?: string) => {
    e?.preventDefault();
    const promptToUse = (promptOverride || input).trim();
    if (!promptToUse || isGenerating) return;

    setInput("");
    setIsGenerating(true);
    setAiMessages((prev) => [...prev, { role: "user", text: promptToUse }]);
    // ⚡ prefix tells AiMessage to show the animated loading state
    setAiMessages((prev) => [...prev, { role: "assistant", text: "⚡" }]);
    scrollToBottom();

    // The generation logic
    try {
      await onGenerate(promptToUse);
      // On success, replace the loading message with a completion message
      setAiMessages((prev) => {
        const newMsgs = [...prev];
        newMsgs[newMsgs.length - 1] = { 
          role: "assistant", 
          text: "I've generated the architecture directly on your canvas. You can now edit every component." 
        };
        return newMsgs;
      });
    } catch {
      setAiMessages((prev) => {
        const newMsgs = [...prev];
        newMsgs[newMsgs.length - 1] = { 
          role: "assistant", 
          text: "An error occurred while generating the architecture." 
        };
        return newMsgs;
      });
    } finally {
      setIsGenerating(false);
      scrollToBottom();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };



  return (
    <AnimatePresence>
      {isOpen && (
        <motion.aside
          initial={{ x: "100%", opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: "100%", opacity: 0 }}
          transition={{ type: "spring", stiffness: 400, damping: 40 }}
          className="absolute top-0 right-0 h-full w-[400px] bg-[#0A0A0A]/95 backdrop-blur-xl border-l border-white/10 shadow-2xl z-50 flex flex-col justify-between overflow-hidden"
        >
          {/* HEADER */}
          <div className="flex-none p-4 flex items-center justify-between border-b border-white/5">
            <span className="font-semibold text-sm text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-white" />
              Slate AI
            </span>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* MESSAGES AREA */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden p-6 custom-scrollbar">
            <div className="flex flex-col">
              {aiMessages.map((msg, idx) => (
                <AiMessage key={idx} role={msg.role} text={msg.text} />
              ))}
              
              {aiMessages.length <= 1 && randomPrompts.length > 0 && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="w-full space-y-3 mt-8 mb-4"
                >
                  {randomPrompts.map((p, i) => (
                    <PromptCard 
                      key={i} 
                      delay={0.1 * (i + 1)} 
                      icon={p.icon} 
                      title={p.title} 
                      onClick={() => handleSubmit(undefined, p.prompt)} 
                    />
                  ))}
                </motion.div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* INPUT AREA */}
          <div className="flex-none p-4 pt-2 border-t border-white/5 bg-gradient-to-t from-[#0A0A0A] to-transparent">

            <form 
              onSubmit={handleSubmit} 
              className="relative flex items-end gap-2 bg-[#141414] border border-white/10 rounded-2xl p-2 transition-all focus-within:border-white/30 focus-within:shadow-[0_0_15px_rgba(255,255,255,0.05)] focus-within:bg-[#1A1A1A]"
            >
              <TextareaAutosize
                minRows={1}
                maxRows={5}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Describe the architecture you want to build..."
                className="w-full resize-none bg-transparent px-3 py-2 text-[13px] text-white outline-none placeholder:text-white/30 leading-relaxed"
              />
              <div className="flex-shrink-0 mb-1 mr-1">
                {isGenerating ? (
                  <motion.button
                    type="button"
                    onClick={() => { /* Real abort logic if API supports it, otherwise UI fake stop */ setIsGenerating(false) }}
                    className="flex h-8 w-8 items-center justify-center rounded-xl bg-red-500/10 text-red-500 transition-colors hover:bg-red-500/20"
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    <div className="relative flex items-center justify-center">
                      <motion.div animate={{ rotate: 360 }} transition={{ duration: 2, repeat: Infinity, ease: "linear" }} className="absolute inset-0 rounded-full border-[2px] border-red-500/30 border-t-red-500" />
                      <Square className="h-3 w-3 fill-current" />
                    </div>
                  </motion.button>
                ) : (
                  <motion.button
                    type="submit"
                    disabled={!input.trim()}
                    className="flex h-8 w-8 items-center justify-center rounded-xl bg-white text-black transition-colors disabled:opacity-30 hover:bg-[#E5E5E5]"
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    <Send className="h-4 w-4 ml-0.5" />
                  </motion.button>
                )}
              </div>
            </form>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
