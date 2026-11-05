import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { resetState } from './support/api';
import { chatRequestBodies, enqueue } from './support/control';

test.beforeEach(async ({ request }) => {
  await resetState(request);
});

const message = (page: Page) => page.getByRole('textbox', { name: 'Message' });

async function createAgent(request: APIRequestContext, name: string, instructions: string) {
  const res = await request.post('/api/agents', {
    data: { name, data: { description: 'Reviews frontend code.', instructions } },
  });
  if (!res.ok()) throw new Error(`Creating an agent failed: ${res.status()} ${await res.text()}`);
  return ((await res.json()) as { id: string }).id;
}

test('an agent called from the composer answers with its own instructions', async ({
  page,
  request,
}) => {
  const id = await createAgent(request, 'Agent-Frontend', 'You review React code. BE KIND.');
  try {
    await enqueue(request, { chunks: ['Looks clean to me.'] });
    await page.goto('/');
    await page.getByRole('button', { name: 'Agent', exact: true }).click();
    await page.getByRole('menuitem', { name: /Agent-Frontend/ }).click();
    await expect(page.getByTitle('Answering as Agent-Frontend')).toBeVisible();
    await message(page).fill('Check my button component');
    await message(page).press('Enter');

    const thread = page.getByRole('main');
    await expect(thread.getByText('Looks clean to me.')).toBeVisible();
    await expect(thread.getByText('Agent-Frontend', { exact: true })).toBeVisible();
    const bodies = await chatRequestBodies(request);
    const system = bodies.at(-1)?.messages[0];
    expect(system?.role).toBe('system');
    expect(String(system?.content)).toContain('You review React code. BE KIND.');
  } finally {
    await request.delete(`/api/agents/${id}`);
  }
});

test('delegate_tasks runs sub-agents and the card ends collapsed', async ({ page, request }) => {
  const tasks = [
    { title: 'Prices of laptop A', instructions: 'Find the price of laptop A.' },
    { title: 'Prices of laptop B', instructions: 'Find the price of laptop B.' },
  ];
  await enqueue(
    request,
    {
      chunks: [],
      toolCalls: [{ id: 'call_d', name: 'delegate_tasks', arguments: JSON.stringify({ tasks }) }],
    },
    { chunks: ['Laptop costs about $900.'] },
    { chunks: ['Laptop costs about $1,100.'] },
    { chunks: ['A is cheaper than B.'] },
  );
  await page.goto('/');
  await message(page).fill('Compare laptop A and laptop B in depth');
  await message(page).press('Enter');

  const thread = page.getByRole('main');
  await expect(thread.getByText('A is cheaper than B.')).toBeVisible();
  const card = thread.getByText('2 sub-agents finished');
  await expect(card).toBeVisible();
  await card.click();
  await expect(thread.getByText('Prices of laptop A')).toBeVisible();
  await expect(thread.getByText('Prices of laptop B')).toBeVisible();
});
