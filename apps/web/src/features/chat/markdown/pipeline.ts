// Everything heavy the markdown renderer needs (markdown-it, DOMPurify, the Shiki loader), in one
// lazy chunk. Import it only through ./engine, never statically.
export { splitBlocks, updateBlocks } from './blocks';
export { highlightCode } from './highlight';
export { renderBlock } from './render';
