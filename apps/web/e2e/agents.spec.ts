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

test('an unsent message keeps its text and its agent over a reload', async ({ page, request }) => {
  const id = await createAgent(request, 'Agent-Reload', 'You review CSS. SAY HELLO.');
  try {
    await enqueue(request, { chunks: ['Reviewed after the reload.'] });
    await page.goto('/');
    await page.getByRole('button', { name: 'Agent', exact: true }).click();
    await page.getByRole('menuitem', { name: /Agent-Reload/ }).click();
    await message(page).fill('Check my stylesheet');
    // The draft is saved a moment after typing stops.
    await page.waitForTimeout(600);

    await page.reload();
    await expect(message(page)).toHaveValue('Check my stylesheet');
    await expect(page.getByTitle('Answering as Agent-Reload')).toBeVisible();
    await message(page).press('Enter');

    const thread = page.getByRole('main');
    await expect(thread.getByText('Reviewed after the reload.')).toBeVisible();
    await expect(thread.getByText('Agent-Reload', { exact: true })).toBeVisible();
    const system = (await chatRequestBodies(request)).at(-1)?.messages[0];
    expect(String(system?.content)).toContain('You review CSS. SAY HELLO.');
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

test('an agent with a knowledge file gets the search tool and shows the lookup', async ({
  page,
  request,
}) => {
  const id = await createAgent(request, 'Asisten-Kalkulus', 'You answer from the course notes.');
  try {
    const upload = await request.post(`/api/agents/${id}/files`, {
      multipart: {
        file: {
          name: 'catatan.md',
          mimeType: 'text/markdown',
          buffer: Buffer.from(
            '# Pegas\n\nPersamaan karakteristik pegas tanpa redaman: r^2 = -k/m.',
          ),
        },
      },
    });
    expect(upload.status()).toBe(201);
    expect(((await upload.json()) as { status: string }).status).toBe('ready');

    await enqueue(
      request,
      {
        chunks: [],
        toolCalls: [
          {
            id: 'call_k',
            name: 'search_knowledge',
            arguments: JSON.stringify({ query: 'persamaan karakteristik pegas' }),
          },
        ],
      },
      { chunks: ['Menurut catatan, r^2 = -k/m.'] },
    );
    await page.goto('/');
    await page.getByRole('button', { name: 'Agent', exact: true }).click();
    await page.getByRole('menuitem', { name: /Asisten-Kalkulus/ }).click();
    await message(page).fill('Apa persamaan karakteristik pegas?');
    await message(page).press('Enter');

    const thread = page.getByRole('main');
    await expect(thread.getByText('Menurut catatan, r^2 = -k/m.')).toBeVisible();
    await expect(
      thread.locator('details', { hasText: 'Searched the knowledge base' }),
    ).toBeVisible();

    const bodies = await chatRequestBodies(request);
    const first = bodies[0] as unknown as {
      tools?: { function: { name: string } }[];
      messages: { content: string }[];
    };
    expect(first.tools?.some((t) => t.function.name === 'search_knowledge')).toBe(true);
    expect(String(first.messages[0]?.content)).toContain('catatan.md');
    // The second request carries the tool result with the matched passage.
    expect(JSON.stringify(bodies[1])).toContain('r^2 = -k/m');
  } finally {
    await request.delete(`/api/agents/${id}`);
  }
});

test('a sub-agent row keeps its time inside the card on a phone', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const tasks = [
    { title: 'Prices of laptop A in several stores across the country', instructions: 'A' },
    { title: 'Prices of laptop B', instructions: 'B' },
  ];
  await enqueue(
    request,
    {
      chunks: [],
      toolCalls: [{ id: 'call_d', name: 'delegate_tasks', arguments: JSON.stringify({ tasks }) }],
    },
    { chunks: ['Laptop A is $900.'] },
    { chunks: ['Laptop B is $1,100.'] },
    { chunks: ['A is cheaper.'] },
  );
  await page.goto('/');
  await message(page).fill('Compare laptop A and B');
  await message(page).press('Enter');
  const thread = page.getByRole('main');
  await expect(thread.getByText('A is cheaper.')).toBeVisible();
  await thread.getByText('2 sub-agents finished').click();

  const card = thread.locator('[data-finished]');
  const cardBox = await card.boundingBox();
  const rows = card.getByRole('listitem');
  await expect(rows).toHaveCount(2);
  for (const row of await rows.all()) {
    const button = await row.getByRole('button').boundingBox();
    expect(button && cardBox && button.x + button.width).toBeLessThanOrEqual(
      (cardBox?.x ?? 0) + (cardBox?.width ?? 0),
    );
  }
});
