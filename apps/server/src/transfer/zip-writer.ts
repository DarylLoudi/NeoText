import { Zip, ZipDeflate } from 'fflate';
import type { Pace } from './pace';

/** A large file is compressed this much at a time, so one big chat cannot hold the server. */
const SLICE = 1024 * 1024;

/**
 * A zip of `files`, built one file and one slice at a time with `pace` called in between,
 * where `zipSync` would compress every file in one synchronous pass.
 */
export async function zipFiles(
  files: AsyncIterable<readonly [name: string, data: Uint8Array]>,
  pace: Pace,
): Promise<Buffer> {
  const out: Uint8Array[] = [];
  const state: { error: Error | null; done: boolean } = { error: null, done: false };
  const zip = new Zip((err, chunk, final) => {
    if (err) state.error = err;
    else {
      out.push(chunk);
      if (final) state.done = true;
    }
  });
  for await (const [name, data] of files) {
    const entry = new ZipDeflate(name, { level: 6 });
    zip.add(entry);
    if (data.length === 0) entry.push(new Uint8Array(0), true);
    for (let i = 0; i < data.length; i += SLICE) {
      entry.push(data.subarray(i, i + SLICE), i + SLICE >= data.length);
      await pace();
    }
    if (state.error) throw state.error;
  }
  zip.end();
  if (state.error) throw state.error;
  if (!state.done) throw new Error('the zip did not finish');
  return Buffer.concat(out);
}
