import type { IpcMain } from 'electron';
import { dialog } from 'electron';
import * as fs from 'fs';
import type { Database } from '../database/database';
import { generateCsvContent } from '../reports/csvGenerator';

export { generateCsvContent } from '../reports/csvGenerator';

export function registerReportHandlers(ipcMain: IpcMain, db: Database): void {
  ipcMain.handle('reports:exportCsv', async (_event, start: string, end: string) => {
    const result = await dialog.showSaveDialog({
      title: 'Export Time Report',
      defaultPath: 'time-report.csv',
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });

    if (result.canceled || !result.filePath) return null;

    const csvContent = generateCsvContent(db, start, end);
    fs.writeFileSync(result.filePath, csvContent, 'utf-8');
    return result.filePath;
  });
}
