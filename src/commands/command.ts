import { Writable } from "node:stream";
import { Service } from "../utils/service";

export abstract class Command implements Service {
  public keyword: string;
  public isReady: Promise<Command>;

  constructor(keyword: string) {
    this.keyword = keyword;
    this.isReady = Promise.resolve().then(() => this);
  }

  public abstract execute(
    parameters: { [name: string]: string },
    logger: Writable
  ): Promise<any>;

  abstract destroy();
}
