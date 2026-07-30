import fs from 'node:fs';
import path from 'node:path';
import { getProjectsRoot } from '../store';
import {
  mediaExtFor,
  resolveSceneMedia,
  sceneMediaDir,
  sceneMediaTarget,
} from './scene-media';
import type {
  CreateProjectInput,
  MediaKind,
  ProjectDetail,
  ProjectDraft,
  ProjectMeta,
  ProjectStatus,
  ScriptDraft,
  VideoFamily,
  ImageFamily,
} from '../../shared/types';

const META_FILE = 'meta.json';
const DRAFT_FILE = 'draft.json';

function nowIso(): string {
  return new Date().toISOString();
}

function slugify(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'project'
  );
}

function projectDir(id: string): string {
  return path.join(getProjectsRoot(), id);
}

function metaPath(id: string): string {
  return path.join(projectDir(id), META_FILE);
}

function draftPath(id: string): string {
  return path.join(projectDir(id), DRAFT_FILE);
}

function readMeta(id: string): ProjectMeta | null {
  const p = metaPath(id);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as ProjectMeta;
  } catch {
    return null;
  }
}

function writeMeta(meta: ProjectMeta): void {
  const dir = projectDir(meta.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(metaPath(meta.id), JSON.stringify(meta, null, 2), 'utf8');
}

function readDraft(id: string): ProjectDraft | null {
  const p = draftPath(id);
  if (!fs.existsSync(p)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as Partial<ProjectDraft>;
    return {
      brief: raw.brief ?? '',
      language: raw.language ?? 'Tiếng Việt',
      sceneCount: raw.sceneCount ?? 3,
      family: raw.family ?? 'veo',
      model: raw.model ?? 'veo-3.1',
      aspectRatio: raw.aspectRatio ?? '16:9',
      resolution: raw.resolution ?? '720p',
      mode: raw.mode,
      script: raw.script ?? null,
      mediaKind: raw.mediaKind ?? 'video',
      stylePrompt: raw.stylePrompt ?? '',
    };
  } catch {
    return null;
  }
}

function writeDraft(id: string, draft: ProjectDraft): void {
  fs.mkdirSync(projectDir(id), { recursive: true });
  fs.writeFileSync(draftPath(id), JSON.stringify(draft, null, 2), 'utf8');
}

function uniqueId(name: string): string {
  const base = `${Date.now()}-${slugify(name)}`;
  if (!fs.existsSync(projectDir(base))) return base;
  return `${base}-${Math.floor(Math.random() * 1000)}`;
}

export function listProjects(): ProjectMeta[] {
  const root = getProjectsRoot();
  if (!fs.existsSync(root)) return [];

  const items: ProjectMeta[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    let meta = readMeta(entry.name);
    if (!meta) {
      const hasVideo = fs.existsSync(path.join(root, entry.name, 'final.mp4'));
      meta = {
        id: entry.name,
        name: entry.name,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        status: hasVideo ? 'ready' : 'draft',
        hasVideo,
      };
      writeMeta(meta);
    } else {
      meta.hasVideo = fs.existsSync(path.join(root, entry.name, 'final.mp4'));
    }
    items.push(meta);
  }

  return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getProject(id: string): ProjectDetail {
  const meta = readMeta(id);
  if (!meta) throw new Error(`Không tìm thấy dự án: ${id}`);

  const dir = projectDir(id);
  const videoPath = path.join(dir, 'final.mp4');
  const srtPath = path.join(dir, 'subs.srt');
  const audioPath = path.join(dir, 'narration.mp3');
  const draft = readDraft(id);
  const mediaKind = draft?.mediaKind ?? 'video';
  const mediaDir = sceneMediaDir(dir, mediaKind);
  const extension = mediaExtFor(mediaKind);
  const resolved = draft?.script ? resolveSceneMedia(dir, draft.script, mediaKind) : [];
  const sceneMedia =
    draft?.script?.scenes.map((scene, index) => {
      const found = resolved[index] ?? null;
      return {
        sceneId: scene.id,
        sceneIndex: index,
        path: found ?? sceneMediaTarget(mediaDir, scene.id, extension),
        kind: mediaKind,
        exists: Boolean(found),
      };
    }) ?? [];

  return {
    meta: {
      ...meta,
      hasVideo: fs.existsSync(videoPath),
    },
    draft,
    videoPath: fs.existsSync(videoPath) ? videoPath : null,
    srtPath: fs.existsSync(srtPath) ? srtPath : null,
    audioPath: fs.existsSync(audioPath) ? audioPath : null,
    sceneMedia,
    projectDir: dir,
  };
}

export function createProject(input: CreateProjectInput): ProjectMeta {
  const name = input.name.trim();
  if (!name) throw new Error('Tên dự án không được để trống.');

  const id = uniqueId(name);
  const ts = nowIso();
  const mediaKind: MediaKind = input.mediaKind ?? 'video';
  const meta: ProjectMeta = {
    id,
    name,
    createdAt: ts,
    updatedAt: ts,
    status: 'draft',
    brief: input.brief ?? '',
    language: input.language ?? 'Tiếng Việt',
    family: input.family ?? (mediaKind === 'image' ? 'gpt-image' : 'veo'),
    model: input.model ?? (mediaKind === 'image' ? 'gpt-image-2' : 'veo-3.1'),
    aspectRatio: input.aspectRatio ?? '16:9',
    resolution: input.resolution ?? (mediaKind === 'image' ? '2k' : '720p'),
    mode: input.mode,
    sceneCount: input.sceneCount ?? 3,
    hasVideo: false,
    mediaKind,
    stylePrompt: input.stylePrompt ?? '',
  };

  writeMeta(meta);
  writeDraft(id, {
    brief: meta.brief ?? '',
    language: meta.language ?? 'Tiếng Việt',
    sceneCount: meta.sceneCount ?? 3,
    family: (meta.family ?? 'veo') as VideoFamily | ImageFamily,
    model: meta.model ?? 'veo-3.1',
    aspectRatio: meta.aspectRatio ?? '16:9',
    resolution: meta.resolution ?? '720p',
    mode: meta.mode,
    script: null,
    mediaKind,
    stylePrompt: meta.stylePrompt ?? '',
  });

  return meta;
}

export function renameProject(id: string, name: string): ProjectMeta {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Tên dự án không được để trống.');
  const meta = readMeta(id);
  if (!meta) throw new Error(`Không tìm thấy dự án: ${id}`);
  meta.name = trimmed;
  meta.updatedAt = nowIso();
  writeMeta(meta);
  return meta;
}

export function deleteProject(id: string): boolean {
  const dir = projectDir(id);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

export function saveProjectDraft(
  id: string,
  draft: ProjectDraft,
  patch?: Partial<Pick<ProjectMeta, 'name' | 'status' | 'lastError'>>
): ProjectMeta {
  let meta = readMeta(id);
  if (!meta) throw new Error(`Không tìm thấy dự án: ${id}`);

  writeDraft(id, draft);
  meta = {
    ...meta,
    brief: draft.brief,
    language: draft.language,
    sceneCount: draft.sceneCount,
    family: draft.family,
    model: draft.model,
    aspectRatio: draft.aspectRatio,
    resolution: draft.resolution,
    mode: draft.mode,
    mediaKind: draft.mediaKind,
    stylePrompt: draft.stylePrompt,
    updatedAt: nowIso(),
    ...(patch?.name ? { name: patch.name.trim() || meta.name } : {}),
    ...(patch?.status ? { status: patch.status } : {}),
    ...(patch?.lastError !== undefined ? { lastError: patch.lastError } : {}),
  };
  writeMeta(meta);
  return meta;
}

export function ensureProject(options: {
  projectId?: string;
  projectName?: string;
  brief?: string;
  language?: string;
  family: VideoFamily | ImageFamily;
  model: string;
  aspectRatio: string;
  resolution: string;
  mode?: string;
  script: ScriptDraft;
  mediaKind?: MediaKind;
  stylePrompt?: string;
}): ProjectMeta {
  if (options.projectId) {
    const existing = readMeta(options.projectId);
    if (existing) {
      if (options.projectName?.trim()) {
        existing.name = options.projectName.trim();
      }
      existing.updatedAt = nowIso();
      existing.status = 'generating';
      existing.brief = options.brief ?? existing.brief;
      existing.language = options.language ?? existing.language;
      existing.family = options.family;
      existing.model = options.model;
      existing.aspectRatio = options.aspectRatio;
      existing.resolution = options.resolution;
      existing.mode = options.mode;
      existing.sceneCount = options.script.scenes.length;
      existing.mediaKind = options.mediaKind ?? existing.mediaKind ?? 'video';
      existing.stylePrompt = options.stylePrompt ?? existing.stylePrompt ?? '';
      writeMeta(existing);
      writeDraft(options.projectId, {
        brief: existing.brief ?? '',
        language: existing.language ?? 'Tiếng Việt',
        sceneCount: options.script.scenes.length,
        family: options.family,
        model: options.model,
        aspectRatio: options.aspectRatio,
        resolution: options.resolution,
        mode: options.mode,
        script: options.script,
        mediaKind: existing.mediaKind ?? 'video',
        stylePrompt: existing.stylePrompt ?? '',
      });
      return existing;
    }
  }

  const name =
    options.projectName?.trim() ||
    options.script.title?.trim() ||
    `Dự án ${new Date().toLocaleString('vi-VN')}`;

  const created = createProject({
    name,
    brief: options.brief,
    language: options.language,
    sceneCount: options.script.scenes.length,
    family: options.family,
    model: options.model,
    aspectRatio: options.aspectRatio,
    resolution: options.resolution,
    mode: options.mode,
    mediaKind: options.mediaKind,
    stylePrompt: options.stylePrompt,
  });

  created.status = 'generating';
  created.updatedAt = nowIso();
  writeMeta(created);
  writeDraft(created.id, {
    brief: options.brief ?? '',
    language: options.language ?? 'Tiếng Việt',
    sceneCount: options.script.scenes.length,
    family: options.family,
    model: options.model,
    aspectRatio: options.aspectRatio,
    resolution: options.resolution,
    mode: options.mode,
    script: options.script,
    mediaKind: options.mediaKind ?? 'video',
    stylePrompt: options.stylePrompt ?? '',
  });
  return created;
}

export function updateProjectStatus(
  id: string,
  status: ProjectStatus,
  extra?: Partial<ProjectMeta>
): ProjectMeta {
  const meta = readMeta(id);
  if (!meta) throw new Error(`Không tìm thấy dự án: ${id}`);
  const next: ProjectMeta = {
    ...meta,
    ...extra,
    status,
    updatedAt: nowIso(),
    hasVideo: fs.existsSync(path.join(projectDir(id), 'final.mp4')),
  };
  writeMeta(next);
  return next;
}

export function getProjectDir(id: string): string {
  return projectDir(id);
}
