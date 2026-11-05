import { fireEvent, screen, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { beforeEach, expect, test, vi } from 'vitest';
import { resetFakeSettings, setFakeSettings, updateSettings } from '../../../test/fake-settings';
import { catalog, modelInfo, modelsResponse } from '../../../test/model-fixtures';
import { server } from '../../../test/msw';
import { renderWithClient } from '../../../test/renderWithClient';
import { ModelsSettings } from './ModelsSettings';

vi.mock('../../../state/settings', () => import('../../../test/fake-settings'));

const KEY = 'prv_1|deepseek/deepseek-v4.1';

function serve(models = catalog) {
  server.use(http.get('/api/models', () => HttpResponse.json(modelsResponse(models))));
}
beforeEach(() => {
  resetFakeSettings();
  serve();
});

// biome-ignore lint/suspicious/noExplicitAny: a test reads a nested patch loosely
const lastPatch = () => updateSettings.mock.calls.at(-1)?.[0] as Record<string, any>;

test('lists every model and searches by name or id', async () => {
  const { user } = renderWithClient(<ModelsSettings />);
  expect(await screen.findByText('DeepSeek V4.1')).toBeInTheDocument();
  expect(screen.getByText('Acme Free')).toBeInTheDocument();
  const search = screen.getByRole('searchbox', { name: 'Search models' });
  await user.type(search, 'flash');
  expect(screen.getByText('DeepSeek V4.1 Flash')).toBeInTheDocument();
  expect(screen.queryByText('Acme Free')).not.toBeInTheDocument();
  await user.clear(search);
  await user.type(search, 'zzz');
  expect(screen.getByText(/No model matches "zzz"/)).toBeInTheDocument();
});

test('favoriting a model saves the whole favorites list', async () => {
  const { user } = renderWithClient(<ModelsSettings />);
  await user.click(await screen.findByRole('button', { name: 'Add DeepSeek V4.1 to favorites' }));
  expect(lastPatch()).toEqual({ models: { favorites: [KEY] } });
  expect(
    screen.getByRole('button', { name: 'Remove DeepSeek V4.1 from favorites' }),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('a hidden model stays listed here so it can be shown again', async () => {
  const { user } = renderWithClient(<ModelsSettings />);
  await user.click(
    await screen.findByRole('button', { name: 'Hide DeepSeek V4.1 from the picker' }),
  );
  expect(lastPatch()).toEqual({ models: { hidden: [KEY] } });
  expect(screen.getByText('DeepSeek V4.1')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Show DeepSeek V4.1 in the picker' }));
  expect(lastPatch()).toEqual({ models: { hidden: [] } });
});

test('a model override saves under the model key', async () => {
  const { user } = renderWithClient(<ModelsSettings />);
  await user.click(await screen.findByRole('button', { name: 'Edit details for DeepSeek V4.1' }));
  const dialog = await screen.findByRole('dialog', { name: 'DeepSeek V4.1' });
  const context = within(dialog).getByLabelText('Context length');
  expect(context).toHaveAttribute('placeholder', '1M');
  await user.type(context, '64000');
  const tools = within(dialog).getByRole('group', { name: 'Tool calling' });
  await user.click(within(tools).getByRole('radio', { name: 'Off' }));
  await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));

  const override = lastPatch().models.overrides[KEY];
  expect(override.contextLength).toBe(64000);
  expect(override.supportsTools).toBe(false);
  expect(override.temperature).toBeNull();
  expect(await screen.findByText('Changes saved')).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('a saved override opens filled in, and Reset to catalog removes it', async () => {
  setFakeSettings({ settings: { models: { overrides: { [KEY]: { maxOutputTokens: 4096 } } } } });
  const { user } = renderWithClient(<ModelsSettings />);
  expect(await screen.findByText('Changed by you')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Edit details for DeepSeek V4.1' }));
  const dialog = await screen.findByRole('dialog', { name: 'DeepSeek V4.1' });
  expect(within(dialog).getByLabelText('Max output tokens')).toHaveValue(4096);
  await user.click(within(dialog).getByRole('button', { name: 'Reset to catalog' }));
  expect(lastPatch()).toEqual({ models: { overrides: { [KEY]: null } } });
});

test('a price must be a number from zero up', async () => {
  const { user } = renderWithClient(<ModelsSettings />);
  await user.click(await screen.findByRole('button', { name: 'Edit details for DeepSeek V4.1' }));
  const dialog = await screen.findByRole('dialog', { name: 'DeepSeek V4.1' });
  fireEvent.change(within(dialog).getByLabelText('Input price per 1M tokens'), {
    target: { value: '-3' },
  });
  await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
  expect(within(dialog).getByText(/Use a number from 0 up/)).toBeInTheDocument();
  expect(updateSettings).not.toHaveBeenCalled();
});

test('long lists show a page at a time', async () => {
  const many = Array.from({ length: 95 }, (_, i) =>
    modelInfo({ id: `lab/model-${String(i).padStart(2, '0')}`, name: `Model ${i}` }),
  );
  serve(many);
  const { user } = renderWithClient(<ModelsSettings />);
  await screen.findByText('Model 0');
  expect(screen.queryByText('Model 80')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /Show 40 more/ }));
  expect(screen.getByText('Model 60')).toBeInTheDocument();
});

test('says so when no provider has models', async () => {
  serve([]);
  renderWithClient(<ModelsSettings />);
  expect(await screen.findByText(/No models yet/)).toBeInTheDocument();
});
