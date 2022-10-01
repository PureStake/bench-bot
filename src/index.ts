import { Probot } from "probot";
import assert from "assert";
import fs from "fs";
import * as benchCmd from "./commands/benchmark";
import { GlobalConfig } from "./utils/config";

let isTerminating = false;
let appFatalLogger: any = undefined;

for (const event of ["uncaughtException", "unhandledRejection"]) {
  process.on(event, function (error, origin) {
    if (isTerminating) {
      return;
    }
    isTerminating = true;

    try {
      if (appFatalLogger) {
        appFatalLogger({ event, error, origin });
      }
    } catch (error) {
      console.error({ level: "error", event, error, origin });
    }

    process.exit(1);
  });
}
export default function (app: Probot) {
  if (process.env.DEBUG) {
    app.log("Running in debug mode");
  }

  appFatalLogger = app.log.fatal;

  const baseBranch = process.env.BASE_BRANCH || "master";
  assert(baseBranch);
  app.log.debug(`base branch: ${baseBranch}`);

  const appId = process.env.APP_ID && parseInt(process.env.APP_ID);
  assert(appId);
  const installationId =
    process.env.INSTALLATION_ID && parseInt(process.env.INSTALLATION_ID);
  assert(installationId);
  const clientId = process.env.CLIENT_ID;
  assert(clientId);
  const clientSecret = process.env.CLIENT_SECRET;
  assert(clientSecret);
  const privateKeyPath = process.env.PRIVATE_KEY_PATH;
  assert(privateKeyPath);
  const privateKey = fs.readFileSync(privateKeyPath).toString();
  assert(privateKey);
  const bbRepo = process.env.BB_REPO;
  assert(bbRepo);
  const bbRepoOwner = process.env.BB_REPO_OWNER;
  assert(bbRepoOwner);
  const bbAppId = process.env.BB_APP_ID && parseInt(process.env.BB_APP_ID);
  assert(bbAppId);
  const bbInstallationId =
    process.env.BB_INSTALLATION_ID && parseInt(process.env.BB_INSTALLATION_ID);
  assert(bbInstallationId);
  const bbClientId = process.env.BB_CLIENT_ID;
  assert(bbClientId);
  const bbClientSecret = process.env.BB_CLIENT_SECRET;
  assert(bbClientSecret);
  const bbPrivateKeyPath = process.env.BB_PRIVATE_KEY_PATH;
  assert(bbPrivateKeyPath);
  const bbPrivateKey = fs.readFileSync(bbPrivateKeyPath).toString();
  assert(bbPrivateKey);
  const authInstallation = createAppAuth({
    appId,
    privateKey,
    clientId,
    clientSecret,
  });
  assert(authInstallation);
  const bbAuthInstallation = createAppAuth({
    appId: bbAppId,
    privateKey: bbPrivateKey,
    clientId: bbClientId,
    clientSecret: bbClientSecret,
  });
  assert(bbAuthInstallation);

  const globalConfig: GlobalConfig = {
    baseBranch,
    appId,
    installationId,
    clientId,
    clientSecret,
    privateKeyPath,
    privateKey,
    bbRepo,
    bbRepoOwner,
    bbAppId,
    bbInstallationId,
    bbClientId,
    bbClientSecret,
    bbPrivateKeyPath,
    bbPrivateKey,
    authInstallation,
    bbAuthInstallation,
  };

  app.on("issue_comment", async (context) => {
    let commentText = context.payload.comment.body;
    const triggerCommands = { "/bench": 1, "/fork-test": 2 };
    const triggerCommand = Object.keys(triggerCommands).find((command) =>
      commentText.startsWith(command)
    );
    if (
      !context.payload.issue.hasOwnProperty("pull_request") ||
      context.payload.action !== "created" ||
      !triggerCommand
    ) {
      return;
    }

    if (triggerCommand == "/bench") {
      benchCmd.run(app, globalConfig, context);
    }
  });
}
