import { describe, expect, test } from 'vitest';
import { childrenOf, newestLeafUnder, pathToLeaf, siblingsOf } from './tree';

const nodes = [
  { id: 'r', parentId: null, createdAt: 1 },
  { id: 'a', parentId: 'r', createdAt: 2 },
  { id: 'b', parentId: 'a', createdAt: 3 },
  { id: 'c', parentId: 'a', createdAt: 4 },
  { id: 'd', parentId: 'r', createdAt: 5 },
];

describe('tree', () => {
  test('childrenOf sorts by createdAt then id', () => {
    expect(childrenOf(nodes, 'r').map((n) => n.id)).toEqual(['a', 'd']);
    expect(childrenOf(nodes, null).map((n) => n.id)).toEqual(['r']);
    const ties = [
      { id: 'y', parentId: null, createdAt: 1 },
      { id: 'x', parentId: null, createdAt: 1 },
    ];
    expect(childrenOf(ties, null).map((n) => n.id)).toEqual(['x', 'y']);
  });
  test('pathToLeaf', () => {
    expect(pathToLeaf(nodes, 'c').map((n) => n.id)).toEqual(['r', 'a', 'c']);
    expect(pathToLeaf(nodes, 'zz')).toEqual([]);
    expect(pathToLeaf(nodes, null)).toEqual([]);
  });
  test('siblingsOf', () => {
    expect(siblingsOf(nodes, 'c')).toMatchObject({ index: 1 });
    expect(siblingsOf(nodes, 'c').siblings.map((n) => n.id)).toEqual(['b', 'c']);
  });
  test('newestLeafUnder', () => {
    expect(newestLeafUnder(nodes, 'a').id).toBe('c');
    expect(newestLeafUnder(nodes, 'd').id).toBe('d');
    expect(newestLeafUnder(nodes, 'r').id).toBe('d');
  });
  test('cycle does not loop forever', () => {
    const cyc = [
      { id: 'a', parentId: 'b', createdAt: 1 },
      { id: 'b', parentId: 'a', createdAt: 2 },
    ];
    const path = pathToLeaf(cyc, 'a');
    expect(Array.isArray(path)).toBe(true);
    expect(path.length).toBeLessThanOrEqual(2);
  });
});
