'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export function ChatPanel() {
  const t = useTranslations('chat');
  const starterPrompts = [t('starter1'), t('starter2'), t('starter3')];

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, thinking]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || thinking) return;

    const history = [...messages, { role: 'user' as const, content }];
    setMessages(history);
    setInput('');
    setThinking(true);
    setError(null);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history }),
      });
      const data = (await response.json()) as { reply?: string; error?: string };
      if (!response.ok || !data.reply) {
        setError(data.error ?? `Chat failed (HTTP ${response.status})`);
      } else {
        setMessages([...history, { role: 'assistant', content: data.reply }]);
      }
    } catch {
      setError(t('requestFailed'));
    } finally {
      setThinking(false);
    }
  }

  return (
    <div className="flex flex-col rounded-lg border border-border bg-surface">
      <div className="flex max-h-[55vh] min-h-[320px] flex-col gap-3 overflow-y-auto p-4">
        {messages.length === 0 && !thinking && (
          <div className="m-auto max-w-md space-y-2 py-6 text-center">
            <p className="text-sm text-text-muted">{t('emptyHint')}</p>
            <div className="flex flex-col items-center gap-2 pt-2">
              {starterPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => void send(prompt)}
                  className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-left text-sm text-text-muted transition-colors hover:border-border-strong hover:text-text"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message, index) => (
          <div
            key={index}
            className={
              message.role === 'user'
                ? 'ml-auto max-w-[85%] rounded-lg bg-accent-soft px-3 py-2 text-sm text-text'
                : 'mr-auto max-w-[85%] whitespace-pre-wrap rounded-lg bg-surface-2 px-3 py-2 text-sm text-text'
            }
          >
            {message.content}
          </div>
        ))}

        {thinking && (
          <div className="mr-auto rounded-lg bg-surface-2 px-3 py-2 font-mono text-sm text-text-subtle">
            {t('thinking')}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {error && (
        <div className="border-t border-border px-4 py-2 text-sm text-text-muted">
          <span className="font-medium">{t('failedPrefix')}</span> {error}
        </div>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send(input);
        }}
        className="flex items-end gap-2 border-t border-border p-3"
      >
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void send(input);
            }
          }}
          rows={2}
          placeholder={t('placeholder')}
          className="min-w-0 flex-1 resize-none rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-text-subtle focus:border-border-strong"
        />
        <Button type="submit" disabled={thinking || !input.trim()}>
          {t('send')}
        </Button>
        {messages.length > 0 && (
          <Button
            variant="ghost"
            type="button"
            onClick={() => {
              setMessages([]);
              setError(null);
            }}
          >
            {t('clear')}
          </Button>
        )}
      </form>
    </div>
  );
}
