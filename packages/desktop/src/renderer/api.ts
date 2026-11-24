declare global {
  interface Window {
    api: {
      getVersion: () => Promise<string>;
      getConfigDir: () => Promise<string>;
      loadConfig: (workspace: string) => Promise<any>;
      getRecentWorkspaces: () => Promise<string[]>;
      addRecentWorkspace: (workspace: string) => Promise<void>;
      pickWorkspace: () => Promise<string | null>;
      encrypt: (data: string) => Promise<string>;
      decrypt: (encryptedBase64: string) => Promise<string>;
      agent: {
        create: (options: any) => Promise<{ id: number }>;
        run: (id: number, input: string) => Promise<void>;
        abort: (id: number) => void;
        destroy: (id: number) => Promise<void>;
        getMessages: (id: number) => Promise<any[]>;
        onEvent: (id: number, callback: (event: any) => void) => () => void;
        answerPermission: (id: number, answer: 'allow' | 'always' | 'deny') => void;
      };
      fs: {
        read: (workspace: string, path: string) => Promise<string>;
        write: (workspace: string, path: string, content: string) => Promise<void>;
        list: (workspace: string, path: string) => Promise<Array<{ name: string; isDirectory: boolean; isFile: boolean }>>;
      };
      shell: {
        execute: (workspace: string, command: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;
      };
    };
  }
}

export const api = window.api;