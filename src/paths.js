import { homedir } from 'node:os';
import { join } from 'node:path';
export const stateDir = process.env.AGENTLANE_STATE_DIR || join(homedir(), '.agentlane');
export const socketPath = join(stateDir, 'browser.sock');
