import type { IpcMain } from 'electron';
import { dialog } from 'electron';
import * as fs from 'fs';
import type { Database } from '../database/database';
import type { ImportPreviewItem } from '../../shared/types';
import { parseImportContent, executeImport } from '../import/importExecutor';
import { log } from '../logger';

export { parseImportContent, executeImport } from '../import/importExecutor';

export function registerImportHandlers(ipcMain: IpcMain, db: Database): void {
  ipcMain.handle('import:selectAndParse', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import Tasks from Markdown',
      filters: [{ name: 'Markdown', extensions: ['md', 'txt'] }],
      properties: ['openFile'],
    });

    if (result.canceled || !result.filePaths.length) return null;

    const filePath = result.filePaths[0];
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch (err) {
      log.error('import:selectAndParse readFile failed:', String(err));
      throw new Error(`Failed to read file: ${err instanceof Error ? err.message : String(err)}`);
    }
    const { items, errors } = parseImportContent(db, content);

    return { items, errors, filePath };
  });

  ipcMain.handle('import:execute', (_event, items: ImportPreviewItem[]) => executeImport(db, items));
}
