import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { expect, test } from 'vitest';
import { TextArea } from '@/ui';

function mockScrollHeight(px: number) {
  Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', {
    configurable: true,
    get: () => px,
  });
}

test('textarea respects maxRows', () => {
  const lineHeight = 20;
  mockScrollHeight(lineHeight * 20);
  const ref = createRef<HTMLTextAreaElement>();
  render(
    <TextArea ref={ref} label="Message" minRows={2} maxRows={5} defaultValue={'x\n'.repeat(20)} />,
  );
  const el = screen.getByLabelText('Message') as HTMLTextAreaElement;
  expect(ref.current).toBe(el);
  expect(Number.parseFloat(el.style.height)).toBeLessThanOrEqual(lineHeight * 5 + 40);
  expect(el.style.overflowY).toBe('auto');
});

test('short content does not scroll', () => {
  mockScrollHeight(40);
  render(<TextArea label="Note" minRows={2} maxRows={5} defaultValue="hi" />);
  expect(screen.getByLabelText('Note').style.overflowY).toBe('hidden');
});
