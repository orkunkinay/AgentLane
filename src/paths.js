import {homedir} from 'node:os';
import {join} from 'node:path';
export const stateDir=process.env.STILL_STATE_DIR || join(homedir(),'.still');
export const socketPath=join(stateDir,'browser.sock');
