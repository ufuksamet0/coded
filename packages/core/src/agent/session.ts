import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { ChatMessage, SessionData, SessionMeta } from '../types.js';
import { projectKey, sessionsDir } from '../utils/paths.js';
import { CodedError } from '../errors.js';

export class SessionStore {
  private readonly directory: string;

  constructor(readonly workspace: string) {
    this.directory = path.join(sessionsDir(), projectKey(workspace));
  }

  get path(): string {
    return this.directory;
  }

  async list(): Promise<SessionMeta[]> {
    let files: string[];
    try {
      files = await fs.readdir(this.directory);
    } catch {
      return [];
    }
    const sessions: SessionMeta[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = await fs.readFile(path.join(this.directory, file), 'utf8');
        const data = JSON.parse(raw) as SessionData;
        if (data.meta) sessions.push(data.meta);
      } catch {
        // Ignore corrupt session files.
      }
    }
    return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async save(messages: ChatMessage[], meta: Omit<SessionMeta, 'updatedAt' | 'id' | 'createdAt' | 'workspace'> & Partial<SessionMeta>): Promise<SessionMeta> {
    const now = new Date().toISOString();
    const existing = meta.id ? await this.readMeta(meta.id) : undefined;
    const full: SessionMeta = {
      id: meta.id ?? createId(),
      title: meta.title || existing?.title || 'Untitled session',
      createdAt: existing?.createdAt ?? meta.createdAt ?? now,
      updatedAt: now,
      workspace: this.workspace,
      model: meta.model,
      mode: meta.mode,
    };
    const data: SessionData = { meta: full, messages };
    await fs.mkdir(this.directory, { recursive: true });
    const target = path.join(this.directory, `${full.id}.json`);
    const temporary = `${target}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(data, null, 2), 'utf8');
    await fs.rename(temporary, target);
    return full;
  }

  async load(id: string): Promise<SessionData> {
    const target = path.join(this.directory, `${sanitizeId(id)}.json`);
    try {
      const raw = await fs.readFile(target, 'utf8');
      return JSON.parse(raw) as SessionData;
    } catch (error) {
      throw new CodedError(`Could not load session "${id}": ${(error as Error).message}`, 'config', error);
    }
  }

  async latest(): Promise<SessionData | undefined> {
    const [first] = await this.list();
    if (!first) return undefined;
    return this.load(first.id);
  }

  async delete(id: string): Promise<void> {
    try {
      await fs.unlink(path.join(this.directory, `${sanitizeId(id)}.json`));
    } catch {
      // Already gone.
    }
  }

  private async readMeta(id: string): Promise<SessionMeta | undefined> {
    try {
      const data = await this.load(id);
      return data.meta;
    } catch {
      return undefined;
    }
  }
}

function createId(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${stamp}-${crypto.randomBytes(3).toString('hex')}`;
}

function sanitizeId(id: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(id)) {
    throw new CodedError(`Invalid session id "${id}".`, 'config');
  }
  return id;
}

export function sessionTitle(firstUserMessage: string): string {
  const cleaned = firstUserMessage.replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'Untitled session';
  return cleaned.length > 64 ? `${cleaned.slice(0, 61)}…` : cleaned;
}
