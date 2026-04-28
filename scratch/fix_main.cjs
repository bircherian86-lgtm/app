const fs = require('fs');
const mainPath = 'c:\\Users\\birch\\Desktop\\pc optimizer koesss\\main.ts';
let content = fs.readFileSync(mainPath, 'utf8');

const correctHeader = `export {};

type Tweak = {
  name: string;
  desc: string;
  category: string;
  risk: "SAFE" | "MODERATE" | "RISKY";
  enabled: boolean;
  frequency?: 'daily' | 'weekly' | 'monthly';
};

declare global {
  interface Window {
    novaAPI: {
      getStats: () => Promise<any>;
      getSpecs: () => Promise<any>;
      runTweak: (name: string, enabled: boolean) => Promise<any>;
      checkAdmin: () => Promise<boolean>;
      getTweakStates: () => Promise<Record<string, boolean>>;
      restartPC: () => Promise<void>;
      revertTweaks: () => Promise<void>;
      relaunchAdmin: () => Promise<void>;
      checkTweakStatus: (name: string) => Promise<boolean>;
      minimizeWindow: () => void;
      restoreWindow: () => void;
      closeWindow: () => void;
      updateRPC: (state: string, details: string) => Promise<void>;
      getStartupPrograms: () => Promise<any>;
      toggleStartupProgram: (name: string, enabled: boolean) => Promise<void>;
      getBootTime: () => Promise<any>;
      getDiskHealth: () => Promise<any>;
      getPingStats: () => Promise<any>;
      getTopProcesses: () => Promise<any>;
      killProcess: (name: string) => Promise<void>;
      openExternal: (url: string) => Promise<void>;
    };
  }
}

const initializeApp = async () => {
`;

// Find where the tweaks array starts
const tweaksIndex = content.indexOf("const tweaks: Tweak[] = [");
if (tweaksIndex !== -1) {
    content = correctHeader + "\n" + content.substring(tweaksIndex);
}

fs.writeFileSync(mainPath, content);
console.log('Restored main.ts header');
