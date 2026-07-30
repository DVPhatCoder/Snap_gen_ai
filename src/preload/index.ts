import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC } from '../shared/ipc';
import type {
  ApiKeys,
  AppSettings,
  ConnectionTestResult,
  GenerateIdeaInput,
  GenerateJobInput,
  GenerateJobResult,
  JobProgress,
  ScriptDraft,
} from '../shared/types';
import type { ModelOption, VideoFamily } from '../shared/types';

const api = {
  getKeys: (): Promise<ApiKeys> => ipcRenderer.invoke(IPC.getKeys),
  saveKeys: (keys: ApiKeys): Promise<boolean> => ipcRenderer.invoke(IPC.saveKeys, keys),
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.getSettings),
  saveSettings: (settings: AppSettings): Promise<boolean> =>
    ipcRenderer.invoke(IPC.saveSettings, settings),
  getModels: (): Promise<{
    families: { id: VideoFamily; label: string }[];
    models: ModelOption[];
  }> => ipcRenderer.invoke(IPC.getModels),
  testSnapgen: (): Promise<ConnectionTestResult> => ipcRenderer.invoke(IPC.testSnapgen),
  testOpenAI: (): Promise<ConnectionTestResult> => ipcRenderer.invoke(IPC.testOpenAI),
  testElevenLabs: (): Promise<ConnectionTestResult> => ipcRenderer.invoke(IPC.testElevenLabs),
  listVoices: (): Promise<{ voice_id: string; name: string }[]> =>
    ipcRenderer.invoke(IPC.listVoices),
  generateScript: (input: GenerateIdeaInput): Promise<ScriptDraft> =>
    ipcRenderer.invoke(IPC.generateScript, input),
  startGenerate: (input: GenerateJobInput): Promise<GenerateJobResult> =>
    ipcRenderer.invoke(IPC.startGenerate, input),
  onJobProgress: (cb: (p: JobProgress) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, p: JobProgress) => cb(p);
    ipcRenderer.on(IPC.jobProgress, listener);
    return () => ipcRenderer.removeListener(IPC.jobProgress, listener);
  },
  openPath: (target: string): Promise<string> => ipcRenderer.invoke(IPC.openPath, target),
  showItemInFolder: (target: string): Promise<void> =>
    ipcRenderer.invoke(IPC.showItemInFolder, target),
  exportVideo: (sourcePath: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC.exportVideo, sourcePath),
};

contextBridge.exposeInMainWorld('studio', api);

export type StudioApi = typeof api;
