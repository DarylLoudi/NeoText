import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { openDatabase } from './client';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neotext db-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

test('pragmas for durability', () => {
  const db = openDatabase(path.join(dir, 'a b.db'));
  expect(db.raw.pragma('journal_mode', { simple: true })).toBe('wal');
  expect(db.raw.pragma('synchronous', { simple: true })).toBe(2);
  expect(db.raw.pragma('foreign_keys', { simple: true })).toBe(1);
  expect(db.raw.pragma('busy_timeout', { simple: true })).toBe(5000);
  db.close();
});

test('in-memory database opens and closes', () => {
  const db = openDatabase(':memory:');
  expect(db.raw.prepare('SELECT 1 AS one').get()).toEqual({ one: 1 });
  db.close();
  expect(db.raw.open).toBe(false);
});
