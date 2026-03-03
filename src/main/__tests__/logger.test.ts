import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Logger', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    vi.resetModules();
  });

  it('log.info always writes', async () => {
    const { log } = await import('../logger');
    log.info('test message');
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('[INFO]'));
  });

  it('log.warn always writes', async () => {
    const { log } = await import('../logger');
    log.warn('warning message');
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('[WARN]'));
  });

  it('log.error always writes', async () => {
    const { log } = await import('../logger');
    log.error('error message');
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('[ERROR]'));
  });

  it('log.debug is no-op when --debug not set', async () => {
    const { log } = await import('../logger');
    log.debug('debug message');
    // If --debug is not in process.argv, debug should not write
    if (!process.argv.includes('--debug')) {
      expect(stderrSpy).not.toHaveBeenCalled();
    }
  });
});
