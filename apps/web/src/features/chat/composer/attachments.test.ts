import { expect, test } from 'vitest';
import { modelInfo } from '../../../test/model-fixtures';
import { attachmentSupport, formatBytes } from './attachments';

const modelWithImages = modelInfo({ id: 'vision', inputModalities: ['text', 'image'] });
const textOnlyModel = modelInfo({ id: 'plain', inputModalities: ['text'] });
const unknownModel = modelInfo({ id: 'custom', inputModalities: [] });
const modelWithFiles = modelInfo({ id: 'docs', inputModalities: ['text', 'file'] });

test.each([
  [modelWithImages, 'image/png', 'ok'],
  [textOnlyModel, 'image/png', 'unsupported'],
  [null, 'image/png', 'ok'],
  [textOnlyModel, 'application/pdf', 'unsupported'],
  [modelWithFiles, 'application/pdf', 'ok'],
  [modelWithImages, 'application/pdf', 'unsupported'],
  [textOnlyModel, 'text/plain', 'ok'],
  [textOnlyModel, 'text/markdown', 'ok'],
  [unknownModel, 'image/png', 'ok'],
  [unknownModel, 'application/pdf', 'ok'],
] as const)('support %#', (model, mime, out) => {
  expect(attachmentSupport(model, mime)).toBe(out);
});

test.each([
  [512, '512 B'],
  [2048, '2 KB'],
  [1_572_864, '1.5 MB'],
])('formats %d bytes', (n, out) => {
  expect(formatBytes(n, 'en')).toBe(out);
});
