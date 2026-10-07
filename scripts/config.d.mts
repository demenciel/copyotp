export interface Config { publicKey: string; clientId?: string }
export const configPath: URL;
export const scope: string;
export function loadConfig(): Promise<Config>;
export function saveConfig(config: Config): Promise<void>;
export function extensionId(publicKey: string): string;
