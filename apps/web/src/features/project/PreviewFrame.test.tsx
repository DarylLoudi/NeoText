import { render } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { PreviewFrame } from './PreviewFrame';

function setup(html = '<p>a</p>', page = 'index.html') {
  const onMessage = vi.fn();
  const view = render(
    <PreviewFrame html={html} page={page} title="Preview of index.html" onMessage={onMessage} />,
  );
  const frame = view.container.querySelector('iframe') as HTMLIFrameElement;
  const posted = vi.fn();
  Object.defineProperty(frame, 'contentWindow', {
    configurable: true,
    value: { postMessage: posted },
  });
  const fromFrame = (data: unknown, source: unknown = frame.contentWindow) =>
    window.dispatchEvent(new MessageEvent('message', { data, source: source as Window }));
  return { view, frame, onMessage, posted, fromFrame };
}

test('the frame is the sandboxed shell with no extra permissions', () => {
  const { frame } = setup();
  expect(frame.getAttribute('src')).toBe('/preview-frame/index.html');
  expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-forms allow-modals');
  expect(frame.getAttribute('allow')).toBeNull();
  expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
  expect(frame.getAttribute('title')).toBe('Preview of index.html');
});

test('sends the page once the shell is ready, and only once', () => {
  const { posted, fromFrame } = setup('<p>hello</p>');
  expect(posted).not.toHaveBeenCalled();
  fromFrame({ type: 'nt-preview-ready' });
  fromFrame({ type: 'nt-preview-ready' });
  expect(posted).toHaveBeenCalledTimes(1);
  expect(posted).toHaveBeenCalledWith({ type: 'nt-preview-load', html: '<p>hello</p>' }, '*');
});

test('passes on valid messages from its own frame only', () => {
  const { onMessage, fromFrame } = setup();
  fromFrame({ type: 'nt-console', level: 'log', text: 'hi' });
  fromFrame({ type: 'nt-console', level: 'log', text: 'spoof' }, window);
  fromFrame({ type: 'nt-eval', code: '1' });
  expect(onMessage).toHaveBeenCalledTimes(1);
  expect(onMessage).toHaveBeenCalledWith({ type: 'nt-console', level: 'log', text: 'hi' });
});

test('a new page mounts a new frame', () => {
  const { view, frame } = setup('<p>1</p>');
  view.rerender(<PreviewFrame html="<p>2</p>" page="index.html" title="t" onMessage={() => {}} />);
  expect(view.container.querySelector('iframe')).not.toBe(frame);
});

test('the shell sits at the page path, so the page resolves links the way the project does', () => {
  const { frame } = setup('<p>a</p>', 'pages/my page.html');
  expect(frame.getAttribute('src')).toBe('/preview-frame/pages/my%20page.html');
});

test('a shell that loads again elsewhere is the page moving itself: a navigation', () => {
  const { posted, onMessage, fromFrame } = setup();
  fromFrame({ type: 'nt-preview-ready', path: 'index.html' });
  expect(posted).toHaveBeenCalledTimes(1);
  fromFrame({ type: 'nt-preview-ready', path: 'pages/about.html' });
  expect(posted).toHaveBeenCalledTimes(1);
  expect(onMessage).toHaveBeenCalledWith({ type: 'nt-navigate', path: '/pages/about.html' });
});
