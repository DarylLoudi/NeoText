export interface TreeNode {
  id: string;
  parentId: string | null;
  createdAt: number;
}

const byCreated = (a: TreeNode, b: TreeNode) =>
  a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function childrenOf<T extends TreeNode>(nodes: T[], parentId: string | null): T[] {
  return nodes.filter((n) => n.parentId === parentId).sort(byCreated);
}

/** Root-to-leaf path; `[]` when the leaf is unknown. Stops if a cycle is detected. */
export function pathToLeaf<T extends TreeNode>(nodes: T[], leafId: string | null): T[] {
  if (leafId === null) return [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const path: T[] = [];
  const seen = new Set<string>();
  let cur = byId.get(leafId);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    path.push(cur);
    cur = cur.parentId === null ? undefined : byId.get(cur.parentId);
  }
  return path.reverse();
}

export function siblingsOf<T extends TreeNode>(
  nodes: T[],
  id: string,
): { siblings: T[]; index: number } {
  const node = nodes.find((n) => n.id === id);
  if (!node) return { siblings: [], index: -1 };
  const siblings = childrenOf(nodes, node.parentId);
  return { siblings, index: siblings.findIndex((n) => n.id === id) };
}

/** The leaf with the largest `createdAt` in the subtree rooted at `id`. */
export function newestLeafUnder<T extends TreeNode>(nodes: T[], id: string): T {
  const root = nodes.find((n) => n.id === id);
  if (!root) throw new Error(`Node ${id} is not in the tree.`);
  const kids = new Map<string, T[]>();
  for (const n of nodes) {
    if (n.parentId === null) continue;
    const list = kids.get(n.parentId);
    if (list) list.push(n);
    else kids.set(n.parentId, [n]);
  }
  let best = root;
  let found = false;
  const seen = new Set<string>([root.id]);
  const stack: T[] = [root];
  while (stack.length > 0) {
    const node = stack.pop() as T;
    const children = kids.get(node.id) ?? [];
    if (children.length === 0 && node !== root) {
      if (!found || byCreated(node, best) > 0) best = node;
      found = true;
    }
    for (const c of children) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      stack.push(c);
    }
  }
  return best;
}
