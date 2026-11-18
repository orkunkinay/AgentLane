// Where Chromium-based browsers look for native messaging host manifests on macOS.
import { homedir } from 'node:os';
import { join } from 'node:path';

export const HOST_NAME = 'org.agentlane.browser';

const support = () => join(homedir(), 'Library/Application Support');
export const browsers = () => ({
  chrome: join(support(), 'Google/Chrome/NativeMessagingHosts'),
  'chrome-beta': join(support(), 'Google/Chrome Beta/NativeMessagingHosts'),
  'chrome-canary': join(support(), 'Google/Chrome Canary/NativeMessagingHosts'),
  chromium: join(support(), 'Chromium/NativeMessagingHosts'),
  brave: join(support(), 'BraveSoftware/Brave-Browser/NativeMessagingHosts'),
  edge: join(support(), 'Microsoft Edge/NativeMessagingHosts'),
});

export function requireNode(version = process.versions.node) {
  const [major, minor] = version.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 13))
    throw Error(
      `AgentLane needs Node.js 22.13 or newer; this is ${version}. Upgrade Node, then retry.`,
    );
}
