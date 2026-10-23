import { tokenizeTimestamps } from '@spool/shared';
import { Play } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';

interface RichMessageProps {
  content: string;
  onTimestamp: (editedSeconds: number) => void;
}

function inline(text: string, onTimestamp: RichMessageProps['onTimestamp'], keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  tokenizeTimestamps(text).forEach((token, index) => {
    if (token.type === 'timestamp') {
      nodes.push(
        <button
          key={`${keyPrefix}-ts-${index}`}
          onClick={() => onTimestamp(token.seconds)}
          className="mx-0.5 inline-flex translate-y-[-1px] items-center gap-1 rounded-md border border-accent/30 bg-accent/10 px-1.5 py-px align-middle font-mono text-[11px] font-semibold text-accent transition hover:border-accent/60 hover:bg-accent/20 hover:shadow-[0_0_12px_-2px_rgba(0,250,154,0.6)]"
        >
          <Play className="h-2.5 w-2.5 fill-current" />
          {token.value}
        </button>,
      );
      return;
    }
    const parts = token.value.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    parts.forEach((part, partIndex) => {
      const key = `${keyPrefix}-${index}-${partIndex}`;
      if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
        nodes.push(
          <strong key={key} className="font-semibold text-white">
            {part.slice(2, -2)}
          </strong>,
        );
      } else if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
        nodes.push(
          <code key={key} className="rounded bg-white/10 px-1 py-px font-mono text-[12px] text-white">
            {part.slice(1, -1)}
          </code>,
        );
      } else if (part) {
        nodes.push(<Fragment key={key}>{part}</Fragment>);
      }
    });
  });
  return nodes;
}

/** Minimal, safe Markdown renderer (paragraphs, lists, bold, code) with clickable `[mm:ss]` citations. */
export function RichMessage({ content, onTimestamp }: RichMessageProps) {
  const blocks: ReactNode[] = [];
  const lines = content.split('\n');
  let list: { ordered: boolean; items: string[] } | null = null;
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const key = `p-${blocks.length}`;
    blocks.push(
      <p key={key} className="leading-relaxed">
        {inline(paragraph.join(' '), onTimestamp, key)}
      </p>,
    );
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const key = `l-${blocks.length}`;
    const items = list.items.map((itemText, i) => (
      <li key={`${key}-${i}`} className="pl-1 leading-relaxed marker:text-accent/80">
        {inline(itemText, onTimestamp, `${key}-${i}`)}
      </li>
    ));
    blocks.push(
      list.ordered ? (
        <ol key={key} className="list-decimal space-y-1.5 pl-5">
          {items}
        </ol>
      ) : (
        <ul key={key} className="list-disc space-y-1.5 pl-5">
          {items}
        </ul>
      ),
    );
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    if (bullet || ordered) {
      flushParagraph();
      const isOrdered = Boolean(ordered);
      if (!list || list.ordered !== isOrdered) {
        flushList();
        list = { ordered: isOrdered, items: [] };
      }
      list.items.push(((bullet ?? ordered) as RegExpMatchArray)[1] ?? '');
    } else if (heading) {
      flushParagraph();
      flushList();
      const key = `h-${blocks.length}`;
      blocks.push(
        <p key={key} className="font-semibold text-white">
          {inline(heading[1] ?? '', onTimestamp, key)}
        </p>,
      );
    } else if (!line.trim()) {
      flushParagraph();
      flushList();
    } else {
      flushList();
      paragraph.push(line.trim());
    }
  }
  flushParagraph();
  flushList();

  return <div className="space-y-2.5 text-[13.5px] text-white/80">{blocks}</div>;
}
