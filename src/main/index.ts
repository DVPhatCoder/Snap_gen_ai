import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import { IPC } from '../shared/ipc';
import { VIDEO_FAMILIES, VIDEO_MODELS } from '../shared/models';
import type {
  ApiKeys,
  AppSettings,
  GenerateIdeaInput,
  GenerateJobInput,
} from '../shared/types';
import { getKeys, getSettings, saveKeys, saveSettings } from './store';
import { testAccount } from './services/snapgen';
import { generateScript, testOpenAI } from './services/openai';
import { listVoices, testElevenLabs } from './services/elevenlabs';
import { runGenerateJob } from './services/pipeline';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

let mainWindow: BrowserWindow | null = null;
let jobRunning = false;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    title: 'SnapGen AI Studio',
    backgroundColor: '#0f1419',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Cho phép preview file:// video local trong renderer
      webSecurity: false,
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
}

function registerIpc(): void {
  ipcMain.handle(IPC.getKeys, () => getKeys());
  ipcMain.handle(IPC.saveKeys, (_e, keys: ApiKeys) => {
    saveKeys(keys);
    return true;
  });
  ipcMain.handle(IPC.getSettings, () => getSettings());
  ipcMain.handle(IPC.saveSettings, (_e, settings: AppSettings) => {
    saveSettings(settings);
    return true;
  });
  ipcMain.handle(IPC.getModels, () => ({ families: VIDEO_FAMILIES, models: VIDEO_MODELS }));

  ipcMain.handle(IPC.testSnapgen, async () => testAccount(getKeys().snapgenApiKey));
  ipcMain.handle(IPC.testOpenAI, async () => testOpenAI(getKeys().openaiApiKey));
  ipcMain.handle(IPC.testElevenLabs, async () => testElevenLabs(getKeys().elevenLabsApiKey));

  ipcMain.handle(IPC.listVoices, async () => {
    const key = getKeys().elevenLabsApiKey;
    if (!key) return [];
    return listVoices(key);
  });

  ipcMain.handle(IPC.generateScript, async (_e, input: GenerateIdeaInput) => {
    const keys = getKeys();
    const settings = getSettings();
    if (!keys.openaiApiKey) throw new Error('Thiếu OpenAI API key.');
    return generateScript(keys.openaiApiKey, settings.openaiModel, input);
  });

  ipcMain.handle(IPC.startGenerate, async (_e, input: GenerateJobInput) => {
    if (jobRunning) throw new Error('Đang có job chạy. Đợi hoàn tất.');
    jobRunning = true;
    try {
      return await runGenerateJob(input);
    } finally {
      jobRunning = false;
    }
  });

  ipcMain.handle(IPC.openPath, async (_e, target: string) => shell.openPath(target));
  ipcMain.handle(IPC.showItemInFolder, (_e, target: string) => {
    shell.showItemInFolder(target);
  });

  ipcMain.handle(IPC.exportVideo, async (_e, sourcePath: string) => {
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: 'Xuất video',
      defaultPath: 'final.mp4',
      filters: [{ name: 'MP4', extensions: ['mp4'] }],
    });
    if (result.canceled || !result.filePath) return null;
    const fs = await import('node:fs/promises');
    await fs.copyFile(sourcePath, result.filePath);
    return result.filePath;
  });
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
