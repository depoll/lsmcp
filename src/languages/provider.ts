import { DetectedLanguage } from './detector.js';

export interface LanguageServerProvider {
  language: DetectedLanguage;
  isAvailable(): Promise<boolean>;
  install(options?: { force?: boolean }): Promise<void>;
  getCommand(): string[];
}
