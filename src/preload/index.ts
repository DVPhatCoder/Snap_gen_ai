import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC } from '../shared/ipc';
import type {
  ApiKeys,
  AppSettings,
  ConnectionTestResult,
  CreateProjectInput,
  ElevenLabsSessionStatus,
  ElevenLabsVoice,
  ExportMediaRequest,
  ExportMediaResult,
  GenerateIdeaInput,
  GenerateJobInput,
  GenerateJobResult,
  ImageFamily,
  JobProgress,
  ModelOption,
  ProjectDetail,
  ProjectDraft,
  ProjectMeta,
  ScriptDraft,
  VideoFamily,
} from '../shared/types';

const api = {
  getKeys: (): Promise<ApiKeys> => ipcRenderer.invoke(IPC.getKeys),
  saveKeys: (keys: ApiKeys): Promise<boolean> => ipcRenderer.invoke(IPC.saveKeys, keys),
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.getSettings),
  saveSettings: (settings: AppSettings): Promise<boolean> =>
    ipcRenderer.invoke(IPC.saveSettings, settings),
  getModels: (): Promise<{
    videoFamilies: { id: VideoFamily; label: string }[];
    imageFamilies: { id: ImageFamily; label: string }[];
    videoModels: ModelOption[];
    imageModels: ModelOption[];
    families: { id: VideoFamily; label: string }[];
    models: ModelOption[];
  }> => ipcRenderer.invoke(IPC.getModels),
  testSnapgen: (): Promise<ConnectionTestResult> => ipcRenderer.invoke(IPC.testSnapgen),
  testOpenAI: (): Promise<ConnectionTestResult> => ipcRenderer.invoke(IPC.testOpenAI),
  testElevenLabs: (): Promise<ConnectionTestResult> => ipcRenderer.invoke(IPC.testElevenLabs),
  openElevenLabsLogin: (): Promise<ElevenLabsSessionStatus> =>
    ipcRenderer.invoke(IPC.elevenLabsOpenLogin),
  openElevenLabsApiKeys: (): Promise<ElevenLabsSessionStatus> =>
    ipcRenderer.invoke(IPC.elevenLabsOpenApiKeys),
  saveElevenLabsApiKey: (apiKey: string): Promise<ElevenLabsSessionStatus> =>
    ipcRenderer.invoke(IPC.elevenLabsSaveApiKey, apiKey),
  getElevenLabsSession: (): Promise<ElevenLabsSessionStatus> =>
    ipcRenderer.invoke(IPC.elevenLabsGetSession),
  clearElevenLabsSession: (): Promise<ElevenLabsSessionStatus> =>
    ipcRenderer.invoke(IPC.elevenLabsClearSession),
  listElevenLabsVoices: (): Promise<ElevenLabsVoice[]> =>
    ipcRenderer.invoke(IPC.elevenLabsListVoices),
  onElevenLabsSessionChange: (cb: (status: ElevenLabsSessionStatus) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, status: ElevenLabsSessionStatus) => cb(status);
    ipcRenderer.on(IPC.elevenLabsSessionChanged, listener);
    return () => ipcRenderer.removeListener(IPC.elevenLabsSessionChanged, listener);
  },
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
  exportVideo: (sourcePath: string, suggestedName?: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC.exportVideo, sourcePath, suggestedName),
  exportMedia: (request: ExportMediaRequest): Promise<ExportMediaResult | null> =>
    ipcRenderer.invoke(IPC.exportMedia, request),
  remuxProject: (projectId: string): Promise<GenerateJobResult> =>
    ipcRenderer.invoke(IPC.remuxProject, projectId),

  listProjects: (): Promise<ProjectMeta[]> => ipcRenderer.invoke(IPC.listProjects),
  getProject: (id: string): Promise<ProjectDetail> => ipcRenderer.invoke(IPC.getProject, id),
  createProject: (input: CreateProjectInput): Promise<ProjectMeta> =>
    ipcRenderer.invoke(IPC.createProject, input),
  renameProject: (id: string, name: string): Promise<ProjectMeta> =>
    ipcRenderer.invoke(IPC.renameProject, id, name),
  deleteProject: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC.deleteProject, id),
  saveProjectDraft: (
    id: string,
    draft: ProjectDraft,
    patch?: { name?: string }
  ): Promise<ProjectMeta> => ipcRenderer.invoke(IPC.saveProjectDraft, id, draft, patch),
};

contextBridge.exposeInMainWorld('studio', api);

export type StudioApi = typeof api;
