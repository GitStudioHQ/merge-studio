import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export interface JetBrainsLauncher {
  /** Executable or launcher-script path to spawn. */
  command: string;
  /** Human-readable IDE name for messages. */
  name: string;
  /** Stable id (webstorm, pycharm, …). */
  id: string;
}

interface IdeDef {
  id: string;
  name: string;
  /** CLI launcher / in-bundle binary name. */
  bin: string;
  /** Possible macOS .app bundle names. */
  appNames: string[];
}

// Ordered by how common they are for the web/python crowd this targets.
const IDES: IdeDef[] = [
  { id: "webstorm", name: "WebStorm", bin: "webstorm", appNames: ["WebStorm.app"] },
  {
    id: "pycharm",
    name: "PyCharm",
    bin: "pycharm",
    appNames: [
      "PyCharm.app",
      "PyCharm Professional.app",
      "PyCharm Community.app",
      "PyCharm CE.app",
    ],
  },
  {
    id: "intellij",
    name: "IntelliJ IDEA",
    bin: "idea",
    appNames: [
      "IntelliJ IDEA.app",
      "IntelliJ IDEA Ultimate.app",
      "IntelliJ IDEA Community Edition.app",
      "IntelliJ IDEA CE.app",
    ],
  },
  { id: "phpstorm", name: "PhpStorm", bin: "phpstorm", appNames: ["PhpStorm.app"] },
  { id: "goland", name: "GoLand", bin: "goland", appNames: ["GoLand.app"] },
  { id: "clion", name: "CLion", bin: "clion", appNames: ["CLion.app"] },
  { id: "rider", name: "Rider", bin: "rider", appNames: ["Rider.app"] },
  { id: "rubymine", name: "RubyMine", bin: "rubymine", appNames: ["RubyMine.app"] },
  { id: "datagrip", name: "DataGrip", bin: "datagrip", appNames: ["DataGrip.app"] },
];

/**
 * Locates an installed JetBrains IDE launcher. Resolution order:
 *  1. an explicit path from settings,
 *  2. the preferred IDE (or all, for "auto") found on PATH,
 *  3. the same IDEs found as macOS .app bundles in ~/Applications and /Applications.
 */
export function findJetBrainsLauncher(
  preferred: string,
  explicitPath: string,
): JetBrainsLauncher | undefined {
  if (explicitPath && fs.existsSync(explicitPath)) {
    return { command: explicitPath, name: "JetBrains IDE", id: "custom" };
  }

  const order =
    preferred && preferred !== "auto"
      ? [
          ...IDES.filter((ide) => ide.id === preferred),
          ...IDES.filter((ide) => ide.id !== preferred),
        ]
      : IDES;

  for (const ide of order) {
    const onPath = findOnPath(ide.bin);
    if (onPath) {
      return { command: onPath, name: ide.name, id: ide.id };
    }
    const inApps = findInApps(ide);
    if (inApps) {
      return { command: inApps, name: ide.name, id: ide.id };
    }
  }
  return undefined;
}

function findOnPath(bin: string): string | undefined {
  const dirs = (process.env.PATH ?? "").split(path.delimiter);
  for (const dir of dirs) {
    if (!dir) {
      continue;
    }
    const candidate = path.join(dir, bin);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // not here; keep looking
    }
  }
  return undefined;
}

function findInApps(ide: IdeDef): string | undefined {
  const bases = [path.join(os.homedir(), "Applications"), "/Applications"];
  for (const base of bases) {
    for (const appName of ide.appNames) {
      const candidate = path.join(base, appName, "Contents", "MacOS", ide.bin);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}
