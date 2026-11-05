import { fireEvent, screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { beforeEach, expect, test, vi } from 'vitest';
import { resetFakeSettings, setFakeSettings, updateSettings } from '../../../test/fake-settings';
import { catalog, modelsResponse } from '../../../test/model-fixtures';
import { server } from '../../../test/msw';
import { renderWithClient } from '../../../test/renderWithClient';
import { GeneralSettings } from './GeneralSettings';

vi.mock('../../../state/settings', () => import('../../../test/fake-settings'));

beforeEach(() => {
  resetFakeSettings();
  server.use(http.get('/api/models', () => HttpResponse.json(modelsResponse(catalog))));
});

test('choices save as they are picked', async () => {
  const { user } = renderWithClient(<GeneralSettings />);
  await user.click(screen.getByRole('radio', { name: 'Bahasa Indonesia' }));
  expect(updateSettings).toHaveBeenLastCalledWith({ locale: 'id' });
  await user.click(screen.getByRole('radio', { name: 'Ctrl or Cmd with Enter' }));
  expect(updateSettings).toHaveBeenLastCalledWith({ chat: { sendKey: 'mod-enter' } });
  await user.click(screen.getByRole('switch', { name: 'Put today’s date in the system prompt' }));
  expect(updateSettings).toHaveBeenLastCalledWith({ chat: { includeDate: false } });
});

test('the system prompt saves when you leave the box, as one change', async () => {
  const { user } = renderWithClient(<GeneralSettings />);
  const box = screen.getByRole('textbox', { name: 'Default system prompt' });
  await user.type(box, 'Answer briefly.');
  expect(updateSettings).not.toHaveBeenCalled();
  await user.tab();
  expect(updateSettings).toHaveBeenCalledTimes(1);
  expect(updateSettings).toHaveBeenLastCalledWith({
    chat: { defaultSystemPrompt: 'Answer briefly.' },
  });
  expect(box).toHaveAttribute('maxlength', '20000');
});

test('temperature and max output are blank by default, and blank saves as null', async () => {
  setFakeSettings({ settings: { chat: { temperature: 0.7, maxOutputTokens: 2048 } } });
  const { user } = renderWithClient(<GeneralSettings />);
  const temp = screen.getByLabelText('Temperature');
  const max = screen.getByLabelText('Max output tokens');
  expect(temp).toHaveValue(0.7);
  expect(max).toHaveValue(2048);
  await user.clear(temp);
  await user.tab();
  expect(updateSettings).toHaveBeenLastCalledWith({ chat: { temperature: null } });
  await user.clear(max);
  await user.type(max, '512');
  await user.tab();
  expect(updateSettings).toHaveBeenLastCalledWith({ chat: { maxOutputTokens: 512 } });
});

test('a temperature outside 0 to 2 is refused with a reason and not saved', async () => {
  const { user } = renderWithClient(<GeneralSettings />);
  const temp = screen.getByLabelText('Temperature');
  await user.click(temp);
  fireEvent.change(temp, { target: { value: '5' } });
  await user.tab();
  expect(screen.getByText('Use a number from 0 to 2.')).toBeInTheDocument();
  expect(updateSettings).not.toHaveBeenCalled();
});

test('the default model shows its name and can be cleared', async () => {
  setFakeSettings({
    settings: {
      chat: { defaultModel: { providerId: 'prv_1', modelId: 'deepseek/deepseek-v4.1' } },
    },
  });
  const { user } = renderWithClient(<GeneralSettings />);
  expect(
    await screen.findByRole('button', { name: /Default model.*DeepSeek V4.1/ }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Clear default model' }));
  expect(updateSettings).toHaveBeenLastCalledWith({ chat: { defaultModel: null } });
});

test('the reasoning default is a select', async () => {
  const { user } = renderWithClient(<GeneralSettings />);
  await user.click(screen.getByRole('combobox', { name: 'Default reasoning' }));
  await user.click(await screen.findByRole('option', { name: 'High' }));
  expect(updateSettings).toHaveBeenLastCalledWith({ chat: { reasoningEffort: 'high' } });
});
