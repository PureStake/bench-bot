import EventEmitter from "node:events";
import type TypedEmitter from "typed-emitter";
import type { Writable } from "node:stream";
import type { CommandData } from "../commands/commander";

const TIMEOUT = 1_800_000;

export type HookEvents = {
  command: (data: CommandData) => void;
};

export abstract class Hook extends (EventEmitter as new () => TypedEmitter<HookEvents>) {
  constructor() {
    super();
  }

  // Promise to ensure when the service is ready
  public isReady: Promise<Hook>;

  // Destroy cleanly the service
  public abstract destroy(): Promise<void>;

  protected handleCommand(data: CommandData) {
    const timer = setTimeout(() => {
      data.logger.end();
    }, TIMEOUT);
    data.logger.on("close", () => {
      clearTimeout(timer);
    });
    this.emit("command", data);
  }
}
