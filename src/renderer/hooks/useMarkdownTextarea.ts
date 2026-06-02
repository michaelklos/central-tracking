import { useCallback } from 'react';

interface Options {
  value: string;
  onChange: (value: string) => void;
  onSave?: () => void;
}

const LIST_PREFIX_RE = /^(\s*)([-*+]|\d+\.)\s/;

function getLineStart(text: string, pos: number): number {
  const idx = text.lastIndexOf('\n', pos - 1);
  return idx === -1 ? 0 : idx + 1;
}

function nextNumberedPrefix(prefix: string): string {
  const m = prefix.match(/^(\s*)(\d+)\.\s$/);
  if (!m) return prefix;
  return `${m[1]}${parseInt(m[2], 10) + 1}. `;
}

export function useMarkdownTextarea({ value, onChange, onSave }: Options) {
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Cmd/Ctrl+S → save
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        onSave?.();
        return;
      }

      // Cmd/Ctrl+Enter → save (default for any text field, alongside blur)
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        onSave?.();
        return;
      }

      // Enter → markdown list continuation
      if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        const ta = e.currentTarget;
        const pos = ta.selectionStart;
        const lineStart = getLineStart(value, pos);
        const currentLine = value.slice(lineStart, pos);
        const match = currentLine.match(LIST_PREFIX_RE);

        if (!match) return;

        e.preventDefault();
        const fullPrefix = match[0]; // e.g. "* " or "1. "
        const contentAfterPrefix = currentLine.slice(fullPrefix.length);

        if (contentAfterPrefix.trim() === '') {
          // Empty bullet — remove prefix, plain newline
          const newValue =
            value.slice(0, lineStart) +
            '\n' +
            value.slice(pos);
          onChange(newValue);
          // Restore cursor after the newline (at lineStart + 1)
          requestAnimationFrame(() => {
            ta.selectionStart = ta.selectionEnd = lineStart + 1;
          });
        } else {
          // Continue list with next prefix
          const isOrdered = /\d+\./.test(match[2]);
          const nextPrefix = isOrdered ? nextNumberedPrefix(fullPrefix) : fullPrefix;
          const newValue =
            value.slice(0, pos) +
            '\n' + nextPrefix +
            value.slice(ta.selectionEnd);
          onChange(newValue);
          const newPos = pos + 1 + nextPrefix.length;
          requestAnimationFrame(() => {
            ta.selectionStart = ta.selectionEnd = newPos;
          });
        }
      }
    },
    [value, onChange, onSave]
  );

  return { onKeyDown };
}
