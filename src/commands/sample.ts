import { Writable } from "node:stream";
import { Command } from "./command";

export class Sample extends Command {
  public isReady: Promise<Sample>;

  public async execute(_: { [name: string]: string }, stream: Writable) {
    for (const i in new Array(10).fill(0)) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      stream.write(`Timer ${i}\n`);
    }
    stream.end(`Success !!\n`);
  }

  destroy() {}
}
