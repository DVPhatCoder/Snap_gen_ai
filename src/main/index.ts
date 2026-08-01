import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import { IPC } from '../shared/ipc';
import { IMAGE_FAMILIES, IMAGE_MODELS, VIDEO_FAMILIES, VIDEO_MODELS } from '../shared/models';
import type {
  ApiKeys,
  AppSettings,
  CreateProjectInput,
  ExportMediaRequest,
  ExportMediaResult,
  GenerateIdeaInput,
  GenerateJobInput,
  LoadMoreUsageHistoryRequest,
  ProjectDraft,
} from '../shared/types';
import { getKeys, getSettings, saveKeys, saveSettings } from './store';
import { testAccount } from './services/snapgen';
import { generateScript, testOpenAI } from './services/openai';
import { remuxProject, runGenerateJob } from './services/pipeline';
import {
  clearElevenLabsSession,
  getElevenLabsSessionStatus,
  installElevenLabsApiKeyCapture,
  onElevenLabsSessionChange,
  openElevenLabsApiKeysPage,
  openElevenLabsLogin,
  saveElevenLabsApiKeyManually,
  testElevenLabsSession,
} from './services/elevenlabs-auth';
import { listElevenLabsVoices, previewElevenLabsVoice } from './services/elevenlabs-tts';
import { getUsageSnapshot, getUsageHistory, loadMoreUsageHistory } from './services/usage';
import {
  installLocalMediaProtocol,
  registerLocalMediaScheme,
} from './services/local-media';
import { beginJob, endJob, getActiveJob, isJobActive } from './job-state';
import type { JobFinishedEvent } from '../shared/types';
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  renameProject,
  saveProjectDraft,
} from './services/projects';

// Required before app ready so renderer can load project images/videos.
registerLocalMediaScheme();

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    title: 'SnapGen AI Studio',
    backgroundColor: '#0b0c0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
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
  // Forge rebuilds main without always restarting Electron; clear first so
  // handlers can be re-registered safely after `rs`.
  for (const channel of Object.values(IPC)) {
    ipcMain.removeHandler(channel);
  }

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
  ipcMain.handle(IPC.getModels, () => ({
    videoFamilies: VIDEO_FAMILIES,
    imageFamilies: IMAGE_FAMILIES,
    videoModels: VIDEO_MODELS,
    imageModels: IMAGE_MODELS,
    families: VIDEO_FAMILIES,
    models: [...VIDEO_MODELS, ...IMAGE_MODELS],
  }));

  ipcMain.handle(IPC.testSnapgen, async () => testAccount(getKeys().snapgenApiKey));
  ipcMain.handle(IPC.testOpenAI, async () => testOpenAI(getKeys().openaiApiKey));
  ipcMain.handle(IPC.testElevenLabs, async () => testElevenLabsSession());
  ipcMain.handle(IPC.getUsageQuotas, async () => getUsageSnapshot());
  ipcMain.handle(IPC.getUsageHistory, async () => getUsageHistory());
  ipcMain.handle(IPC.loadMoreUsageHistory, async (_e, request: LoadMoreUsageHistoryRequest) =>
    loadMoreUsageHistory(request)
  );
  ipcMain.handle(IPC.elevenLabsOpenLogin, async () => openElevenLabsLogin(mainWindow));
  ipcMain.handle(IPC.elevenLabsOpenApiKeys, async () => openElevenLabsApiKeysPage(mainWindow));
  ipcMain.handle(IPC.elevenLabsSaveApiKey, async (_e, apiKey: string) =>
    saveElevenLabsApiKeyManually(apiKey)
  );
  ipcMain.handle(IPC.elevenLabsGetSession, async () => getElevenLabsSessionStatus());
  ipcMain.handle(IPC.elevenLabsClearSession, async () => clearElevenLabsSession());
  let listVoicesInFlight: Promise<unknown> | null = null;
  ipcMain.handle(IPC.elevenLabsListVoices, async () => {
    if (listVoicesInFlight) return listVoicesInFlight;
    listVoicesInFlight = listElevenLabsVoices().finally(() => {
      listVoicesInFlight = null;
    });
    return listVoicesInFlight;
  });
  ipcMain.handle(
    IPC.elevenLabsPreviewVoice,
    async (_e, input: { voiceId: string; modelId?: string; language?: string }) =>
      previewElevenLabsVoice(input)
  );

  onElevenLabsSessionChange((status) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.elevenLabsSessionChanged, status);
      }
    }
  });

  ipcMain.handle(IPC.generateScript, async (_e, input: GenerateIdeaInput) => {
    const keys = getKeys();
    const settings = getSettings();
    if (!keys.openaiApiKey) throw new Error('Thiếu OpenAI API key.');
    const chatModel =
      (input.openaiChatModel || '').trim() || settings.openaiModel || 'gpt-4o-mini';
    return generateScript(keys.openaiApiKey, chatModel, input);
  });

  ipcMain.handle(IPC.startGenerate, async (_e, input: GenerateJobInput) => {
    if (isJobActive()) throw new Error('Đang có job chạy. Đợi hoàn tất.');
    beginJob({
      projectId: input.projectId,
      projectName: input.projectName,
      kind: 'generate',
    });
    try {
      const result = await runGenerateJob(input);
      const finished: JobFinishedEvent = {
        projectId: result.projectId,
        kind: 'generate',
        ok: true,
        result,
      };
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(IPC.jobFinished, finished);
      }
      return result;
    } catch (err) {
      const finished: JobFinishedEvent = {
        projectId: input.projectId || null,
        kind: 'generate',
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(IPC.jobFinished, finished);
      }
      throw err;
    } finally {
      endJob();
    }
  });

  ipcMain.handle(IPC.remuxProject, async (_e, projectId: string) => {
    if (isJobActive()) throw new Error('Đang có job chạy. Đợi hoàn tất.');
    const detail = getProject(projectId);
    beginJob({
      projectId,
      projectName: detail.meta.name,
      kind: 'remux',
    });
    try {
      const result = await remuxProject(projectId);
      const finished: JobFinishedEvent = {
        projectId,
        kind: 'remux',
        ok: true,
        result,
      };
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(IPC.jobFinished, finished);
      }
      return result;
    } catch (err) {
      const finished: JobFinishedEvent = {
        projectId,
        kind: 'remux',
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(IPC.jobFinished, finished);
      }
      throw err;
    } finally {
      endJob();
    }
  });

  ipcMain.handle(IPC.getActiveJob, () => getActiveJob());
  ipcMain.handle(IPC.listProjects, () => listProjects());
  ipcMain.handle(IPC.getProject, (_e, id: string) => getProject(id));
  ipcMain.handle(IPC.createProject, (_e, input: CreateProjectInput) => createProject(input));
  ipcMain.handle(IPC.renameProject, (_e, id: string, name: string) => renameProject(id, name));
  ipcMain.handle(IPC.deleteProject, (_e, id: string) => deleteProject(id));
  ipcMain.handle(
    IPC.saveProjectDraft,
    (_e, id: string, draft: ProjectDraft, patch?: { name?: string }) =>
      saveProjectDraft(id, draft, patch)
  );

  ipcMain.handle(IPC.openPath, async (_e, target: string) => shell.openPath(target));
  ipcMain.handle(IPC.showItemInFolder, (_e, target: string) => {
    shell.showItemInFolder(target);
  });

  ipcMain.handle(
    IPC.exportVideo,
    async (_e, sourcePath: string, suggestedName?: string) => {
      const result = await exportFinalFile(sourcePath, suggestedName);
      return result?.path ?? null;
    }
  );

  ipcMain.handle(
    IPC.exportMedia,
    async (_e, request: ExportMediaRequest): Promise<ExportMediaResult | null> => {
      if (request.mode === 'final') {
        if (!request.final?.sourcePath) {
          throw new Error('Thiếu đường dẫn video final.');
        }
        return exportFinalFile(request.final.sourcePath, request.final.suggestedName);
      }

      const scenes = request.scenes ?? [];
      if (!scenes.length) {
        throw new Error('Chưa chọn phân cảnh nào để lưu.');
      }

      const settings = getSettings();
      const pick = await dialog.showOpenDialog(mainWindow!, {
        title: 'Chọn thư mục lưu các phân cảnh',
        defaultPath: settings.lastExportDir || app.getPath('documents'),
        properties: ['openDirectory', 'createDirectory'],
      });
      if (pick.canceled || !pick.filePaths[0]) return null;

      const fs = await import('node:fs/promises');
      const destDir = pick.filePaths[0];
      const written: string[] = [];
      for (const item of scenes) {
        const dest = path.join(destDir, sanitizeFileName(item.fileName));
        await fs.copyFile(item.sourcePath, dest);
        written.push(dest);
      }
      saveSettings({ ...settings, lastExportDir: destDir });
      return { mode: 'scenes', path: destDir, files: written };
    }
  );
}

function sanitizeFileName(name: string): string {
  const cleaned =
    name
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
      .replace(/\s+/g, ' ')
      .trim() || 'export';
  return cleaned;
}

async function exportFinalFile(
  sourcePath: string,
  suggestedName?: string
): Promise<ExportMediaResult | null> {
  const settings = getSettings();
  const safeName = sanitizeFileName(suggestedName || 'final');
  const defaultPath = settings.lastExportDir
    ? path.join(settings.lastExportDir, `${safeName}.mp4`)
    : path.join(app.getPath('documents'), `${safeName}.mp4`);

  const result = await dialog.showSaveDialog(mainWindow!, {
    title: 'Chọn nơi lưu video final',
    defaultPath,
    filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
  });
  if (result.canceled || !result.filePath) return null;

  const fs = await import('node:fs/promises');
  await fs.copyFile(sourcePath, result.filePath);
  saveSettings({
    ...settings,
    lastExportDir: path.dirname(result.filePath),
  });
  return { mode: 'final', path: result.filePath };
}

app.whenReady().then(() => {
  installLocalMediaProtocol();
  installElevenLabsApiKeyCapture();
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
