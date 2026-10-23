import { editedToSource, type ChatMessage, type EditConfig } from '@spool/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUp, Bot, Eraser, Sparkles, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, errorMessage, queryKeys } from '@/lib/api';
import { cn } from '@/lib/cn';
import { viewerSession } from '@/lib/viewer';
import { useAuthStore } from '@/store/auth.store';
import { usePlayerStore } from '@/store/player.store';
import { toast } from '@/store/toast.store';
import { EmptyState, Spinner } from '../ui/misc';
import { Tooltip } from '../ui/Tooltip';
import { RichMessage } from './RichMessage';

interface AiChatPanelProps {
  shareId: string;
  shareToken: string | null;
  edit: EditConfig;
  canChat: boolean;
  unavailableReason: string;
}

const SUGGESTIONS = [
  'Summarize this video in three bullets',
  'What are the action items and who owns them?',
  'What decisions were made?',
  'What should I watch first if I only have a minute?',
];

interface PendingTurn {
  question: string;
  answer: string;
}

export function AiChatPanel({ shareId, shareToken, edit, canChat, unavailableReason }: AiChatPanelProps) {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const seek = usePlayerStore((s) => s.seek);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState<PendingTurn | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const session = viewerSession();

  const history = useQuery({
    queryKey: [...queryKeys.chat(shareId), user?.id ?? 'anon'],
    queryFn: () => api.chatHistory(shareId, session, shareToken),
    enabled: canChat,
  });
  const messages: ChatMessage[] = history.data ?? [];

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, pending?.answer]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const jump = (editedSeconds: number) => seek(editedToSource(edit, editedSeconds));

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || pending) return;
    setInput('');
    setPending({ question, answer: '' });
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const result = await api.chat(shareId, question, {
        shareToken,
        viewerSession: session,
        signal: controller.signal,
        onDelta: (delta) => setPending((p) => (p ? { ...p, answer: p.answer + delta } : p)),
      });
      queryClient.setQueryData<ChatMessage[]>([...queryKeys.chat(shareId), user?.id ?? 'anon'], (prev = []) => [
        ...prev,
        result.userMessage,
        result.message,
      ]);
    } catch (error) {
      if ((error as Error).name !== 'AbortError') toast.error('Ask Spool failed', errorMessage(error));
    } finally {
      setPending(null);
      controllerRef.current = null;
      inputRef.current?.focus();
    }
  };

  const clear = async () => {
    try {
      await api.clearChat(shareId, session, shareToken);
      queryClient.setQueryData([...queryKeys.chat(shareId), user?.id ?? 'anon'], []);
    } catch (error) {
      toast.error('Could not clear chat', errorMessage(error));
    }
  };

  if (!canChat) {
    return <EmptyState icon={<Bot className="h-6 w-6" />} title="Ask Spool is unavailable" description={unavailableReason} />;
  }

  const empty = messages.length === 0 && !pending;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5">
        {history.isLoading && (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        )}
        {empty && !history.isLoading && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="pt-6 text-center">
            <div className="relative mx-auto mb-4 flex h-12 w-12 items-center justify-center">
              <div className="absolute inset-0 rounded-2xl bg-accent/25 blur-xl" />
              <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl border border-accent/30 bg-ink-800 text-accent">
                <Sparkles className="h-5 w-5" />
              </div>
            </div>
            <h3 className="text-[15px] font-semibold text-white">Ask Spool about this video</h3>
            <p className="mx-auto mt-1.5 max-w-xs text-[13px] text-white/45">
              Answers cite exact moments — click a timestamp to jump straight to it.
            </p>
            <div className="mt-6 grid gap-2">
              {SUGGESTIONS.map((suggestion, i) => (
                <motion.button
                  key={suggestion}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0, transition: { delay: 0.05 * i } }}
                  whileHover={{ x: 2 }}
                  onClick={() => void send(suggestion)}
                  className="rounded-xl border border-white/[0.07] bg-white/[0.025] px-3.5 py-2.5 text-left text-[13px] text-white/70 transition-colors hover:border-accent/30 hover:bg-accent/[0.05] hover:text-white"
                >
                  {suggestion}
                </motion.button>
              ))}
            </div>
          </motion.div>
        )}
        {messages.map((message) => (
          <Bubble key={message.id} role={message.role}>
            {message.role === 'assistant' ? <RichMessage content={message.content} onTimestamp={jump} /> : message.content}
          </Bubble>
        ))}
        <AnimatePresence>
          {pending && (
            <>
              <Bubble key="pending-q" role="user">
                {pending.question}
              </Bubble>
              <Bubble key="pending-a" role="assistant">
                {pending.answer ? (
                  <RichMessage content={pending.answer} onTimestamp={jump} />
                ) : (
                  <span className="flex items-center gap-1 py-1">
                    {[0, 1, 2].map((i) => (
                      <motion.span
                        key={i}
                        className="h-1.5 w-1.5 rounded-full bg-accent"
                        animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
                        transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }}
                      />
                    ))}
                  </span>
                )}
              </Bubble>
            </>
          )}
        </AnimatePresence>
      </div>
      <div className="border-t border-white/[0.06] p-3">
        <div className="relative rounded-2xl border border-white/10 bg-ink-800/80 transition focus-within:border-accent/40 focus-within:shadow-[0_0_0_4px_rgba(0,250,154,0.07)]">
          <textarea
            ref={inputRef}
            value={input}
            rows={1}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            placeholder="Ask anything about this video…"
            className="max-h-32 min-h-[46px] w-full resize-none bg-transparent py-3 pl-4 pr-12 text-[13.5px] text-white placeholder:text-white/30 focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          <div className="absolute bottom-2 right-2 flex items-center gap-1">
            {pending ? (
              <button
                onClick={() => controllerRef.current?.abort()}
                className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/10 text-white transition hover:bg-white/20"
                aria-label="Stop generating"
              >
                <Square className="h-3 w-3 fill-current" />
              </button>
            ) : (
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={() => void send(input)}
                disabled={!input.trim()}
                className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent text-accent-foreground shadow-glow transition disabled:bg-white/10 disabled:text-white/30 disabled:shadow-none"
                aria-label="Send"
              >
                <ArrowUp className="h-4 w-4" />
              </motion.button>
            )}
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between px-1">
          <span className="text-2xs text-white/30">Grounded in the transcript · may make mistakes</span>
          {messages.length > 0 && !pending && (
            <Tooltip content="Clear conversation">
              <button onClick={() => void clear()} className="rounded p-1 text-white/30 transition hover:text-white" aria-label="Clear conversation">
                <Eraser className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  );
}

function Bubble({ role, children }: { role: 'user' | 'assistant'; children: React.ReactNode }) {
  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
      className={cn('flex gap-2.5', role === 'user' ? 'justify-end' : 'justify-start')}
    >
      {role === 'assistant' && (
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-accent/30 bg-accent/10 text-accent">
          <Sparkles className="h-3.5 w-3.5" />
        </span>
      )}
      <div
        className={cn(
          'max-w-[88%] rounded-2xl px-3.5 py-2.5',
          role === 'user' ? 'rounded-br-md bg-white/[0.08] text-[13.5px] text-white' : 'rounded-bl-md border border-white/[0.06] bg-ink-800/60',
        )}
      >
        {children}
      </div>
    </motion.div>
  );
}
