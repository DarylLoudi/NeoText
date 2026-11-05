import type { Preset } from '@neotext/shared';
import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { beforeEach, expect, test, vi } from 'vitest';
import { resetFakeSettings } from '../../test/fake-settings';
import { server } from '../../test/msw';
import { renderWithClient } from '../../test/renderWithClient';
import { PresetEditor } from './PresetEditor';

vi.mock('../../state/settings', () => import('../../test/fake-settings'));

beforeEach(() => {
  resetFakeSettings();
  server.use(
    http.get('/api/models', () => HttpResponse.json({ providers: [] })),
    http.get('/api/presets', () => HttpResponse.json({ presets: [] })),
  );
});

const saved: Preset = {
  id: 'pst_1',
  name: 'Editor',
  position: 'a0',
  createdAt: 0,
  updatedAt: 0,
  data: {
    systemPrompt: 'Fix the prose.',
    model: null,
    reasoningEffort: null,
    temperature: 0.4,
    maxOutputTokens: null,
    webSearch: false,
    color: 'mint',
  },
};

test('validates and saves', async () => {
  const bodies: unknown[] = [];
  server.use(
    http.post('/api/presets', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      bodies.push(body);
      return HttpResponse.json({ ...saved, ...body, id: 'pst_2' }, { status: 201 });
    }),
  );
  const onOpenChange = vi.fn();
  const { user } = renderWithClient(
    <PresetEditor open preset={null} onOpenChange={onOpenChange} />,
  );

  await user.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(screen.getByText('Give the preset a name.')).toBeInTheDocument();
  expect(bodies).toHaveLength(0);

  await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Tutor');
  await user.type(screen.getByRole('textbox', { name: 'Temperature' }), '3');
  await user.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(screen.getByText('Use a number from 0 to 2.')).toBeInTheDocument();
  expect(bodies).toHaveLength(0);

  const temperature = screen.getByRole('textbox', { name: 'Temperature' });
  await user.clear(temperature);
  await user.type(temperature, '0.7');
  await user.type(screen.getByRole('textbox', { name: 'System prompt' }), 'Teach step by step.');
  await user.click(screen.getByRole('radio', { name: 'Sky' }));
  await user.click(screen.getByRole('button', { name: 'Save changes' }));

  await waitFor(() => expect(bodies).toHaveLength(1));
  expect(bodies[0]).toMatchObject({
    name: 'Tutor',
    data: {
      systemPrompt: 'Teach step by step.',
      temperature: 0.7,
      maxOutputTokens: null,
      model: null,
      webSearch: false,
      color: 'sky',
    },
  });
  expect(typeof (bodies[0] as { position: string }).position).toBe('string');
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
});

test('editing sends only a patch for the preset', async () => {
  const patches: unknown[] = [];
  server.use(
    http.patch('/api/presets/pst_1', async ({ request }) => {
      patches.push(await request.json());
      return HttpResponse.json(saved);
    }),
  );
  const { user } = renderWithClient(<PresetEditor open preset={saved} onOpenChange={vi.fn()} />);
  expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Editor');
  expect(screen.getByRole('textbox', { name: 'Temperature' })).toHaveValue('0.4');
  await user.type(screen.getByRole('textbox', { name: 'Name' }), ' 2');
  await user.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(patches).toHaveLength(1));
  expect(patches[0]).toMatchObject({ name: 'Editor 2', data: { temperature: 0.4, color: 'mint' } });
});
