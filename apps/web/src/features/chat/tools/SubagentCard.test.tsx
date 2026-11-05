import type { SubagentRun, ToolCallPart } from '@neotext/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { SubagentCard } from './SubagentCard';

function run(over: Partial<SubagentRun> & { id: string }): SubagentRun {
  return {
    title: 'Task',
    agentName: null,
    status: 'running',
    startedAt: Date.now() - 3_000,
    finishedAt: null,
    report: null,
    costUsd: null,
    ...over,
  };
}

function part(agents: SubagentRun[]): ToolCallPart & { agents: SubagentRun[] } {
  return {
    type: 'tool_call',
    id: 'call_1',
    name: 'delegate_tasks',
    source: 'app',
    args: '{}',
    status: 'running',
    result: null,
    startedAt: 1_000,
    finishedAt: null,
    agents,
  };
}

const running = [
  run({ id: 'r1', title: 'Survey the API', agentName: 'Agent-Backend' }),
  run({ id: 'r2', title: 'Check the docs', status: 'ok', finishedAt: Date.now(), costUsd: 0.001 }),
  run({ id: 'r3', title: 'Read the tests' }),
];

test('shows a row per task while they run, then folds into one line when all are done', async () => {
  const user = userEvent.setup();
  const { rerender } = render(<SubagentCard part={part(running)} />);
  expect(screen.getByRole('button', { name: /Sub-agents.*3 tasks/ })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
  expect(screen.getByText('1 of 3 done')).toBeInTheDocument();
  const rows = screen.getAllByRole('listitem');
  expect(rows).toHaveLength(3);
  expect(within(rows[0] as HTMLElement).getByText('Agent-Backend')).toBeInTheDocument();
  expect(within(rows[0] as HTMLElement).getByText('Running')).toBeInTheDocument();
  expect(within(rows[1] as HTMLElement).getByText('Done')).toBeInTheDocument();

  const done = [
    run({ id: 'r1', status: 'ok', startedAt: 0, finishedAt: 14_000, costUsd: 0.001 }),
    run({ id: 'r2', status: 'ok', startedAt: 0, finishedAt: 9_000, costUsd: 0.001 }),
    run({ id: 'r3', status: 'ok', startedAt: 1_000, finishedAt: 12_000, costUsd: 0.001 }),
  ];
  rerender(<SubagentCard part={part(done)} />);
  const summary = screen.getByRole('button', { name: /3 sub-agents finished/ });
  expect(summary).toHaveAttribute('aria-expanded', 'false');
  expect(summary).toHaveTextContent('14 s');
  expect(summary).toHaveTextContent('$0.003');
  expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();

  await user.click(summary);
  expect(screen.getAllByRole('listitem')).toHaveLength(3);
});

test('a row opens to its report', async () => {
  const user = userEvent.setup();
  render(
    <SubagentCard
      part={part([
        run({
          id: 'r1',
          title: 'Survey the API',
          status: 'ok',
          finishedAt: Date.now(),
          report: 'The API has **four** endpoints.',
        }),
        run({ id: 'r2', title: 'Check the docs' }),
      ])}
    />,
  );
  const row = screen.getByRole('button', { name: /Survey the API/ });
  expect(row).toHaveAttribute('aria-expanded', 'false');
  await user.click(row);
  expect(row).toHaveAttribute('aria-expanded', 'true');
  const report = screen.getByRole('region', { name: 'Report from Survey the API' });
  expect(within(report).getByText('four')).toBeInTheDocument();
});

test('rows still running when the answer ended show as stopped', () => {
  render(<SubagentCard part={part([run({ id: 'r1', startedAt: 0 })])} ended />);
  expect(screen.getByRole('button', { name: /1 sub-agent finished/ })).toHaveTextContent(
    '1 stopped',
  );
});

test('an open row lists its tool calls above the report', async () => {
  const user = userEvent.setup();
  const done = {
    ...run({
      id: 'r9',
      title: 'Look it up',
      status: 'ok',
      finishedAt: Date.now(),
      report: 'Done.',
    }),
    toolCalls: [
      { name: 'web_search', detail: 'query one' },
      { name: 'fetch_url', detail: 'https://example.com/a' },
    ],
  };
  render(<SubagentCard part={part([done])} />);
  await user.click(screen.getByRole('button', { name: /finished/ }));
  await user.click(screen.getByRole('button', { name: /Look it up/ }));
  expect(screen.getByText('query one')).toBeInTheDocument();
  expect(screen.getByText('https://example.com/a')).toBeInTheDocument();
});
