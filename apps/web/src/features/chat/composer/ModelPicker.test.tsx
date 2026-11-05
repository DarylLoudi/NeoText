import type { ModelInfo } from '@neotext/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, expect, test, vi } from 'vitest';
import { createQueryClient } from '../../../lib/query';
import { resetFakeSettings, setFakeSettings, updateSettings } from '../../../test/fake-settings';
import {
  catalog,
  deepseek,
  deepseekFlash,
  freeModel,
  modelInfo,
  modelsResponse,
} from '../../../test/model-fixtures';
import { server } from '../../../test/msw';
import { TooltipProvider } from '../../../ui';
import { ModelPicker } from './ModelPicker';
import { resetWarmThrottle } from './warm';

vi.mock('../../../state/settings', () => import('../../../test/fake-settings'));

let warmed: string[] = [];
function serve(models: ModelInfo[] = catalog) {
  server.use(http.get('/api/models', () => HttpResponse.json(modelsResponse(models))));
}
beforeEach(() => {
  resetFakeSettings();
  resetWarmThrottle();
  warmed = [];
  serve();
  server.use(
    http.post('/api/providers/:id/warm', ({ params }) => {
      warmed.push(String(params.id));
      return new HttpResponse(null, { status: 204 });
    }),
  );
});

function setup(value: { providerId: string; modelId: string } | null = null) {
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={createQueryClient()}>
      <TooltipProvider>
        <ModelPicker value={value} onChange={onChange}>
          <button type="button">Pick a model</button>
        </ModelPicker>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  const open = async () => {
    await user.click(screen.getByRole('button', { name: 'Pick a model' }));
    return screen.findByRole('combobox', { name: 'Search models' });
  };
  const row = (name: string) => {
    const el = screen.getByText(name, { exact: true }).closest('[cmdk-item]');
    if (!el) throw new Error(`no row for ${name}`);
    return el as HTMLElement;
  };
  return { onChange, user, open, row };
}

test('shows price and context', async () => {
  const { open, row } = setup();
  await open();
  await screen.findByText('DeepSeek V4.1');
  const ds = row('DeepSeek V4.1');
  expect(within(ds).getByText('$0.045 in, $0.50 out per 1M')).toBeInTheDocument();
  expect(within(ds).getByText('1M context')).toBeInTheDocument();
  expect(within(row('DeepSeek V4.1 Flash')).getByText('256k context')).toBeInTheDocument();
  const free = row('Acme Free');
  expect(within(free).getByText('Free')).toBeInTheDocument();
  expect(free).not.toHaveTextContent('per 1M');
});

test('marks vision, tools and reasoning with named icons', async () => {
  const { open, row } = setup();
  await open();
  await screen.findByText('DeepSeek V4.1');
  const ds = row('DeepSeek V4.1');
  expect(within(ds).getByRole('img', { name: 'Understands images' })).toBeInTheDocument();
  expect(within(ds).getByRole('img', { name: 'Uses tools' })).toBeInTheDocument();
  expect(within(ds).getByRole('img', { name: 'Reasons step by step' })).toBeInTheDocument();
  expect(within(row('Acme Free')).queryByRole('img')).not.toBeInTheDocument();
});

test('lists models under their provider', async () => {
  const { open } = setup();
  await open();
  await screen.findByText('DeepSeek V4.1');
  expect(screen.getByText('OpenRouter')).toBeInTheDocument();
  expect(screen.queryByText('Favorites')).not.toBeInTheDocument();
});

test('star saves a favorite', async () => {
  const { open, row, user } = setup();
  await open();
  await screen.findByText('DeepSeek V4.1');
  await user.click(
    within(row('DeepSeek V4.1')).getByRole('button', { name: /Add .* to favorites/ }),
  );
  expect(updateSettings).toHaveBeenCalledWith({ models: { favorites: [`prv_1|${deepseek.id}`] } });
});

test('favorites form the first section and can be removed again', async () => {
  setFakeSettings({ settings: { models: { favorites: [`prv_1|${freeModel.id}`] } } });
  const { open, row, user } = setup();
  await open();
  await screen.findByText('DeepSeek V4.1');
  const headings = screen.getAllByRole('group').map((g) => g.getAttribute('aria-labelledby'));
  expect(headings).toHaveLength(2);
  const names = screen.getAllByRole('option').map((o) => o.textContent ?? '');
  expect(names[0]).toContain('Acme Free');
  // Not repeated in its provider section.
  expect(screen.getAllByText('Acme Free')).toHaveLength(1);
  await user.click(
    within(row('Acme Free')).getByRole('button', { name: /Remove .* from favorites/ }),
  );
  expect(updateSettings).toHaveBeenLastCalledWith({ models: { favorites: [] } });
});

test('choosing a model calls onChange and closes the list', async () => {
  const { open, user, onChange, row } = setup();
  await open();
  await screen.findByText('DeepSeek V4.1');
  await user.click(row('DeepSeek V4.1 Flash'));
  expect(onChange).toHaveBeenCalledWith({ providerId: 'prv_1', modelId: deepseekFlash.id });
  await waitFor(() =>
    expect(screen.queryByRole('combobox', { name: 'Search models' })).not.toBeInTheDocument(),
  );
});

test('typing filters, arrows move and Enter chooses', async () => {
  const { open, user, onChange } = setup();
  const search = await open();
  await screen.findByText('DeepSeek V4.1');
  await user.type(search, 'deepseek');
  expect(screen.queryByText('Acme Free')).not.toBeInTheDocument();
  await user.keyboard('{ArrowDown}{Enter}');
  expect(onChange).toHaveBeenCalledWith({ providerId: 'prv_1', modelId: deepseekFlash.id });
});

test('Shift+Enter stars the highlighted model without choosing it', async () => {
  const { open, user, onChange } = setup();
  const search = await open();
  await screen.findByText('DeepSeek V4.1');
  await user.type(search, 'acme');
  await waitFor(() => expect(screen.queryByText('DeepSeek V4.1')).not.toBeInTheDocument());
  await user.keyboard('{Shift>}{Enter}{/Shift}');
  expect(updateSettings).toHaveBeenCalledWith({ models: { favorites: [`prv_1|${freeModel.id}`] } });
  expect(onChange).not.toHaveBeenCalled();
});

test('says so when nothing matches', async () => {
  const { open, user } = setup();
  const search = await open();
  await screen.findByText('DeepSeek V4.1');
  await user.type(search, 'zzzz');
  expect(screen.getByText('No model matches "zzzz".')).toBeInTheDocument();
});

test('hidden models are not offered', async () => {
  setFakeSettings({ settings: { models: { hidden: [`prv_1|${freeModel.id}`] } } });
  const { open } = setup();
  await open();
  await screen.findByText('DeepSeek V4.1');
  expect(screen.queryByText('Acme Free')).not.toBeInTheDocument();
});

test('with no models, points to the provider settings', async () => {
  serve([]);
  const { user } = setup();
  await user.click(screen.getByRole('button', { name: 'Pick a model' }));
  expect(await screen.findByText(/No models yet/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open provider settings' })).toHaveAttribute(
    'href',
    '/settings/providers',
  );
});

test('opening warms the current provider, then choosing warms the chosen one', async () => {
  const { open, user, row } = setup({ providerId: 'prv_1', modelId: deepseek.id });
  await open();
  await waitFor(() => expect(warmed).toEqual(['prv_1']));
  await screen.findByText('DeepSeek V4.1');
  await user.click(row('Acme Free'));
  // Throttled: the same provider within the minute is not warmed again.
  expect(warmed).toEqual(['prv_1']);
});

test('450 models render a few rows and reveal more on request', async () => {
  const many = Array.from({ length: 450 }, (_, i) =>
    modelInfo({ id: `lab/model-${String(i).padStart(3, '0')}`, name: `Model ${i}` }),
  );
  serve(many);
  const { open, user } = setup();
  const search = await open();
  await screen.findByText('Model 0');
  const shown = screen.getAllByRole('option').length;
  expect(shown).toBeLessThan(80);
  expect(screen.queryByText('Model 449')).not.toBeInTheDocument();
  await user.click(screen.getByRole('option', { name: /Show 40 more/ }));
  expect(screen.getAllByRole('option').length).toBeGreaterThan(shown + 30);

  // Typing narrows from the whole list, not just what was rendered.
  await user.type(search, 'model 449');
  expect(await screen.findByText('Model 449')).toBeInTheDocument();
  expect(screen.getAllByRole('option')).toHaveLength(1);
});
