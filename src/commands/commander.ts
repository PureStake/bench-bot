import { Writable } from "node:stream";
import { Service } from "../utils/service";
import { Command } from "./command";
import pQueue from "p-queue";

export interface CommandData {
  keyword: string;
  parameters: {
    cmdLine: string; // command line with the keyword (ex: "benchmark pallet author-mapping" )
    [name: string]: string; // optional parameters given by the hook
  };
  logger: Writable;
}

export class Commander implements Service {
  // Set of commands mapped by their keyword
  public commands: { [keyword: string]: Command };

  // Queue to process each command
  private _commandQueue: pQueue;

  // Currently being destroyed
  private _isDestroying: boolean;

  public isReady: Promise<Commander>;

  constructor(commands: Command[]) {
    this._commandQueue = new pQueue({ concurrency: 1 });
    this._isDestroying = false;
    this.isReady = Promise.all(commands.map((c) => c.isReady)).then(() => this);
    this.commands = commands.reduce((p, c) => {
      p[c.keyword] = c;
      return p;
    }, {});
  }

  public async handleCommand({ keyword, parameters, logger }: CommandData) {
    try {
      if (this._isDestroying) {
        logger.write("Service ending\n");
        logger.end();
        return;
      }
      const command = this.commands[keyword];
      if (!command) {
        logger.end(`Error: Command not found\n`);
        return;
      }
      logger.write(
        `Service ${keyword} queued (position: ${this._commandQueue.size})\n`
      );
      this._commandQueue.add(() => command.execute(parameters, logger));
    } catch (e) {
      console.error(`[Commander] Error: ${e.message}`);
      logger.end(`Error: ${e.message}`);
    }
  }

  public async destroy(): Promise<void> {
    this._isDestroying = true;
    await this._commandQueue.onIdle();
    await Promise.all(Object.values(this.commands).map((c) => c.destroy()));
  }
}
