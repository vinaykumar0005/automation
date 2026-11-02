// src/main/automation/types.ts
export * from '../../shared/types';

// Plugin interfaces for extensibility
export interface IPlugin {
  initialize(): Promise<void>;
  getHandlers(): Record<string, ITaskHandler>;
  dispose(): Promise<void>;
}

export interface ITaskHandler {
  execute(tab: any, task: any): Promise<any>;
  canHandle(taskType: string): boolean;
}