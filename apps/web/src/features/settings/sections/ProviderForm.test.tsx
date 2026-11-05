import type { ProviderPreset, ProviderPublic } from '@neotext/shared';
import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { expect, test, vi } from 'vitest';
import { server } from '../../../test/msw';
import { renderWithClient } from '../../../test/renderWithClient';
import { ProviderForm } from './ProviderForm';

const presets: ProviderPreset[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    kind: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyRequired: true,
  },
  {
    id: 'ollama',
    name: 'Ollama',
    kind: 'openai-compatible',
    baseUrl: 'http://localhost:11434/v1',
    keyRequired: false,
  },
  {
    id: 'custom',
    name: 'Custom endpoint',
    kind: 'openai-compatible',
    baseUrl: '',
    keyRequired: false,
  },
  { id: 'searxng', name: 'SearXNG', kind: 'searxng', baseUrl: '', keyRequired: false },
  {
    id: 'brave',
    name: 'Brave Search',
    kind: 'brave',
    baseUrl: 'https://api.search.brave.com',
    keyRequired: true,
  },
];

const saved: ProviderPublic = {
  id: 'prv_1',
  category: 'llm',
  kind: 'openrouter',
  name: 'OpenRouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  hasKey: true,
  keyHint: 'sk-or-v1…6666',
  enabled: true,
  shared: false,
  manualModels: [],
  createdAt: 1,
  updatedAt: 1,
};

function recordBodies(method: 'post' | 'patch') {
  const bodies: Record<string, unknown>[] = [];
  const handler = async ({ request }: { request: Request }) => {
    bodies.push((await request.json()) as Record<string, unknown>);
    return HttpResponse.json({ provider: saved }, { status: method === 'post' ? 201 : 200 });
  };
  server.use(
    method === 'post'
      ? http.post('/api/providers', handler)
      : http.patch('/api/providers/prv_1', handler),
  );
  return bodies;
}

test('a preset fills the name and base url; a custom endpoint needs its own url', async () => {
  const bodies = recordBodies('post');
  const onDone = vi.fn();
  const { user } = renderWithClient(<ProviderForm presets={presets} onDone={onDone} />);

  expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('OpenRouter');
  expect(screen.getByRole('textbox', { name: 'Base URL' })).toHaveValue(
    'https://openrouter.ai/api/v1',
  );

  await user.click(screen.getByRole('combobox', { name: 'Service' }));
  await user.click(await screen.findByRole('option', { name: 'Ollama' }));
  expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Ollama');
  expect(screen.getByRole('textbox', { name: 'Base URL' })).toHaveValue(
    'http://localhost:11434/v1',
  );

  await user.click(screen.getByRole('combobox', { name: 'Service' }));
  await user.click(await screen.findByRole('option', { name: 'Custom endpoint' }));
  expect(screen.getByRole('textbox', { name: 'Base URL' })).toHaveValue('');
  await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Home server');
  await user.click(screen.getByRole('button', { name: 'Add provider' }));

  expect(await screen.findByText(/Enter the base URL of the endpoint/)).toBeInTheDocument();
  expect(bodies).toHaveLength(0);

  await user.type(screen.getByRole('textbox', { name: 'Base URL' }), 'http://10.0.0.5:8000/v1');
  await user.click(screen.getByRole('button', { name: 'Add provider' }));
  await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
  expect(bodies).toEqual([
    { kind: 'openai-compatible', name: 'Home server', baseUrl: 'http://10.0.0.5:8000/v1' },
  ]);
});

test('a new provider sends the key, headers and model ids that were typed', async () => {
  const bodies = recordBodies('post');
  const { user } = renderWithClient(<ProviderForm presets={presets} onDone={vi.fn()} />);
  await user.type(screen.getByLabelText('API key'), 'sk-test-123');
  await user.type(screen.getByRole('textbox', { name: /Extra headers/ }), 'X-Team: lab');
  await user.type(screen.getByRole('textbox', { name: /Model ids/ }), 'a/one{Enter}b/two');
  await user.click(screen.getByRole('button', { name: 'Add provider' }));
  await vi.waitFor(() => expect(bodies).toHaveLength(1));
  expect(bodies[0]).toMatchObject({
    kind: 'openrouter',
    apiKey: 'sk-test-123',
    headers: { 'X-Team': 'lab' },
    manualModels: ['a/one', 'b/two'],
  });
});

test('the stored key is never shown, and an empty field keeps it', async () => {
  const bodies = recordBodies('patch');
  const { user } = renderWithClient(
    <ProviderForm provider={saved} presets={presets} onDone={vi.fn()} />,
  );
  const key = screen.getByLabelText('API key');
  expect(key).toHaveValue('');
  expect(key).toHaveAttribute('placeholder', 'Saved: sk-or-v1…6666');
  expect(key).toHaveAttribute('type', 'password');

  await user.clear(screen.getByRole('textbox', { name: 'Name' }));
  await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Main router');
  await user.click(screen.getByRole('button', { name: 'Save changes' }));
  await vi.waitFor(() => expect(bodies).toHaveLength(1));
  expect(bodies[0]).toEqual({ name: 'Main router' });
  expect(bodies[0]).not.toHaveProperty('apiKey');
});

test('Remove key clears it on save, and typing a new key replaces it', async () => {
  const bodies = recordBodies('patch');
  const { user } = renderWithClient(
    <ProviderForm provider={saved} presets={presets} onDone={vi.fn()} />,
  );
  await user.click(screen.getByRole('button', { name: 'Remove key' }));
  expect(screen.getByText(/The key will be removed when you save/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Save changes' }));
  await vi.waitFor(() => expect(bodies).toHaveLength(1));
  expect(bodies[0]).toEqual({ apiKey: null });

  await user.type(screen.getByLabelText('API key'), 'sk-new-key');
  await user.click(screen.getByRole('button', { name: 'Save changes' }));
  await vi.waitFor(() => expect(bodies).toHaveLength(2));
  expect(bodies[1]).toEqual({ apiKey: 'sk-new-key' });
});

test('test connection reports success and failure', async () => {
  let ok = true;
  server.use(
    http.post('/api/providers/prv_1/test', () =>
      HttpResponse.json(
        ok
          ? { ok: true, latencyMs: 120, modelCount: 451 }
          : {
              ok: false,
              code: 'bad_response',
              message:
                'That address did not answer like an OpenAI-style API. Add /v1 to the base URL.',
            },
      ),
    ),
  );
  const { user } = renderWithClient(
    <ProviderForm provider={saved} presets={presets} onDone={vi.fn()} />,
  );
  await user.click(screen.getByRole('button', { name: 'Test connection' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Connected in 120 ms/));
  expect(screen.getByRole('status')).toHaveTextContent('451 models found');

  ok = false;
  await user.click(screen.getByRole('button', { name: 'Test connection' }));
  expect(await screen.findByText(/Add \/v1 to the base URL/)).toBeInTheDocument();
});

test('a new provider cannot be tested until it is saved', () => {
  renderWithClient(<ProviderForm presets={presets} onDone={vi.fn()} />);
  expect(screen.queryByRole('button', { name: 'Test connection' })).not.toBeInTheDocument();
});

test('a failed save shows the server message and keeps the form', async () => {
  server.use(
    http.patch('/api/providers/prv_1', () =>
      HttpResponse.json(
        {
          error: {
            code: 'validation_failed',
            message: 'That base URL points to a private network.',
          },
        },
        { status: 400 },
      ),
    ),
  );
  const onDone = vi.fn();
  const { user } = renderWithClient(
    <ProviderForm provider={saved} presets={presets} onDone={onDone} />,
  );
  await user.type(screen.getByRole('textbox', { name: 'Name' }), '2');
  await user.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('private network');
  expect(onDone).not.toHaveBeenCalled();
});

test('the model provider form lists only model services, never search ones', async () => {
  const { user } = renderWithClient(<ProviderForm presets={presets} onDone={vi.fn()} />);
  await user.click(screen.getByRole('combobox', { name: 'Service' }));
  const names = (await screen.findAllByRole('option')).map((o) => o.textContent);
  expect(names).toEqual(['OpenRouter', 'Ollama', 'Custom endpoint']);
  expect(screen.queryByRole('option', { name: 'SearXNG' })).not.toBeInTheDocument();
});

test('the search provider form lists only search services and asks for what each needs', async () => {
  const bodies = recordBodies('post');
  const onDone = vi.fn();
  const { user } = renderWithClient(
    <ProviderForm category="search" presets={presets} onDone={onDone} />,
  );
  expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('SearXNG');
  expect(screen.queryByRole('textbox', { name: /Model ids/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole('combobox', { name: 'Service' }));
  const names = (await screen.findAllByRole('option')).map((o) => o.textContent);
  expect(names).toEqual(['SearXNG', 'Brave Search']);
  await user.keyboard('{Escape}');

  await user.click(screen.getByRole('button', { name: 'Add search provider' }));
  expect(await screen.findByText(/address of your SearXNG instance/)).toBeInTheDocument();
  await user.type(screen.getByRole('textbox', { name: 'Base URL' }), 'http://10.0.0.9:8080');
  await user.click(screen.getByRole('button', { name: 'Add search provider' }));
  await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
  expect(bodies).toEqual([{ kind: 'searxng', name: 'SearXNG', baseUrl: 'http://10.0.0.9:8080' }]);
});

test('Brave and Tavily need a key before they are added', async () => {
  const bodies = recordBodies('post');
  const { user } = renderWithClient(
    <ProviderForm category="search" presets={presets} onDone={vi.fn()} />,
  );
  await user.click(screen.getByRole('combobox', { name: 'Service' }));
  await user.click(await screen.findByRole('option', { name: 'Brave Search' }));
  await user.click(screen.getByRole('button', { name: 'Add search provider' }));
  expect(await screen.findByText('Paste the API key for this service.')).toBeInTheDocument();
  expect(bodies).toHaveLength(0);
});
