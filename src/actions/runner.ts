import { Writable } from "node:stream";
import child_process from "child_process";
import { promisify } from "node:util";
import Debug from "debug";
const debug = Debug("actions:runner");
const execAsync = promisify(child_process.exec);

// really just a context for running processes from a shell...
export async function runTask(
  cmd: string,
  { cwd }: { cwd: string },
  title?: string
): Promise<string> {
  debug(
    `${
      title ? `Title: ${title}\n` : ""
    }Running task on directory ${process.cwd()}: ${cmd}\n`
  );
  try {
    const result = await execAsync(cmd, { cwd });

    return result.stdout;
  } catch (error) {
    console.log(error);
    debug(
      `Caught exception in command execution. Error[${error.status}] ${error.message}\n`
    );
    throw error;
  }
}
