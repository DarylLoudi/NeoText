import type { ChatRequestBody, ModelRef } from '@neotext/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createQueryClient } from '../../lib/query';
import { resetGenerations } from '../../state/generations';
import { resetFakeSettings, setFakeSettings } from '../../test/fake-settings';
import {
  catalog,
  deepseek,
  deepseekFlash,
  freeModel,
  modelInfo,
  modelsResponse,
} from '../../test/model-fixtures';
import { server } from '../../test/msw';
import { mockBackend, renderApp } from '../../test/renderApp';
import { stubLayout } from '../../test/sidebar-backend';
import { TooltipProvider } from '../../ui';
import { resetWarmThrottle } from '../chat/composer/warm';
import { ComparePicker } from './ComparePicker';
import { getCompareState, resetCompare, toggleCompare } from './compare-state';

vi.mock('../../state/settings', () => import('../../test/fake-settings'));

const five = [
  deepseek,
  deepseekFlash,
  freeModel,
  modelInfo({ id: 'acme/four', name: 'Acme Four' }),
  modelInfo({ id: 'acme/five', name: 'Acme Five' }),
];

let restoreLayout: () => void = () => undefined;
beforeEach(() => {
  resetFakeSettings();
  resetGenerations();
  resetWarmThrottle();
  resetCompare();
  server.use(http.post('/api/providers/:id/warm', () => new HttpResponse(null, { status: 204 })));
});
afterEach(() => restoreLayout());

function Harness({ onChange }: { onChange: (refs: ModelRef[]) => void }) {
  const [value, setValue] = useState<ModelRef[]>([]);
  return (
    <ComparePicker
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

test('picker limits to four', async () => {
  server.use(http.get('/api/models', () => HttpResponse.json(modelsResponse(five))));
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={createQueryClient()}>
      <TooltipProvider>
        <Harness onChange={onChange} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole('button', { name: 'Add a model' }));
  const dialog = await screen.findByRole('dialog', { name: 'Models to compare' });
  await within(dialog).findByText('Acme Five');
  for (const name of ['DeepSeek V4.1', 'DeepSeek V4.1 Flash', 'Acme Free', 'Acme Four']) {
    await user.click(within(dialog).getByText(name, { exact: true }));
  }
  expect(onChange).toHaveBeenLastCalledWith(
    five.slice(0, 4).map((m) => ({ providerId: 'prv_1', modelId: m.id })),
  );
  await user.click(within(dialog).getByText('Acme Five', { exact: true }));
  expect(onChange).toHaveBeenCalledTimes(4);
  expect(within(dialog).getByText('You can compare up to 4 models.')).toBeInTheDocument();
  // Picking a chosen model again takes it off the list.
  await user.click(within(dialog).getByText('Acme Free', { exact: true }));
  expect(onChange.mock.lastCall?.[0]).toHaveLength(3);
});

test('a chip removes its model', async () => {
  server.use(http.get('/api/models', () => HttpResponse.json(modelsResponse(five))));
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={createQueryClient()}>
      <TooltipProvider>
        <ComparePicker
          value={[
            { providerId: 'prv_1', modelId: deepseek.id },
            { providerId: 'prv_1', modelId: freeModel.id },
          ]}
          onChange={onChange}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  await user.click(await screen.findByRole('button', { name: 'Remove Acme Free' }));
  expect(onChange).toHaveBeenCalledWith([{ providerId: 'prv_1', modelId: deepseek.id }]);
});

test('send uses all targets', async () => {
  mockBackend({ signedIn: true });
  restoreLayout = stubLayout();
  setFakeSettings({
    settings: { chat: { defaultModel: { providerId: 'prv_1', modelId: deepseek.id } } },
  });
  const bodies: ChatRequestBody[] = [];
  server.use(
    http.get('/api/models', () => HttpResponse.json(modelsResponse(catalog))),
    http.get('/api/tools', () => HttpResponse.json({ tools: [], webSearchBackend: false })),
    http.post('/api/chat', async ({ request }) => {
      bodies.push((await request.json()) as ChatRequestBody);
      return HttpResponse.json({ error: { code: 'bad', message: 'No.' } }, { status: 400 });
    }),
  );
  const { user } = renderApp('/');
  const box = await screen.findByRole('textbox', { name: 'Message' });
  await screen.findByRole('region', { name: 'DeepSeek V4.1' });
  await user.click(screen.getByRole('button', { name: 'Compare' }));
  expect(getCompareState().enabled).toBe(true);
  // Starts from the model in use.
  expect(getCompareState().targets).toEqual([{ providerId: 'prv_1', modelId: deepseek.id }]);
  // The picker's code loads the first time compare is turned on.
  await user.click(await screen.findByRole('button', { name: 'Add a model' }));
  const dialog = await screen.findByRole('dialog', { name: 'Models to compare' });
  await user.click(await within(dialog).findByText('DeepSeek V4.1 Flash', { exact: true }));
  await user.click(within(dialog).getByText('Acme Free', { exact: true }));
  await user.keyboard('{Escape}');
  await user.type(box, 'Which is best?{Enter}');
  await waitFor(() => expect(bodies).toHaveLength(1));
  expect(bodies[0]?.targets).toEqual([
    { providerId: 'prv_1', modelId: deepseek.id },
    { providerId: 'prv_1', modelId: deepseekFlash.id },
    { providerId: 'prv_1', modelId: freeModel.id },
  ]);
});

test('the sidebar quick action toggles the same compare state', async () => {
  mockBackend({ signedIn: true });
  restoreLayout = stubLayout();
  setFakeSettings({ settings: { sidebar: { quickActions: ['new-chat', 'compare'] } } });
  const { user } = renderApp('/');
  const sidebar = await screen.findByRole('complementary', { name: 'Sidebar' });
  const action = await within(sidebar).findByRole('button', { name: 'Compare' });
  expect(action).toHaveAttribute('aria-pressed', 'false');
  await user.click(action);
  expect(getCompareState().enabled).toBe(true);
  expect(action).toHaveAttribute('aria-pressed', 'true');
  toggleCompare();
  expect(getCompareState().enabled).toBe(false);
});

test('the last chosen model cannot be removed', async () => {
  server.use(http.get('/api/models', () => HttpResponse.json(modelsResponse(five))));
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={createQueryClient()}>
      <TooltipProvider>
        <ComparePicker
          value={[{ providerId: 'prv_1', modelId: deepseek.id }]}
          onChange={onChange}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  await screen.findByText('DeepSeek V4.1');
  expect(screen.queryByRole('button', { name: 'Remove DeepSeek V4.1' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Add a model' }));
  const dialog = await screen.findByRole('dialog', { name: 'Models to compare' });
  await user.click(await within(dialog).findByText('DeepSeek V4.1', { exact: true }));
  expect(onChange).not.toHaveBeenCalled();
});

test('turning compare on stores the model in use, so its chip removes normally', async () => {
  mockBackend({ signedIn: true });
  restoreLayout = stubLayout();
  setFakeSettings({
    settings: { chat: { defaultModel: { providerId: 'prv_1', modelId: deepseek.id } } },
  });
  server.use(
    http.get('/api/models', () => HttpResponse.json(modelsResponse(catalog))),
    http.get('/api/tools', () => HttpResponse.json({ tools: [], webSearchBackend: false })),
  );
  const { user } = renderApp('/');
  await screen.findByRole('region', { name: 'DeepSeek V4.1' });
  await user.click(screen.getByRole('button', { name: 'Compare' }));
  expect(getCompareState().targets).toEqual([{ providerId: 'prv_1', modelId: deepseek.id }]);
  await user.click(screen.getByRole('button', { name: 'Add a model' }));
  const dialog = await screen.findByRole('dialog', { name: 'Models to compare' });
  await user.click(await within(dialog).findByText('Acme Free', { exact: true }));
  await user.keyboard('{Escape}');
  await user.click(screen.getByRole('button', { name: 'Remove DeepSeek V4.1' }));
  expect(getCompareState().targets).toEqual([{ providerId: 'prv_1', modelId: freeModel.id }]);
  expect(screen.queryByRole('button', { name: 'Remove DeepSeek V4.1' })).toBeNull();
});

test('compare turned on from the sidebar is seeded by the composer', async () => {
  mockBackend({ signedIn: true });
  restoreLayout = stubLayout();
  setFakeSettings({
    settings: {
      chat: { defaultModel: { providerId: 'prv_1', modelId: deepseek.id } },
      sidebar: { quickActions: ['compare'] },
    },
  });
  server.use(
    http.get('/api/models', () => HttpResponse.json(modelsResponse(catalog))),
    http.get('/api/tools', () => HttpResponse.json({ tools: [], webSearchBackend: false })),
  );
  const { user } = renderApp('/');
  await screen.findByRole('region', { name: 'DeepSeek V4.1' });
  const sidebar = screen.getByRole('complementary', { name: 'Sidebar' });
  await user.click(within(sidebar).getByRole('button', { name: 'Compare' }));
  await waitFor(() =>
    expect(getCompareState().targets).toEqual([{ providerId: 'prv_1', modelId: deepseek.id }]),
  );
});
