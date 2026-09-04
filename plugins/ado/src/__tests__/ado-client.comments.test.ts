import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { AdoClient } from '../ado-client';
import type { AdoWorkItemCommentsResponse } from '../types';

vi.mock('axios');

/**
 * The comments endpoint pages. Reading only the first page silently truncated
 * the mirror on any work item with a long comment thread.
 */
describe('getWorkItemComments pagination', () => {
  let get: ReturnType<typeof vi.fn>;

  const page = (
    comments: { id: number; text: string }[],
    continuationToken?: string,
  ): { data: AdoWorkItemCommentsResponse } => ({
    data: {
      totalCount: 3,
      count: comments.length,
      comments: comments as AdoWorkItemCommentsResponse['comments'],
      continuationToken,
    },
  });

  beforeEach(() => {
    get = vi.fn();
    vi.mocked(axios.create).mockReturnValue({ get } as never);
  });

  const client = () =>
    new AdoClient({ organization: 'contoso', project: 'WebApp', pat: 'x' });

  it('follows the continuation token and concatenates every page', async () => {
    get
      .mockResolvedValueOnce(page([{ id: 1, text: 'one' }], 'tok-2'))
      .mockResolvedValueOnce(page([{ id: 2, text: 'two' }], 'tok-3'))
      .mockResolvedValueOnce(page([{ id: 3, text: 'three' }]));

    const comments = await client().getWorkItemComments(42);

    expect(comments.map((c) => c.id)).toEqual([1, 2, 3]);
    expect(get).toHaveBeenCalledTimes(3);
    expect(get.mock.calls[1][0]).toContain('continuationToken=tok-2');
    expect(get.mock.calls[2][0]).toContain('continuationToken=tok-3');
  });

  it('stops after a single page when no token comes back', async () => {
    get.mockResolvedValueOnce(page([{ id: 1, text: 'one' }]));

    const comments = await client().getWorkItemComments(42);

    expect(comments).toHaveLength(1);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0][0]).not.toContain('continuationToken');
  });

  it('url-encodes a token that needs it', async () => {
    get
      .mockResolvedValueOnce(page([{ id: 1, text: 'one' }], 'a b/c+d'))
      .mockResolvedValueOnce(page([{ id: 2, text: 'two' }]));

    await client().getWorkItemComments(42);

    expect(get.mock.calls[1][0]).toContain('continuationToken=a%20b%2Fc%2Bd');
  });

  it('gives up rather than looping when the server always returns a token', async () => {
    get.mockResolvedValue(page([{ id: 9, text: 'loop' }], 'always'));

    const comments = await client().getWorkItemComments(42);

    expect(get.mock.calls.length).toBeLessThanOrEqual(50);
    expect(comments.length).toBe(get.mock.calls.length);
  });
});
