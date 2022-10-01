import { benchmarkRuntime } from "../actions/benchmark";
import {
  COMMENT_MAX_LENGTH,
  COMMENT_TRUNCATED_POSTFIX,
  OctokitService,
} from "../utils/github";

import { Writable } from "node:stream";
import { Command } from "./command";
import { runTask } from "../actions/runner";

import Debug from "debug";
const debug = Debug("commands:benchmarking");

export interface BenchmarkConfig {
  moonbeamRepo: OctokitService;
  forkRepo: OctokitService;
}

export class Benchmark extends Command {
  private moonbeamRepo: OctokitService;
  private forkRepo: OctokitService;
  public isReady: Promise<Benchmark>;

  constructor(keyword: string, config: BenchmarkConfig) {
    super(keyword);
    this.moonbeamRepo = config.moonbeamRepo;
    this.forkRepo = config.forkRepo;
    this.isReady = Promise.all([this.moonbeamRepo, this.forkRepo]).then(
      () => this
    );
  }

  public async execute(
    parameters: { [name: string]: string },
    logger: Writable
  ) {
    debug(`Executing: ${parameters.cmdLine}`);
    try {
      // if (!parameters.pull_number) {
      //   logger.end(`Missing parameter pull_number`);
      //   return;
      // }
      // if (!parameters.issue_number) {
      //   logger.end(`Missing parameter issue_number`);
      //   return;
      // }

      const pull_number: number | undefined =
        parameters.pullNumber && parseInt(parameters.pullNumber);
      const issue_number: number | undefined =
        parameters.issueNumber && parseInt(parameters.issueNumber);
      const [_, ...commandParams] = parameters.cmdLine.split(" ");

      const moonbeamRest = (await this.moonbeamRepo.getOctokit()).rest;

      // TODO: We might think to allow external PR
      // const contributor = pr.data.head.user.login;
      const branch = pull_number
        ? (
            await moonbeamRest.pulls.get(
              this.moonbeamRepo.extendRepoOwner({ pull_number })
            )
          ).data.head.ref
        : "master";

      debug(`Running benchmark from ${branch}`);
      logger.write(`Running benchmark from ${branch}\n`);

      try {
        const initialInfo =
          `Starting benchmark for branch: ${branch}\n` +
          `Comment will be updated.\n`;
        debug(initialInfo);

        issue_number && logger.write(initialInfo);
        const issueComment =
          issue_number &&
          this.moonbeamRepo.extendRepoOwner({
            body: initialInfo,
            issue_number,
          });
        const issue_comment =
          issueComment &&
          (await moonbeamRest.issues.createComment(issueComment));
        const comment_id = issue_comment && issue_comment.data.id;

        const config = {
          branch,
          commandParams: commandParams.join(" "),
          moonbeamRepo: this.moonbeamRepo,
          forkRepo: this.forkRepo,
        };
        debug("benchmarkRuntime");

        // kick off the build/run process...
        const { outputFile, pullNumber, logs, benchCommand, repoDirectory } =
          await benchmarkRuntime(config);
        if (process.env.DEBUG) {
          logger.end(logs);
          return;
        }

        const toolchain = (
          await runTask("rustup show active-toolchain --verbose", {
            cwd: repoDirectory,
          })
        ).trim();

        if (comment_id) {
          await moonbeamRest.issues.updateComment(
            this.moonbeamRepo.extendRepoOwner({
              comment_id,
              body: `Error running benchmark: **${branch}**\n\n<details><summary>stdout</summary>${logs}</details>`,
            })
          );
        }

        const bodyPrefix = `
  Benchmark for branch "${branch}" with command ${benchCommand}
  
  Toolchain: ${toolchain}
  
  <details>
  <summary>Results</summary>
  
  \`\`\`
  `.trim();

        const bodySuffix = `
  \`\`\`
  
  </details>
  `.trim();

        const padding = 16;
        const formattingLength =
          bodyPrefix.length + bodySuffix.length + padding;
        const length = formattingLength + logs.length;
        const cleanedLogs =
          length < COMMENT_MAX_LENGTH
            ? logs
            : `${logs.slice(
                0,
                COMMENT_MAX_LENGTH -
                  (COMMENT_TRUNCATED_POSTFIX.length + formattingLength)
              )}${COMMENT_TRUNCATED_POSTFIX}`;

        const body = `
  ${bodyPrefix}
  ${cleanedLogs}
  ${bodySuffix}
  `.trim();

        if (comment_id) {
          await moonbeamRest.issues.updateComment(
            this.moonbeamRepo.extendRepoOwner({ comment_id, body })
          );
        }
        logger.end(`Success !!`);
      } catch (e) {
        console.log(e);
        logger.write(`ERROR: Failed to execute benchmark: ${e.message}`);
        if (issue_number) {
          await moonbeamRest.issues.createComment(
            this.moonbeamRepo.extendRepoOwner({
              issue_number,
              body: `ERROR: Failed to execute benchmark: ${e.message}`,
            })
          );
        }
      }
    } catch (e) {
      console.log(e);
      logger.write(`ERROR: Failed to execute benchmark: ${e.message}`);
    }
    logger.end(`Done benchmarking\n`);
    debug(`Done benchmarking`);
  }

  destroy() {}
}
