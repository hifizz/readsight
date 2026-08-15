import { ArrowUp } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport
} from '@/components/ui/message-scroller';
import { Textarea } from '@/components/ui/textarea';
import type { Source, ThreadMessage } from '../types';

export function ConversationPanel({
  source,
  messages,
  question,
  onQuestionChange,
  onAsk,
  canAsk,
  busy,
  error
}: {
  source: Source;
  messages: ThreadMessage[];
  question: string;
  onQuestionChange: (question: string) => void;
  onAsk: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  canAsk: boolean;
  busy: boolean;
  error: string | null;
}) {
  return (
    <DialogContent className="!flex h-[min(76dvh,600px)] max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
      <DialogHeader className="min-w-0 shrink-0 gap-1 border-b px-3 py-3 pr-11">
        <DialogTitle>讨论</DialogTitle>
        <DialogDescription className="break-words text-xs leading-5 [overflow-wrap:anywhere]">
          {source.title}
        </DialogDescription>
      </DialogHeader>
      {error && (
        <Alert variant="destructive" className="mx-3 mt-3 shrink-0">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <MessageScrollerProvider autoScroll defaultScrollPosition="last-anchor">
        <div className="flex min-h-0 flex-1 flex-col">
          <MessageScroller className="flex-1">
            <MessageScrollerViewport aria-label="讨论记录">
              <MessageScrollerContent aria-busy={busy} className="gap-2 p-3">
                {messages.length === 0 ? (
                  <p className="m-auto max-w-52 text-center text-xs leading-5 text-muted-foreground">
                    基于当前 Analysis 继续讨论。
                  </p>
                ) : (
                  messages.map((message) => (
                    <MessageScrollerItem
                      key={message.id}
                      messageId={message.id}
                      scrollAnchor={message.role === 'user'}
                      className={`max-w-[90%] rounded-lg px-2.5 py-2 text-xs leading-5 whitespace-pre-wrap [overflow-wrap:anywhere] ${message.role === 'user' ? 'ml-auto bg-primary text-primary-foreground' : 'bg-muted'}`}
                    >
                      {message.content
                        .filter((part) => part.type === 'text')
                        .map((part) => part.text)
                        .join('\n')}
                    </MessageScrollerItem>
                  ))
                )}
              </MessageScrollerContent>
            </MessageScrollerViewport>
            <MessageScrollerButton className="bottom-3" />
          </MessageScroller>
          <form
            className="flex shrink-0 items-end gap-2 border-t bg-background p-3"
            onSubmit={(event) => void onAsk(event)}
          >
            <Textarea
              aria-label="Ask Relata"
              value={question}
              onChange={(event) => onQuestionChange(event.target.value)}
              placeholder="Ask Relata…"
              className="max-h-32 min-h-14 flex-1 resize-none text-xs leading-5"
            />
            <Button
              type="submit"
              size="icon-sm"
              className="mb-0.5"
              disabled={!canAsk || !question.trim() || busy}
              aria-label="发送"
            >
              <ArrowUp />
            </Button>
          </form>
        </div>
      </MessageScrollerProvider>
    </DialogContent>
  );
}
