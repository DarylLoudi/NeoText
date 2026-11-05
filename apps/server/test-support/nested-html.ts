/** Deeply nested markup that keeps linkedom and Readability busy for many seconds. */
export const nestedHtml = (depth = 20_000) => `<html><body>${'<div>'.repeat(depth)}teks`;
