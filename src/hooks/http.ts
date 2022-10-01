import express, { Express, Request, Response } from "express";
import { Server } from "http";
import { Hook } from "./hook";
import Debug from "debug";
const debug = Debug("hooks:http");

interface HttpHookOptions {
  port: number;
}

export class HttpHook extends Hook {
  private app: Express;
  private server: Server;

  constructor({ port }: HttpHookOptions) {
    super();
    this.isReady = new Promise((resolve) => {
      this.app = express();
      this.app.get("*", (req, res) => {
        this._handleRequest(req, res);
      });

      this.server = this.app.listen(port, () => {
        console.log(`The HTTP application is listening on port ${port}!`);
        resolve(this);
      });
    });
  }

  private _handleRequest = (req: Request, res: Response) => {
    try {
      const parameters = req.originalUrl.slice(1).split(/\//);
      if (parameters.length < 1) {
        res.end("Error: Missing keyword");
        return;
      }
      const keyword = parameters[0].toLocaleLowerCase();
      const cmdLine = parameters.join(" ");
      debug(`Received keyword: ${keyword}, cmdLine:${cmdLine}`);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Transfer-Encoding", "chunked");
      this.handleCommand({ keyword, parameters: { cmdLine }, logger: res });
    } catch (e) {
      console.error(`Error: ${e.message}`);
      res.end(`Error: ${e.message}`);
    }
  };

  override async destroy() {
    await this.isReady.then(() => {
      console.log(`Closing HTTP server!`);
      this.server.close();
    });
  }
}
